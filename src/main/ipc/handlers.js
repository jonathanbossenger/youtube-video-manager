import { ipcMain, app } from 'electron'
import { CHANNELS, INVOKE_CHANNELS, CHANNEL_VALIDATORS } from './channels.js'

/**
 * Wraps a handler function with payload validation and uniform error
 * serialisation so individual handlers never need to guard themselves.
 *
 * @param {string} channel   - The IPC channel name.
 * @param {Function} handler - Async function (event, payload) => result.
 * @returns {Function}       - Validated handler suitable for ipcMain.handle.
 */
function createValidatedHandler(channel, handler) {
  const validate = CHANNEL_VALIDATORS[channel]

  return async (event, payload) => {
    // 1. Validate the payload against the channel contract.
    try {
      validate(payload)
    } catch (validationError) {
      return { ok: false, error: validationError.message }
    }

    // 2. Execute the handler and catch any unexpected errors.
    try {
      const result = await handler(event, payload)
      return { ok: true, data: result ?? null }
    } catch (handlerError) {
      console.error(`[ipc] handler error on ${channel}:`, handlerError)
      return { ok: false, error: handlerError.message }
    }
  }
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------
// All handlers that require filesystem, SQLite, OAuth, or YouTube API access
// MUST be placed here in the main process. The renderer never obtains direct
// access to these capabilities — it communicates exclusively via IPC.
// ---------------------------------------------------------------------------

const handlers = {
  // ---- App utility --------------------------------------------------------

  [CHANNELS.APP_PING]: async (_event, _payload) => {
    return 'pong'
  },

  [CHANNELS.APP_GET_VERSION]: async (_event, _payload) => {
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    }
  },

  // ---- Auth  (stubs — implementation deferred to auth issue) --------------

  [CHANNELS.AUTH_IMPORT_CREDENTIALS]: async (_event, _payload) => {
    // TODO: read the JSON file at payload.filePath, validate its shape,
    //       store encrypted credentials with safeStorage.
    throw new Error('Not yet implemented')
  },

  [CHANNELS.AUTH_START_OAUTH]: async (_event, _payload) => {
    // TODO: launch PKCE flow in the system browser with a loopback redirect.
    throw new Error('Not yet implemented')
  },

  [CHANNELS.AUTH_GET_STATUS]: async (_event, _payload) => {
    // TODO: return { authenticated: bool, channelId: string | null }
    return { authenticated: false, channelId: null }
  },

  [CHANNELS.AUTH_SIGN_OUT]: async (_event, _payload) => {
    // TODO: revoke token, clear safeStorage entry.
    throw new Error('Not yet implemented')
  },

  // ---- Channel info  (stub) -----------------------------------------------

  [CHANNELS.CHANNEL_GET_INFO]: async (_event, _payload) => {
    // TODO: call YouTube API channels.list with stored credentials.
    throw new Error('Not yet implemented')
  },

  // ---- Queue  (stubs) -----------------------------------------------------

  [CHANNELS.QUEUE_LIST]: async (_event, _payload) => {
    // TODO: query SQLite queue table.
    return []
  },

  [CHANNELS.QUEUE_ADD]: async (_event, _payload) => {
    // TODO: insert record into SQLite, fingerprint the file.
    throw new Error('Not yet implemented')
  },

  [CHANNELS.QUEUE_REMOVE]: async (_event, _payload) => {
    // TODO: remove record from SQLite.
    throw new Error('Not yet implemented')
  },

  [CHANNELS.QUEUE_REORDER]: async (_event, _payload) => {
    // TODO: update sort order in SQLite.
    throw new Error('Not yet implemented')
  },

  [CHANNELS.QUEUE_UPDATE]: async (_event, _payload) => {
    // TODO: update editable metadata in SQLite.
    throw new Error('Not yet implemented')
  },

  // ---- Upload control  (stubs) --------------------------------------------

  [CHANNELS.UPLOAD_START]: async (_event, _payload) => {
    // TODO: begin sequential upload from queue.
    throw new Error('Not yet implemented')
  },

  [CHANNELS.UPLOAD_PAUSE]: async (_event, _payload) => {
    throw new Error('Not yet implemented')
  },

  [CHANNELS.UPLOAD_RESUME]: async (_event, _payload) => {
    throw new Error('Not yet implemented')
  },

  [CHANNELS.UPLOAD_CANCEL]: async (_event, _payload) => {
    throw new Error('Not yet implemented')
  },

  // ---- Metadata  (stubs) --------------------------------------------------

  [CHANNELS.METADATA_GET_CATEGORIES]: async (_event, _payload) => {
    // TODO: return cached / refreshed YouTube video categories.
    return []
  },

  [CHANNELS.METADATA_GET_PLAYLISTS]: async (_event, _payload) => {
    // TODO: return cached / refreshed playlists for the active channel.
    return []
  },
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers a validated ipcMain.handle for every channel defined in
 * INVOKE_CHANNELS.  Call once during app 'ready'.
 *
 * Only channels listed in INVOKE_CHANNELS are registered; any channel
 * not in that set will simply receive no response from the main process.
 */
export function setupIpcHandlers() {
  for (const channel of INVOKE_CHANNELS) {
    const handler = handlers[channel]
    if (!handler) {
      console.warn(`[ipc] No handler registered for invoke channel: ${channel}`)
      continue
    }
    ipcMain.handle(channel, createValidatedHandler(channel, handler))
  }

  console.log(`[ipc] Registered ${INVOKE_CHANNELS.size} validated IPC handlers.`)
}
