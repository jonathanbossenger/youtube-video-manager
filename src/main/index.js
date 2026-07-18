import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { setupIpcHandlers } from './ipc/handlers.js'

// ---------------------------------------------------------------------------
// Security: disable the remote module globally (it is already off by default
// in modern Electron, but being explicit prevents accidental re-enablement).
// ---------------------------------------------------------------------------
app.on('remote-require', (event) => event.preventDefault())
app.on('remote-get-global', (event) => event.preventDefault())

// ---------------------------------------------------------------------------
// Content Security Policy
//
// The renderer never makes direct network requests — all privileged
// operations go through IPC.  The CSP therefore allows no external
// origins and no inline scripts.
//
// In development, Vite's HMR dev-server runs on localhost so a relaxed
// subset of directives is applied instead to preserve hot-reload.
// ---------------------------------------------------------------------------

/**
 * Production CSP — maximally restrictive.
 * Served via file:// protocol, so 'self' covers the app bundle.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React may inject minimal inline styles; 'unsafe-inline' is limited to
  // style-src and does not affect script execution.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // No external network connections from the renderer.
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
].join('; ')

/**
 * Development CSP — allows Vite's HMR WebSocket and local dev-server.
 * 'unsafe-eval' is required for Vite's runtime module system in dev mode.
 * This policy is NEVER applied to a packaged build.
 */
const DEVELOPMENT_CSP = [
  "default-src 'self' http://localhost:*",
  "script-src 'self' 'unsafe-eval' http://localhost:*",
  "style-src 'self' 'unsafe-inline' http://localhost:*",
  "img-src 'self' data: blob: http://localhost:*",
  "font-src 'self' data: http://localhost:*",
  "connect-src 'self' http://localhost:* ws://localhost:*",
  "media-src 'none'",
  "object-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
].join('; ')

const isDev = !app.isPackaged

// ---------------------------------------------------------------------------
// Window factory
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'YouTube Video Manager',
    webPreferences: {
      /**
       * Load the preload script.  electron-vite resolves __dirname to the
       * compiled output directory, so the join below always finds the right
       * file in both dev and production modes.
       */
      preload: join(__dirname, '../preload/index.js'),

      // ---- Security settings ----
      // Context isolation keeps the preload world separate from the
      // renderer world; scripts in the page cannot reach Node globals.
      contextIsolation: true,

      // Renderer process sandboxing — restricts the renderer to a Chromium
      // content process with no Node.js access.
      sandbox: true,

      // Node integration must remain off so renderer JS cannot require()
      // Node built-ins or npm packages directly.
      nodeIntegration: false,

      // Disable navigation to external origins.
      webSecurity: true,

      // Prevent the renderer from opening new windows / popups.
      disablePopups: true,
    },
  })

  // ---- Apply CSP via response-header intercept ----------------------------
  // Intercepting headers on the defaultSession catches both file:// and
  // http://localhost:* (dev server) responses.
  session.defaultSession.webRequest.onHeadersReceived((_details, callback) => {
    callback({
      responseHeaders: {
        ..._details.responseHeaders,
        'Content-Security-Policy': [isDev ? DEVELOPMENT_CSP : PRODUCTION_CSP],
      },
    })
  })

  // ---- Block renderer-initiated navigation --------------------------------
  // Prevent the renderer from navigating away from the app origin.
  win.webContents.on('will-navigate', (event, url) => {
    const isLocalDev =
      isDev && (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'))
    const isFileOrigin = url.startsWith('file://')

    if (!isLocalDev && !isFileOrigin) {
      event.preventDefault()
      console.warn(`[main] Blocked navigation to external URL: ${url}`)
    }
  })

  // ---- Block new-window / popup creation ----------------------------------
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[main] Blocked window.open to: ${url}`)
    return { action: 'deny' }
  })

  // ---- Load renderer ------------------------------------------------------
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  setupIpcHandlers()
  createWindow()

  // macOS: re-create the window when the dock icon is clicked and no windows
  // are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (Windows and Linux behaviour).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
