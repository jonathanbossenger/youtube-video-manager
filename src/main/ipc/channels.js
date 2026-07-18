/**
 * IPC Channel Contract
 *
 * Defines every allowed channel between the renderer and main processes.
 * No channel outside this list is registered in the main process, so
 * arbitrary ipcRenderer.invoke / ipcRenderer.send calls from the renderer
 * will simply receive no response.
 *
 * Channel naming convention:  domain:action
 *
 * INVOKE_CHANNELS  — request/response patterns (ipcRenderer.invoke)
 * EVENT_CHANNELS   — one-way push from main → renderer (webContents.send)
 */

// ---------------------------------------------------------------------------
// Channel name constants
// ---------------------------------------------------------------------------

export const CHANNELS = {
  // App utility
  APP_PING: 'app:ping',
  APP_GET_VERSION: 'app:get-version',

  // Auth / OAuth  (implementation deferred to auth issue)
  AUTH_IMPORT_CREDENTIALS: 'auth:import-credentials',
  AUTH_START_OAUTH: 'auth:start-oauth',
  AUTH_GET_STATUS: 'auth:get-status',
  AUTH_SIGN_OUT: 'auth:sign-out',

  // Channel info  (implementation deferred)
  CHANNEL_GET_INFO: 'channel:get-info',

  // Queue management  (implementation deferred)
  QUEUE_LIST: 'queue:list',
  QUEUE_ADD: 'queue:add',
  QUEUE_REMOVE: 'queue:remove',
  QUEUE_REORDER: 'queue:reorder',
  QUEUE_UPDATE: 'queue:update',

  // Upload control  (implementation deferred)
  UPLOAD_START: 'upload:start',
  UPLOAD_PAUSE: 'upload:pause',
  UPLOAD_RESUME: 'upload:resume',
  UPLOAD_CANCEL: 'upload:cancel',

  // Metadata lookups  (implementation deferred)
  METADATA_GET_CATEGORIES: 'metadata:get-categories',
  METADATA_GET_PLAYLISTS: 'metadata:get-playlists',

  // Push events: main → renderer  (not invocable)
  UPLOAD_PROGRESS: 'upload:progress',
  UPLOAD_STATUS_CHANGED: 'upload:status-changed',
}

// ---------------------------------------------------------------------------
// Channel sets
// ---------------------------------------------------------------------------

/**
 * Channels that must be called with ipcRenderer.invoke (request/response).
 * The main process registers ipcMain.handle for each of these.
 */
export const INVOKE_CHANNELS = new Set([
  CHANNELS.APP_PING,
  CHANNELS.APP_GET_VERSION,
  CHANNELS.AUTH_IMPORT_CREDENTIALS,
  CHANNELS.AUTH_START_OAUTH,
  CHANNELS.AUTH_GET_STATUS,
  CHANNELS.AUTH_SIGN_OUT,
  CHANNELS.CHANNEL_GET_INFO,
  CHANNELS.QUEUE_LIST,
  CHANNELS.QUEUE_ADD,
  CHANNELS.QUEUE_REMOVE,
  CHANNELS.QUEUE_REORDER,
  CHANNELS.QUEUE_UPDATE,
  CHANNELS.UPLOAD_START,
  CHANNELS.UPLOAD_PAUSE,
  CHANNELS.UPLOAD_RESUME,
  CHANNELS.UPLOAD_CANCEL,
  CHANNELS.METADATA_GET_CATEGORIES,
  CHANNELS.METADATA_GET_PLAYLISTS,
])

/**
 * Channels used for unsolicited push events from main → renderer.
 * The preload exposes these through ipcRenderer.on subscriptions only;
 * the renderer cannot invoke them.
 */
export const EVENT_CHANNELS = new Set([
  CHANNELS.UPLOAD_PROGRESS,
  CHANNELS.UPLOAD_STATUS_CHANGED,
])

// ---------------------------------------------------------------------------
// Payload validators
// ---------------------------------------------------------------------------

/**
 * Validates the payload for a given INVOKE_CHANNEL before the handler runs.
 *
 * Each validator receives the raw payload and either:
 *   - returns true   (payload is acceptable)
 *   - throws Error   (payload is rejected; the error message is returned to
 *                     the renderer as { error: string })
 *
 * Validators for channels whose payloads carry no data always return true;
 * they act as documentation of the expected call signature.
 */
export const CHANNEL_VALIDATORS = {
  // ---- App utility --------------------------------------------------------
  [CHANNELS.APP_PING]: (_payload) => true,
  [CHANNELS.APP_GET_VERSION]: (_payload) => true,

  // ---- Auth ---------------------------------------------------------------
  [CHANNELS.AUTH_IMPORT_CREDENTIALS]: (payload) => {
    if (!payload || typeof payload.filePath !== 'string' || !payload.filePath) {
      throw new Error('auth:import-credentials requires { filePath: string }')
    }
    return true
  },
  [CHANNELS.AUTH_START_OAUTH]: (_payload) => true,
  [CHANNELS.AUTH_GET_STATUS]: (_payload) => true,
  [CHANNELS.AUTH_SIGN_OUT]: (_payload) => true,

  // ---- Channel info -------------------------------------------------------
  [CHANNELS.CHANNEL_GET_INFO]: (_payload) => true,

  // ---- Queue --------------------------------------------------------------
  [CHANNELS.QUEUE_LIST]: (_payload) => true,
  [CHANNELS.QUEUE_ADD]: (payload) => {
    if (!payload || typeof payload.filePath !== 'string' || !payload.filePath) {
      throw new Error('queue:add requires { filePath: string, metadata: object }')
    }
    if (!payload.metadata || typeof payload.metadata !== 'object') {
      throw new Error('queue:add requires { filePath: string, metadata: object }')
    }
    return true
  },
  [CHANNELS.QUEUE_REMOVE]: (payload) => {
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      throw new Error('queue:remove requires { id: string }')
    }
    return true
  },
  [CHANNELS.QUEUE_REORDER]: (payload) => {
    if (!payload || !Array.isArray(payload.ids) || payload.ids.length === 0) {
      throw new Error('queue:reorder requires { ids: string[] }')
    }
    if (payload.ids.some((id) => typeof id !== 'string')) {
      throw new Error('queue:reorder — every element of ids must be a string')
    }
    return true
  },
  [CHANNELS.QUEUE_UPDATE]: (payload) => {
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      throw new Error('queue:update requires { id: string, ...changes }')
    }
    return true
  },

  // ---- Upload control -----------------------------------------------------
  [CHANNELS.UPLOAD_START]: (_payload) => true,
  [CHANNELS.UPLOAD_PAUSE]: (payload) => {
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      throw new Error('upload:pause requires { id: string }')
    }
    return true
  },
  [CHANNELS.UPLOAD_RESUME]: (payload) => {
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      throw new Error('upload:resume requires { id: string }')
    }
    return true
  },
  [CHANNELS.UPLOAD_CANCEL]: (payload) => {
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      throw new Error('upload:cancel requires { id: string }')
    }
    return true
  },

  // ---- Metadata -----------------------------------------------------------
  [CHANNELS.METADATA_GET_CATEGORIES]: (_payload) => true,
  [CHANNELS.METADATA_GET_PLAYLISTS]: (_payload) => true,
}
