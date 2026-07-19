import { ipcMain, app, dialog } from 'electron'
import {
  CHANNELS,
  INVOKE_CHANNELS,
  CHANNEL_REQUEST_SCHEMAS,
  CHANNEL_RESPONSE_SCHEMAS,
  CHANNEL_EVENT_SCHEMAS,
} from './channels.js'
import { getYouTubeManagerStore } from '../persistence/index.js'
import { performOAuthFlow } from '../auth/oauth.js'
import {
  isEncryptionAvailable,
  encryptToken,
  setInMemoryToken,
  clearInMemoryToken,
} from '../auth/token-storage.js'

function serializeErrorMessage(error) {
  if (Array.isArray(error?.issues)) {
    return error.issues
      .map((issue) => `${issue.path.length ? issue.path.join('.') : 'payload'}: ${issue.message}`)
      .join('; ')
  }

  return error instanceof Error ? error.message : String(error)
}

/**
 * Wraps a handler function with payload validation, response validation, and
 * uniform error serialisation so individual handlers never need to guard
 * themselves.
 *
 * @param {string} channel   - The IPC channel name.
 * @param {Function} handler - Async function (event, payload) => result.
 * @returns {Function}       - Validated handler suitable for ipcMain.handle.
 */
function createValidatedHandler(channel, handler) {
  const requestSchema = CHANNEL_REQUEST_SCHEMAS[channel]
  const responseSchema = CHANNEL_RESPONSE_SCHEMAS[channel]

  if (!requestSchema) {
    throw new Error(
      `[ipc] No request schema found for channel "${channel}". ` +
        'Add an entry to CHANNEL_REQUEST_SCHEMAS in channels.js.'
    )
  }

  if (!responseSchema) {
    throw new Error(
      `[ipc] No response schema found for channel "${channel}". ` +
        'Add an entry to CHANNEL_RESPONSE_SCHEMAS in channels.js.'
    )
  }

  return async (event, payload) => {
    try {
      payload = requestSchema.parse(payload)
    } catch (validationError) {
      return { ok: false, error: serializeErrorMessage(validationError) }
    }

    try {
      const result = await handler(event, payload)
      return { ok: true, data: responseSchema.parse(result ?? null) }
    } catch (handlerError) {
      console.error(`[ipc] handler error on ${channel}:`, handlerError)
      return { ok: false, error: serializeErrorMessage(handlerError) }
    }
  }
}

function emitValidatedEvent(sender, channel, payload) {
  const schema = CHANNEL_EVENT_SCHEMAS[channel]
  if (!schema) {
    throw new Error(`[ipc] No event schema found for channel "${channel}"`)
  }

  sender.send(channel, schema.parse(payload))
}

function emitStatusChanged(sender, queueItem) {
  emitValidatedEvent(sender, CHANNELS.UPLOAD_STATUS_CHANGED, {
    id: queueItem.id,
    status: queueItem.status,
    error: queueItem.lastError,
  })
}

function emitUploadProgress(sender, queueItem) {
  emitValidatedEvent(sender, CHANNELS.UPLOAD_PROGRESS, {
    id: queueItem.id,
    bytesUploaded: queueItem.resumableSession?.uploadedBytes ?? 0,
    totalBytes:
      queueItem.resumableSession?.totalBytes ??
      queueItem.asset.fingerprint.fileSizeBytes,
  })
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

const handlers = {
  [CHANNELS.APP_PING]: async () => 'pong',

  [CHANNELS.APP_GET_VERSION]: async () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),

  [CHANNELS.AUTH_IMPORT_CREDENTIALS]: async (_event, payload) => {
    return getYouTubeManagerStore().importCredentials(payload.filePath)
  },

  [CHANNELS.AUTH_START_OAUTH]: async () => {
    const store = getYouTubeManagerStore()
    const credentials = store.getRawCredentials()

    if (!credentials) {
      throw new Error(
        'No OAuth credentials found. ' +
          'Please import a Google Desktop OAuth JSON file before signing in.'
      )
    }

    const { channel, tokens } = await performOAuthFlow(credentials)

    // Determine how to store the refresh token.
    let refreshTokenCiphertext = null

    if (tokens.refresh_token) {
      if (isEncryptionAvailable()) {
        // Secure path: encrypt and persist the token.
        refreshTokenCiphertext = encryptToken(tokens.refresh_token)
      } else {
        // Fallback: keep the token in memory only for this session.
        setInMemoryToken(tokens.refresh_token)
        console.warn(
          '[auth] safeStorage is unavailable — refresh token retained in memory only.'
        )
      }
    }

    // Compute token expiry timestamp.
    const accessTokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null

    const scopes = tokens.scope ? tokens.scope.split(' ') : []

    return store.saveSession({
      channelId: channel.channelId,
      channelTitle: channel.title,
      channelThumbnailUrl: channel.thumbnailUrl,
      refreshTokenCiphertext,
      scopes,
      accessTokenExpiresAt,
    })
  },

  [CHANNELS.AUTH_GET_STATUS]: async () => {
    return getYouTubeManagerStore().getAuthSnapshot()
  },

  [CHANNELS.AUTH_SIGN_OUT]: async () => {
    clearInMemoryToken()
    return getYouTubeManagerStore().clearAuthState()
  },

  [CHANNELS.CHANNEL_GET_INFO]: async () => {
    return getYouTubeManagerStore().getChannelInfo()
  },

  [CHANNELS.CHANNEL_RESET_BINDING]: async () => {
    clearInMemoryToken()
    return getYouTubeManagerStore().resetChannelBinding()
  },

  [CHANNELS.DIALOG_OPEN_FILE]: async (_event, payload) => {
    const filters = payload?.filters ?? [{ name: 'All Files', extensions: ['*'] }]
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
    })

    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  },

  [CHANNELS.QUEUE_LIST]: async () => {
    return getYouTubeManagerStore().listQueueItems()
  },

  [CHANNELS.QUEUE_ADD]: async (_event, payload) => {
    return getYouTubeManagerStore().addQueueItem(payload.filePath, payload.metadata)
  },

  [CHANNELS.QUEUE_REMOVE]: async (_event, payload) => {
    return getYouTubeManagerStore().removeQueueItem(payload.id)
  },

  [CHANNELS.QUEUE_REORDER]: async (_event, payload) => {
    return getYouTubeManagerStore().reorderQueue(payload.ids)
  },

  [CHANNELS.QUEUE_UPDATE]: async (_event, payload) => {
    const { id, ...changes } = payload
    return getYouTubeManagerStore().updateQueueItem(id, changes)
  },

  [CHANNELS.UPLOAD_START]: async (event) => {
    const queueItem = getYouTubeManagerStore().startNextUpload()
    if (queueItem) {
      emitStatusChanged(event.sender, queueItem)
      emitUploadProgress(event.sender, queueItem)
    }
    return queueItem
  },

  [CHANNELS.UPLOAD_PAUSE]: async (event, payload) => {
    const queueItem = getYouTubeManagerStore().pauseUpload(payload.id)
    emitStatusChanged(event.sender, queueItem)
    return queueItem
  },

  [CHANNELS.UPLOAD_RESUME]: async (event, payload) => {
    const queueItem = getYouTubeManagerStore().resumeUpload(payload.id)
    emitStatusChanged(event.sender, queueItem)
    emitUploadProgress(event.sender, queueItem)
    return queueItem
  },

  [CHANNELS.UPLOAD_CANCEL]: async (event, payload) => {
    const queueItem = getYouTubeManagerStore().cancelUpload(payload.id)
    emitStatusChanged(event.sender, queueItem)
    return queueItem
  },

  [CHANNELS.METADATA_GET_CATEGORIES]: async () => [],

  [CHANNELS.METADATA_GET_PLAYLISTS]: async () => [],
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

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
