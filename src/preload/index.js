import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import {
  CHANNELS,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  CHANNEL_REQUEST_SCHEMAS,
  CHANNEL_RESPONSE_SCHEMAS,
  CHANNEL_EVENT_SCHEMAS,
  YOUTUBE_MANAGER_API_CONTRACT,
} from '../main/ipc/channels.js'

const invokeEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict()

function safeInvoke(channel, payload) {
  if (!INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`[preload] Blocked invoke on unknown channel: ${channel}`))
  }

  const requestSchema = CHANNEL_REQUEST_SCHEMAS[channel]
  const responseSchema = CHANNEL_RESPONSE_SCHEMAS[channel]

  if (!requestSchema || !responseSchema) {
    return Promise.reject(new Error(`[preload] No schema contract found for channel: ${channel}`))
  }

  const parsedPayload = requestSchema.parse(payload)

  return ipcRenderer.invoke(channel, parsedPayload).then((response) => {
    const parsedResponse = invokeEnvelopeSchema.parse(response)
    if (!parsedResponse.ok) {
      return parsedResponse
    }

    return {
      ok: true,
      data: responseSchema.parse(parsedResponse.data ?? null),
    }
  })
}

function safeOn(channel, listener) {
  if (typeof listener !== 'function') {
    throw new TypeError(`[preload] Listener for channel "${channel}" must be a function`)
  }

  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`[preload] Blocked subscription on unknown event channel: ${channel}`)
  }

  const eventSchema = CHANNEL_EVENT_SCHEMAS[channel]
  if (!eventSchema) {
    throw new Error(`[preload] No event schema contract found for channel: ${channel}`)
  }

  const wrappedListener = (_event, payload) => listener(eventSchema.parse(payload))
  ipcRenderer.on(channel, wrappedListener)

  return () => ipcRenderer.removeListener(channel, wrappedListener)
}

const youtubeManagerAPI = {
  contract: YOUTUBE_MANAGER_API_CONTRACT,

  // ---- App utility --------------------------------------------------------

  ping: () => safeInvoke(CHANNELS.APP_PING),
  getVersion: () => safeInvoke(CHANNELS.APP_GET_VERSION),

  // ---- Auth ---------------------------------------------------------------

  importCredentials: (filePath) =>
    safeInvoke(CHANNELS.AUTH_IMPORT_CREDENTIALS, { filePath }),
  startOAuth: () => safeInvoke(CHANNELS.AUTH_START_OAUTH),
  getAuthStatus: () => safeInvoke(CHANNELS.AUTH_GET_STATUS),
  signOut: () => safeInvoke(CHANNELS.AUTH_SIGN_OUT),

  // ---- Channel info -------------------------------------------------------

  getChannelInfo: () => safeInvoke(CHANNELS.CHANNEL_GET_INFO),

  // ---- Queue management ---------------------------------------------------

  listQueue: () => safeInvoke(CHANNELS.QUEUE_LIST),
  addToQueue: (filePath, metadata = {}) =>
    safeInvoke(CHANNELS.QUEUE_ADD, { filePath, metadata }),
  removeFromQueue: (id) => safeInvoke(CHANNELS.QUEUE_REMOVE, { id }),
  reorderQueue: (ids) => safeInvoke(CHANNELS.QUEUE_REORDER, { ids }),
  updateJob: (id, changes = {}) => safeInvoke(CHANNELS.QUEUE_UPDATE, { id, ...changes }),

  // ---- Upload control -----------------------------------------------------

  startUpload: () => safeInvoke(CHANNELS.UPLOAD_START),
  pauseUpload: (id) => safeInvoke(CHANNELS.UPLOAD_PAUSE, { id }),
  resumeUpload: (id) => safeInvoke(CHANNELS.UPLOAD_RESUME, { id }),
  cancelUpload: (id) => safeInvoke(CHANNELS.UPLOAD_CANCEL, { id }),

  // ---- Metadata -----------------------------------------------------------

  getCategories: () => safeInvoke(CHANNELS.METADATA_GET_CATEGORIES),
  getPlaylists: () => safeInvoke(CHANNELS.METADATA_GET_PLAYLISTS),

  // ---- Push event subscriptions -------------------------------------------

  onUploadProgress: (listener) => safeOn(CHANNELS.UPLOAD_PROGRESS, listener),
  onUploadStatusChanged: (listener) => safeOn(CHANNELS.UPLOAD_STATUS_CHANGED, listener),
}

contextBridge.exposeInMainWorld('youtubeManager', youtubeManagerAPI)
