import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, EVENT_CHANNELS, INVOKE_CHANNELS } from '../main/ipc/channels.js'

// ---------------------------------------------------------------------------
// Security guard helpers
// ---------------------------------------------------------------------------

/**
 * Wraps ipcRenderer.invoke so the renderer can only call channels that are
 * explicitly listed in INVOKE_CHANNELS.  Any attempt to invoke an unknown
 * channel is rejected without reaching the main process.
 *
 * @param {string} channel
 * @param {unknown} [payload]
 * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}
 */
function safeInvoke(channel, payload) {
  if (!INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`[preload] Blocked invoke on unknown channel: ${channel}`))
  }
  return ipcRenderer.invoke(channel, payload)
}

/**
 * Subscribes to a one-way push event from the main process.
 * Only channels listed in EVENT_CHANNELS may be subscribed to.
 *
 * @param {string} channel
 * @param {Function} listener  - Called with the event payload.
 * @returns {Function}          - Unsubscribe function.
 */
function safeOn(channel, listener) {
  if (typeof listener !== 'function') {
    throw new TypeError(`[preload] Listener for channel "${channel}" must be a function`)
  }

  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`[preload] Blocked subscription on unknown event channel: ${channel}`)
  }
  // Wrap the listener to strip the Electron Event object before handing data
  // to the renderer — the renderer never needs the raw IPC event.
  const wrappedListener = (_event, ...args) => listener(...args)
  ipcRenderer.on(channel, wrappedListener)

  // Return an unsubscribe helper so the renderer can clean up.
  return () => ipcRenderer.removeListener(channel, wrappedListener)
}

// ---------------------------------------------------------------------------
// window.youtubeManager API
//
// Only the explicitly listed methods below are available to renderer code.
// The renderer has no access to ipcRenderer, Node.js, or any main-process
// capability beyond what is exposed here.
// ---------------------------------------------------------------------------

const youtubeManagerAPI = {
  // ---- App utility --------------------------------------------------------

  /** Returns 'pong' — useful for connectivity checks. */
  ping: () => safeInvoke(CHANNELS.APP_PING),

  /** Returns version information for the app, Electron, Chrome, and Node. */
  getVersion: () => safeInvoke(CHANNELS.APP_GET_VERSION),

  // ---- Auth ---------------------------------------------------------------

  /**
   * Import a Google Desktop OAuth JSON credentials file.
   * @param {string} filePath  Absolute path to the credentials JSON file.
   */
  importCredentials: (filePath) =>
    safeInvoke(CHANNELS.AUTH_IMPORT_CREDENTIALS, { filePath }),

  /** Launch the OAuth PKCE flow in the system browser. */
  startOAuth: () => safeInvoke(CHANNELS.AUTH_START_OAUTH),

  /** Returns { authenticated: boolean, channelId: string | null }. */
  getAuthStatus: () => safeInvoke(CHANNELS.AUTH_GET_STATUS),

  /** Revoke the stored OAuth token and clear credentials. */
  signOut: () => safeInvoke(CHANNELS.AUTH_SIGN_OUT),

  // ---- Channel info -------------------------------------------------------

  /** Returns YouTube channel metadata for the authenticated account. */
  getChannelInfo: () => safeInvoke(CHANNELS.CHANNEL_GET_INFO),

  // ---- Queue management ---------------------------------------------------

  /** Returns the full upload queue as an array of job records. */
  listQueue: () => safeInvoke(CHANNELS.QUEUE_LIST),

  /**
   * Add a new video to the queue.
   * @param {string} filePath   Absolute path to the video file.
   * @param {object} metadata   Title, description, tags, etc.
   */
  addToQueue: (filePath, metadata) =>
    safeInvoke(CHANNELS.QUEUE_ADD, { filePath, metadata }),

  /**
   * Remove a job from the queue.
   * @param {string} id  Job ID.
   */
  removeFromQueue: (id) => safeInvoke(CHANNELS.QUEUE_REMOVE, { id }),

  /**
   * Reorder queue jobs.
   * @param {string[]} ids  Job IDs in the desired order.
   */
  reorderQueue: (ids) => safeInvoke(CHANNELS.QUEUE_REORDER, { ids }),

  /**
   * Update editable metadata for a queued job.
   * @param {string} id       Job ID.
   * @param {object} changes  Fields to update.
   */
  updateJob: (id, changes) => safeInvoke(CHANNELS.QUEUE_UPDATE, { id, ...changes }),

  // ---- Upload control -----------------------------------------------------

  /** Begin processing the upload queue. */
  startUpload: () => safeInvoke(CHANNELS.UPLOAD_START),

  /** Pause the active upload. @param {string} id  Job ID. */
  pauseUpload: (id) => safeInvoke(CHANNELS.UPLOAD_PAUSE, { id }),

  /** Resume a paused upload. @param {string} id  Job ID. */
  resumeUpload: (id) => safeInvoke(CHANNELS.UPLOAD_RESUME, { id }),

  /** Cancel an upload. @param {string} id  Job ID. */
  cancelUpload: (id) => safeInvoke(CHANNELS.UPLOAD_CANCEL, { id }),

  // ---- Metadata -----------------------------------------------------------

  /** Returns an array of YouTube video categories. */
  getCategories: () => safeInvoke(CHANNELS.METADATA_GET_CATEGORIES),

  /** Returns an array of playlists for the authenticated channel. */
  getPlaylists: () => safeInvoke(CHANNELS.METADATA_GET_PLAYLISTS),

  // ---- Push event subscriptions -------------------------------------------

  /**
   * Subscribe to upload progress events.
   * @param {Function} listener  Called with { id, bytesUploaded, totalBytes }.
   * @returns {Function}          Unsubscribe function.
   */
  onUploadProgress: (listener) => safeOn(CHANNELS.UPLOAD_PROGRESS, listener),

  /**
   * Subscribe to upload status-change events.
   * @param {Function} listener  Called with { id, status, error? }.
   * @returns {Function}          Unsubscribe function.
   */
  onUploadStatusChanged: (listener) => safeOn(CHANNELS.UPLOAD_STATUS_CHANGED, listener),
}

// Expose the API to the renderer under window.youtubeManager.
// Nothing else from Node.js or Electron is reachable from renderer code.
contextBridge.exposeInMainWorld('youtubeManager', youtubeManagerAPI)
