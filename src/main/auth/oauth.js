import { shell } from 'electron'
import { createServer as createHttpServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generates a PKCE code_verifier / code_challenge pair (S256 method).
 *
 * @returns {{ verifier: string, challenge: string }}
 */
function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// ---------------------------------------------------------------------------
// Response page
// ---------------------------------------------------------------------------

/**
 * Builds a minimal HTML page to display in the user's browser after the
 * OAuth redirect completes.
 */
function buildResponsePage(heading, message, success) {
  const color = success ? '#1a7f37' : '#cf222e'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${heading} \u2014 YouTube Video Manager</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f6f8fa; }
    .card { background: #fff; border-radius: 8px; padding: 2rem 3rem;
            box-shadow: 0 2px 8px rgba(0,0,0,.12); text-align: center; max-width: 480px; }
    h1 { color: ${color}; font-size: 1.4rem; margin: 0 0 .75rem; }
    p  { color: #57606a; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/**
 * Exchanges an authorization code for an access + refresh token pair at
 * Google's token endpoint.
 *
 * @param {{clientId:string, clientSecret?:string, tokenUri:string}} credentials
 * @param {string} code
 * @param {string} redirectUri
 * @param {string} codeVerifier
 * @returns {Promise<{access_token:string, refresh_token?:string, expires_in:number, scope:string}>}
 */
async function exchangeCodeForTokens(credentials, code, redirectUri, codeVerifier) {
  const params = new URLSearchParams({
    code,
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  if (credentials.clientSecret) {
    params.set('client_secret', credentials.clientSecret)
  }

  const response = await fetch(credentials.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const body = await response.json()

  if (!response.ok) {
    const detail = body.error_description ?? body.error ?? response.status
    throw new Error(`Token exchange failed: ${detail}`)
  }

  return body
}

// ---------------------------------------------------------------------------
// Channel identity
// ---------------------------------------------------------------------------

/**
 * Fetches the authenticated user's first YouTube channel using the given
 * access token.
 *
 * @param {string} accessToken
 * @returns {Promise<{channelId:string, title:string, thumbnailUrl:string|null}>}
 */
async function fetchChannelIdentity(accessToken) {
  const url =
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1'

  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + accessToken },
  })

  const body = await response.json()

  if (!response.ok) {
    const detail = body.error?.message ?? response.status
    throw new Error(`Failed to fetch channel identity: ${detail}`)
  }

  const channel = body.items?.[0]

  if (!channel) {
    throw new Error(
      'No YouTube channel found for this Google account. ' +
        'Please ensure the account has a YouTube channel before signing in.'
    )
  }

  return {
    channelId: channel.id,
    title: channel.snippet?.title ?? '',
    thumbnailUrl: channel.snippet?.thumbnails?.default?.url ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Performs a full browser-based OAuth 2.0 PKCE flow for a Google Desktop
 * (installed-app) credential set.
 *
 * Flow:
 *  1. Generate PKCE verifier/challenge and a random CSRF state token.
 *  2. Start a loopback HTTP callback server on an OS-assigned free port.
 *  3. Open the Google authorization URL in the system browser.
 *  4. Wait for the authorization code callback (up to 5 minutes).
 *  5. Exchange the code for tokens at the token endpoint.
 *  6. Fetch the authenticated YouTube channel identity.
 *
 * @param {{
 *   clientId: string,
 *   clientSecret?: string,
 *   authUri: string,
 *   tokenUri: string,
 * }} credentials  Parsed fields from the Google Desktop OAuth JSON file.
 *
 * @returns {Promise<{
 *   channel: { channelId:string, title:string, thumbnailUrl:string|null },
 *   tokens:  { access_token:string, refresh_token?:string, expires_in:number, scope:string },
 * }>}
 */
export async function performOAuthFlow(credentials) {
  const { verifier, challenge } = generatePKCE()
  const state = randomBytes(16).toString('base64url')

  // ---- Start loopback callback server ------------------------------------
  // The server listens on port 0 so the OS assigns a free port immediately.
  // We open the browser AFTER the server is listening so the redirect URI is
  // guaranteed to be accepting connections.
  const { code, port } = await new Promise((outerResolve, outerReject) => {
    let server
    let settled = false
    let timer

    function settle(fn, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (server) server.close()
      fn(value)
    }

    server = createHttpServer((req, res) => {
      let urlObj
      try {
        urlObj = new URL(req.url, 'http://127.0.0.1')
      } catch {
        res.writeHead(400)
        res.end('Bad request')
        return
      }

      if (urlObj.pathname !== '/oauth/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const code = urlObj.searchParams.get('code')
      const returnedState = urlObj.searchParams.get('state')
      const error = urlObj.searchParams.get('error')
      const errorDesc = urlObj.searchParams.get('error_description')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          buildResponsePage(
            'Authorization failed',
            'Google returned an error: ' + (errorDesc ?? error) + '. You can close this tab.',
            false
          )
        )
        settle(outerReject, new Error('OAuth authorization denied: ' + (errorDesc ?? error)))
        return
      }

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          buildResponsePage('Invalid request', 'State mismatch. You can close this tab.', false)
        )
        settle(outerReject, new Error('OAuth state mismatch \u2014 possible CSRF attack'))
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(buildResponsePage('Missing code', 'No authorization code received.', false))
        settle(outerReject, new Error('OAuth callback did not include an authorization code'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        buildResponsePage(
          'Authorization complete',
          'You can close this tab and return to YouTube Video Manager.',
          true
        )
      )
      settle(outerResolve, { code, port: server.address().port })
    })

    timer = setTimeout(
      () => settle(outerReject, new Error('OAuth authorization timed out after 5 minutes')),
      OAUTH_TIMEOUT_MS
    )

    server.on('error', (err) => settle(outerReject, err))

    // Port 0 lets the OS assign any available port.
    server.listen(0, '127.0.0.1')
  })

  const redirectUri = 'http://127.0.0.1:' + port + '/oauth/callback'

  // ---- Build authorization URL ------------------------------------------
  const authUrl = new URL(credentials.authUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', credentials.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', YOUTUBE_SCOPE)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent') // always request a refresh token

  // ---- Open system browser -----------------------------------------------
  await shell.openExternal(authUrl.toString())

  // ---- Exchange code for tokens ------------------------------------------
  const tokens = await exchangeCodeForTokens(credentials, code, redirectUri, verifier)

  // ---- Fetch channel identity --------------------------------------------
  const channel = await fetchChannelIdentity(tokens.access_token)

  return { channel, tokens }
}
