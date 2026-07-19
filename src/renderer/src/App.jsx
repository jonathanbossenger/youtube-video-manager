import { useState, useEffect } from 'react'

/**
 * Root application component.
 *
 * Renders a progressive onboarding flow:
 *   1. Import Google Desktop OAuth credentials JSON.
 *   2. Sign in via browser OAuth (PKCE loopback).
 *   3. Show the bound channel and allow sign-out / binding reset.
 */
export default function App() {
  const [authSnapshot, setAuthSnapshot] = useState(null)
  const [channelInfo, setChannelInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [error, setError] = useState(null)

  // ---- Load auth status on mount -----------------------------------------

  useEffect(() => {
    if (!window.youtubeManager) {
      setLoading(false)
      return
    }

    Promise.all([
      window.youtubeManager.getAuthStatus(),
      window.youtubeManager.getChannelInfo(),
    ])
      .then(([authRes, channelRes]) => {
        if (authRes.ok) setAuthSnapshot(authRes.data)
        if (channelRes.ok) setChannelInfo(channelRes.data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // ---- Actions ------------------------------------------------------------

  async function handleImportCredentials() {
    setError(null)
    setImportLoading(true)
    try {
      const dialogRes = await window.youtubeManager.openFileDialog([
        { name: 'JSON credentials', extensions: ['json'] },
      ])
      if (!dialogRes.ok) {
        setError(dialogRes.error ?? 'File dialog failed.')
        return
      }
      if (!dialogRes.data) {
        return // user cancelled
      }

      const importRes = await window.youtubeManager.importCredentials(dialogRes.data)
      if (!importRes.ok) {
        setError(importRes.error ?? 'Failed to import credentials.')
        return
      }
      setAuthSnapshot(importRes.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setImportLoading(false)
    }
  }

  async function handleStartOAuth() {
    setError(null)
    setOauthLoading(true)
    try {
      const authRes = await window.youtubeManager.startOAuth()
      if (!authRes.ok) {
        setError(authRes.error ?? 'Authorization failed.')
        return
      }
      setAuthSnapshot(authRes.data)

      // Refresh channel info after successful auth.
      const channelRes = await window.youtubeManager.getChannelInfo()
      if (channelRes.ok) setChannelInfo(channelRes.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setOauthLoading(false)
    }
  }

  async function handleSignOut() {
    setError(null)
    try {
      const res = await window.youtubeManager.signOut()
      if (res.ok) {
        setAuthSnapshot(res.data)
        setChannelInfo(null)
      } else {
        setError(res.error ?? 'Sign-out failed.')
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleResetBinding() {
    setError(null)
    if (
      !window.confirm(
        'This will clear your upload queue and remove the channel binding. Continue?'
      )
    ) {
      return
    }
    try {
      const res = await window.youtubeManager.resetChannelBinding()
      if (res.ok) {
        setAuthSnapshot(res.data)
        setChannelInfo(null)
      } else {
        setError(res.error ?? 'Reset failed.')
      }
    } catch (err) {
      setError(err.message)
    }
  }

  // ---- Render helpers -----------------------------------------------------

  function renderOnboarding() {
    const hasCredentials = Boolean(authSnapshot?.credentials)
    const isAuthenticated = Boolean(authSnapshot?.authenticated)

    return (
      <section className="status-card">
        <h2>Setup</h2>

        {/* Step 1: Import credentials */}
        <div className="onboarding-step">
          <div className="onboarding-step-header">
            <span className="onboarding-step-num">1</span>
            <span>Import Google OAuth credentials</span>
            {hasCredentials && <span className="badge badge--ok">done ✓</span>}
          </div>
          {!hasCredentials && (
            <p className="onboarding-hint">
              Download a <em>Desktop app</em> OAuth 2.0 client JSON from the Google Cloud Console
              and import it here.
            </p>
          )}
          {!hasCredentials && (
            <button
              className="btn btn--primary"
              onClick={handleImportCredentials}
              disabled={importLoading}
            >
              {importLoading ? 'Importing…' : 'Import credentials file'}
            </button>
          )}
          {hasCredentials && (
            <p className="onboarding-meta">
              Client ID: <code>{authSnapshot.credentials.clientId}</code>
            </p>
          )}
        </div>

        {/* Step 2: Sign in */}
        <div className={`onboarding-step ${!hasCredentials ? 'onboarding-step--disabled' : ''}`}>
          <div className="onboarding-step-header">
            <span className="onboarding-step-num">2</span>
            <span>Sign in with YouTube</span>
            {isAuthenticated && <span className="badge badge--ok">done ✓</span>}
          </div>
          {!isAuthenticated && hasCredentials && (
            <p className="onboarding-hint">
              Your browser will open for Google sign-in. The app requests the{' '}
              <code>youtube.force-ssl</code> scope.
            </p>
          )}
          {!isAuthenticated && (
            <button
              className="btn btn--primary"
              onClick={handleStartOAuth}
              disabled={!hasCredentials || oauthLoading}
            >
              {oauthLoading ? 'Waiting for browser…' : 'Sign in with Google'}
            </button>
          )}
        </div>
      </section>
    )
  }

  function renderChannelCard() {
    if (!channelInfo) return null
    return (
      <section className="status-card">
        <h2>Connected Channel</h2>
        <div className="channel-info">
          {channelInfo.thumbnailUrl && (
            <img
              src={channelInfo.thumbnailUrl}
              alt={channelInfo.title}
              className="channel-avatar"
            />
          )}
          <div className="channel-meta">
            <p className="channel-title">{channelInfo.title}</p>
            <p className="channel-id">{channelInfo.channelId}</p>
          </div>
        </div>
        <div className="channel-actions">
          <button className="btn btn--secondary" onClick={handleSignOut}>
            Sign out
          </button>
          <button className="btn btn--danger" onClick={handleResetBinding}>
            Reset channel binding
          </button>
        </div>
      </section>
    )
  }

  // ---- Main render --------------------------------------------------------

  return (
    <div className="app">
      <header className="app-header">
        <h1>YouTube Video Manager</h1>
        <p className="app-tagline">Queue and schedule uploads for your YouTube channel.</p>
      </header>

      <main className="app-main">
        {loading && <p className="loading-message">Loading…</p>}

        {!loading && (
          <>
            {error && (
              <div className="error-banner" role="alert">
                <strong>Error:</strong> {error}
              </div>
            )}

            {authSnapshot && !authSnapshot.authenticated && renderOnboarding()}
            {authSnapshot?.authenticated && renderChannelCard()}
          </>
        )}
      </main>
    </div>
  )
}

