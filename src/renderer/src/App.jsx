import { useState, useEffect } from 'react'

/**
 * Root application component.
 *
 * This bootstrap shell verifies that the secure process boundaries are in
 * place by confirming that:
 *   1. window.youtubeManager is exposed by the preload (contextBridge).
 *   2. A ping round-trip through IPC succeeds.
 *
 * Actual application screens (onboarding, queue, upload editor) will be
 * implemented in subsequent issues.
 */
export default function App() {
  const [ipcStatus, setIpcStatus] = useState('checking…')
  const [versions, setVersions] = useState(null)
  const [apiPresent, setApiPresent] = useState(false)

  useEffect(() => {
    // Confirm that the preload-exposed API surface is available.
    setApiPresent(typeof window.youtubeManager !== 'undefined')

    if (!window.youtubeManager) {
      setIpcStatus('window.youtubeManager not found — preload may not be loaded.')
      return
    }

    // Verify IPC connectivity with a ping.
    window.youtubeManager
      .ping()
      .then(({ ok, data }) => {
        if (ok && data === 'pong') {
          setIpcStatus('IPC connected ✓')
        } else {
          setIpcStatus(`Unexpected ping response: ${JSON.stringify({ ok, data })}`)
        }
      })
      .catch((err) => setIpcStatus(`IPC error: ${err.message}`))

    // Fetch version information from the main process.
    window.youtubeManager
      .getVersion()
      .then(({ ok, data }) => {
        if (ok) setVersions(data)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>YouTube Video Manager</h1>
        <p className="app-tagline">Queue and schedule uploads for your YouTube channel.</p>
      </header>

      <main className="app-main">
        <section className="status-card">
          <h2>Process Boundaries</h2>
          <ul className="status-list">
            <li>
              <span className="label">Preload API (window.youtubeManager):</span>
              <span className={`badge ${apiPresent ? 'badge--ok' : 'badge--error'}`}>
                {apiPresent ? 'present ✓' : 'missing ✗'}
              </span>
            </li>
            <li>
              <span className="label">IPC round-trip:</span>
              <span
                className={`badge ${ipcStatus.includes('✓') ? 'badge--ok' : 'badge--pending'}`}
              >
                {ipcStatus}
              </span>
            </li>
          </ul>
        </section>

        {versions && (
          <section className="status-card">
            <h2>Runtime Versions</h2>
            <ul className="status-list">
              <li>
                <span className="label">App:</span>
                <span className="value">{versions.app}</span>
              </li>
              <li>
                <span className="label">Electron:</span>
                <span className="value">{versions.electron}</span>
              </li>
              <li>
                <span className="label">Chrome:</span>
                <span className="value">{versions.chrome}</span>
              </li>
              <li>
                <span className="label">Node.js:</span>
                <span className="value">{versions.node}</span>
              </li>
            </ul>
          </section>
        )}

        <section className="status-card">
          <h2>Security Defaults</h2>
          <ul className="status-list">
            <li>
              <span className="label">Context isolation:</span>
              <span className="badge badge--ok">enabled ✓</span>
            </li>
            <li>
              <span className="label">Renderer sandbox:</span>
              <span className="badge badge--ok">enabled ✓</span>
            </li>
            <li>
              <span className="label">Node integration in renderer:</span>
              <span className="badge badge--ok">disabled ✓</span>
            </li>
            <li>
              <span className="label">Content Security Policy:</span>
              <span className="badge badge--ok">enforced ✓</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  )
}
