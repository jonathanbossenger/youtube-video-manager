import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import {
  queueItemRecordSchema,
  queueListSchema,
  authSnapshotSchema,
  authCredentialsRecordSchema,
  authSessionRecordSchema,
  channelInfoSchema,
  googleDesktopOAuthCredentialsSchema,
  queueMetadataInputSchema,
  queueMetadataUpdateSchema,
  UPLOAD_STEP_NAMES,
  queueRemovalResultSchema,
} from '../../shared/youtube-manager-contract.js'

const DEFAULT_AUTH_SESSION_ID = 1
const EDITABLE_QUEUE_STATUSES = ['draft', 'ready']
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS auth_credentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    client_id TEXT NOT NULL,
    project_id TEXT,
    auth_uri TEXT NOT NULL,
    token_uri TEXT NOT NULL,
    redirect_uris_json TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_session (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    refresh_token_ciphertext TEXT,
    access_token_expires_at TEXT,
    last_authenticated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS queue_items (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    source_thumbnail_path TEXT,
    source_caption_path TEXT,
    source_caption_language TEXT,
    source_caption_name TEXT,
    source_caption_is_draft INTEGER NOT NULL DEFAULT 0,
    fingerprint_algorithm TEXT NOT NULL,
    fingerprint_digest TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_mtime_utc TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    category_id TEXT,
    playlist_id TEXT,
    privacy_status TEXT NOT NULL,
    made_for_kids INTEGER NOT NULL DEFAULT 0,
    notify_subscribers INTEGER NOT NULL DEFAULT 1,
    synthetic_media INTEGER NOT NULL DEFAULT 0,
    publish_at_utc TEXT,
    source_timezone TEXT,
    resumable_session_url TEXT,
    resumable_uploaded_bytes INTEGER,
    resumable_total_bytes INTEGER,
    resumable_updated_at TEXT,
    resumable_last_status_code INTEGER,
    youtube_video_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS upload_steps (
    id TEXT PRIMARY KEY,
    queue_item_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    status TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (queue_item_id) REFERENCES queue_items(id) ON DELETE CASCADE,
    UNIQUE (queue_item_id, step_name)
  );
`

function nowUtc() {
  return new Date().toISOString()
}

function parseJson(text, fallback) {
  if (!text) {
    return fallback
  }

  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function toNullableText(value) {
  return value ?? null
}

function deriveDraftStatus(metadata) {
  // File existence is validated before insertion, and schedule fields are
  // enforced by the Zod contract. Title is therefore the remaining piece of
  // user-authored metadata required before a queue item can become ready.
  return metadata.title ? 'ready' : 'draft'
}

function formatTransitionError(id, currentStatus, nextStatus) {
  return `Cannot transition queue item ${id} from "${currentStatus}" to "${nextStatus}"`
}

function ensureLocalFile(filePath) {
  const stats = fs.statSync(filePath)
  if (!stats.isFile()) {
    throw new Error(`Expected a file at ${filePath}`)
  }
  return stats
}

function createFileFingerprint(filePath, stats) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () =>
      resolve({
        algorithm: 'sha256',
        digest: hash.digest('hex'),
        fileSizeBytes: stats.size,
        lastModifiedUtc: new Date(stats.mtimeMs).toISOString(),
      })
    )
  })
}

function buildCaptionTrack(metadata) {
  if (!metadata.captionTrack) {
    return null
  }

  return {
    path: metadata.captionTrack.path,
    language: metadata.captionTrack.language,
    name: metadata.captionTrack.name,
    isDraft: metadata.captionTrack.isDraft,
  }
}

function rowToCredentialsRecord(row) {
  if (!row) {
    return null
  }

  return authCredentialsRecordSchema.parse({
    clientId: row.client_id,
    projectId: row.project_id ?? null,
    authUri: row.auth_uri,
    tokenUri: row.token_uri,
    redirectUris: parseJson(row.redirect_uris_json, []),
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  })
}

function rowToSessionRecord(row) {
  const timestamp = nowUtc()

  return authSessionRecordSchema.parse({
    channelId: row?.channel_id ?? null,
    scopes: parseJson(row?.scopes_json, []),
    hasRefreshToken: Boolean(row?.refresh_token_ciphertext),
    accessTokenExpiresAt: row?.access_token_expires_at ?? null,
    lastAuthenticatedAt: row?.last_authenticated_at ?? null,
    createdAt: row?.created_at ?? timestamp,
    updatedAt: row?.updated_at ?? timestamp,
  })
}

function rowToQueueItem(row, stepRows) {
  const captionTrack = row.source_caption_path
    ? {
        path: row.source_caption_path,
        language: row.source_caption_language,
        name: row.source_caption_name,
        isDraft: Boolean(row.source_caption_is_draft),
      }
    : null

  const steps = stepRows
    .filter((stepRow) => stepRow.queue_item_id === row.id)
    .map((stepRow) => ({
      id: stepRow.id,
      queueItemId: stepRow.queue_item_id,
      stepName: stepRow.step_name,
      status: stepRow.status,
      retryCount: stepRow.retry_count,
      lastError: stepRow.last_error ?? null,
      startedAt: stepRow.started_at ?? null,
      completedAt: stepRow.completed_at ?? null,
      updatedAt: stepRow.updated_at,
    }))

  return queueItemRecordSchema.parse({
    id: row.id,
    sortOrder: row.sort_order,
    status: row.status,
    asset: {
      filePath: row.source_file_path,
      thumbnailPath: row.source_thumbnail_path ?? null,
      captionTrack,
      fingerprint: {
        algorithm: row.fingerprint_algorithm,
        digest: row.fingerprint_digest,
        fileSizeBytes: row.file_size_bytes,
        lastModifiedUtc: row.file_mtime_utc,
      },
    },
    metadata: {
      title: row.title,
      description: row.description,
      tags: parseJson(row.tags_json, []),
      categoryId: row.category_id ?? null,
      playlistId: row.playlist_id ?? null,
      privacyStatus: row.privacy_status,
      madeForKids: Boolean(row.made_for_kids),
      notifySubscribers: Boolean(row.notify_subscribers),
      syntheticMedia: Boolean(row.synthetic_media),
    },
    schedule: {
      publishAtUtc: row.publish_at_utc ?? null,
      sourceTimezone: row.source_timezone ?? null,
    },
    resumableSession: row.resumable_session_url
      ? {
          sessionUrl: row.resumable_session_url,
          uploadedBytes: row.resumable_uploaded_bytes ?? 0,
          totalBytes: row.resumable_total_bytes ?? row.file_size_bytes,
          updatedAt: row.resumable_updated_at ?? row.updated_at,
          lastStatusCode: row.resumable_last_status_code ?? null,
        }
      : null,
    youtube: {
      videoId: row.youtube_video_id ?? null,
    },
    steps,
    retryCount: row.retry_count,
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function buildStepRows(queueItemId, timestamp) {
  return UPLOAD_STEP_NAMES.map((stepName) => ({
    id: randomUUID(),
    queue_item_id: queueItemId,
    step_name: stepName,
    status: 'pending',
    retry_count: 0,
    last_error: null,
    started_at: null,
    completed_at: null,
    updated_at: timestamp,
  }))
}

function mergeQueueMetadata(existingItem, changes) {
  const merged = {
    ...existingItem.metadata,
    thumbnailPath: existingItem.asset.thumbnailPath,
    captionTrack: existingItem.asset.captionTrack,
    publishAtUtc: existingItem.schedule.publishAtUtc,
    sourceTimezone: existingItem.schedule.sourceTimezone,
    ...changes,
  }

  return queueMetadataInputSchema.parse(merged)
}

export class YouTubeManagerStore {
  constructor(database) {
    this.database = database
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('foreign_keys = ON')
    this.database.exec(SCHEMA_SQL)

    // ---- Schema migrations -------------------------------------------------
    // SQLite does not support `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we
    // attempt each addition and silently ignore the "duplicate column" error.
    this._addColumnIfMissing('auth_session', 'channel_title', 'TEXT')
    this._addColumnIfMissing('auth_session', 'channel_thumbnail_url', 'TEXT')
    this.insertUploadStepStatement = this.database.prepare(
      `
        INSERT INTO upload_steps (
          id,
          queue_item_id,
          step_name,
          status,
          retry_count,
          last_error,
          started_at,
          completed_at,
          updated_at
        ) VALUES (@id, @queue_item_id, @step_name, @status, @retry_count, @last_error, @started_at, @completed_at, @updated_at)
      `
    )
    this.insertUploadStepsTransaction = this.database.transaction((stepRows) => {
      for (const stepRow of stepRows) {
        this.insertUploadStepStatement.run(stepRow)
      }
    })
    this.reorderQueueItemStatement = this.database.prepare(
      'UPDATE queue_items SET sort_order = ?, updated_at = ? WHERE id = ?'
    )
    this.reorderQueueItemsTransaction = this.database.transaction((orderedIds, timestamp) => {
      orderedIds.forEach((id, index) => {
        this.reorderQueueItemStatement.run(index, timestamp, id)
      })
    })
  }

  close() {
    this.database.close()
  }

  // ---------------------------------------------------------------------------
  // Schema migration helper
  // ---------------------------------------------------------------------------

  /**
   * Adds a column to an existing table if it does not already exist.
   * SQLite's "duplicate column" error (SQLITE_ERROR) is caught and ignored.
   * The table name, column name, and type are validated against simple
   * allowlists to prevent accidental SQL injection should this helper ever
   * be called with dynamic values.
   *
   * @param {string} table
   * @param {string} column
   * @param {string} type   SQL type string, e.g. 'TEXT'.
   */
  _addColumnIfMissing(table, column, type) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`Invalid table name: ${table}`)
    if (!/^[a-z_][a-z0-9_]*$/i.test(column)) throw new Error(`Invalid column name: ${column}`)
    const ALLOWED_TYPES = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'])
    if (!ALLOWED_TYPES.has(type.toUpperCase()))
      throw new Error(`Invalid SQL type: ${type}`)
    try {
      this.database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run()
    } catch {
      // Column already exists — ignore.
    }
  }

  ensureAuthSessionRow() {
    const existingRow = this.database
      .prepare('SELECT * FROM auth_session WHERE id = ?')
      .get(DEFAULT_AUTH_SESSION_ID)

    if (existingRow) {
      return existingRow
    }

    const timestamp = nowUtc()
    this.database
      .prepare(
        `
          INSERT INTO auth_session (
            id,
            channel_id,
            scopes_json,
            refresh_token_ciphertext,
            access_token_expires_at,
            last_authenticated_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(DEFAULT_AUTH_SESSION_ID, null, '[]', null, null, null, timestamp, timestamp)

    return this.database.prepare('SELECT * FROM auth_session WHERE id = ?').get(DEFAULT_AUTH_SESSION_ID)
  }

  getAuthSnapshot() {
    const credentialsRow = this.database
      .prepare('SELECT * FROM auth_credentials WHERE id = 1')
      .get()
    const sessionRow = this.ensureAuthSessionRow()

    return authSnapshotSchema.parse({
      authenticated: Boolean(sessionRow.channel_id && sessionRow.refresh_token_ciphertext),
      credentials: rowToCredentialsRecord(credentialsRow),
      session: rowToSessionRecord(sessionRow),
    })
  }

  importCredentials(filePath) {
    const rawCredentials = fs.readFileSync(filePath, 'utf8')
    const parsedCredentials = googleDesktopOAuthCredentialsSchema.parse(JSON.parse(rawCredentials))
    const installed = parsedCredentials.installed
    const timestamp = nowUtc()

    this.database
      .prepare(
        `
          INSERT INTO auth_credentials (
            id,
            client_id,
            project_id,
            auth_uri,
            token_uri,
            redirect_uris_json,
            raw_json,
            imported_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            client_id = excluded.client_id,
            project_id = excluded.project_id,
            auth_uri = excluded.auth_uri,
            token_uri = excluded.token_uri,
            redirect_uris_json = excluded.redirect_uris_json,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        1,
        installed.client_id,
        installed.project_id ?? null,
        installed.auth_uri,
        installed.token_uri,
        JSON.stringify(installed.redirect_uris),
        rawCredentials,
        timestamp,
        timestamp
      )

    this.ensureAuthSessionRow()

    return this.getAuthSnapshot()
  }

  clearAuthState() {
    const timestamp = nowUtc()

    this.database.prepare('DELETE FROM auth_credentials WHERE id = 1').run()
    this.database
      .prepare(
        `
          UPDATE auth_session
          SET
            channel_id = NULL,
            scopes_json = '[]',
            refresh_token_ciphertext = NULL,
            access_token_expires_at = NULL,
            last_authenticated_at = NULL,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, DEFAULT_AUTH_SESSION_ID)

    return this.getAuthSnapshot()
  }

  /**
   * Returns the raw `installed` block from the stored OAuth credentials JSON,
   * including the client_secret needed for token exchange.
   * Returns null if no credentials have been imported.
   *
   * @returns {{ clientId:string, clientSecret?:string, authUri:string, tokenUri:string } | null}
   */
  getRawCredentials() {
    const row = this.database
      .prepare('SELECT raw_json FROM auth_credentials WHERE id = 1')
      .get()

    if (!row?.raw_json) {
      return null
    }

    try {
      const parsed = googleDesktopOAuthCredentialsSchema.parse(JSON.parse(row.raw_json))
      const inst = parsed.installed
      return {
        clientId: inst.client_id,
        clientSecret: inst.client_secret ?? undefined,
        authUri: inst.auth_uri,
        tokenUri: inst.token_uri,
      }
    } catch {
      return null
    }
  }

  /**
   * Persists a completed OAuth session.  When `refreshTokenCiphertext` is null
   * (safeStorage unavailable) the DB row is stored without a token so the app
   * knows a session exists but must use the in-memory token instead.
   *
   * Also verifies channel binding: if a different channelId was previously
   * bound and the queue is non-empty, an error is thrown — the caller must
   * either empty the queue or call `resetChannelBinding` first.
   *
   * @param {{
   *   channelId: string,
   *   channelTitle: string,
   *   channelThumbnailUrl: string | null,
   *   refreshTokenCiphertext: string | null,
   *   scopes: string[],
   *   accessTokenExpiresAt: string | null,
   * }} sessionData
   * @returns {ReturnType<getAuthSnapshot>}
   */
  saveSession({
    channelId,
    channelTitle,
    channelThumbnailUrl,
    refreshTokenCiphertext,
    scopes,
    accessTokenExpiresAt,
  }) {
    // ---- Channel binding check --------------------------------------------
    const existingRow = this.ensureAuthSessionRow()
    const boundChannelId = existingRow.channel_id ?? null

    if (boundChannelId && boundChannelId !== channelId) {
      // A different channel was previously authorized.  Block the switch if
      // there are queued items that belong to the old channel.
      if (this.hasQueueItems()) {
        throw new Error(
          `This app is bound to channel "${boundChannelId}". ` +
            'Please empty your queue or reset the channel binding before authorizing a different channel.'
        )
      }
    }

    const timestamp = nowUtc()

    this.database
      .prepare(
        `
          UPDATE auth_session
          SET
            channel_id = ?,
            channel_title = ?,
            channel_thumbnail_url = ?,
            scopes_json = ?,
            refresh_token_ciphertext = ?,
            access_token_expires_at = ?,
            last_authenticated_at = ?,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        channelId,
        channelTitle,
        channelThumbnailUrl ?? null,
        JSON.stringify(scopes),
        refreshTokenCiphertext ?? null,
        accessTokenExpiresAt ?? null,
        timestamp,
        timestamp,
        DEFAULT_AUTH_SESSION_ID
      )

    return this.getAuthSnapshot()
  }

  /**
   * Returns channel info for the currently bound channel, or null if no
   * channel has been authorized yet.
   *
   * @returns {{ channelId:string, title:string, thumbnailUrl:string|null } | null}
   */
  getChannelInfo() {
    const row = this.database
      .prepare('SELECT channel_id, channel_title, channel_thumbnail_url FROM auth_session WHERE id = ?')
      .get(DEFAULT_AUTH_SESSION_ID)

    if (!row?.channel_id) {
      return null
    }

    return channelInfoSchema.parse({
      channelId: row.channel_id,
      title: row.channel_title ?? '',
      thumbnailUrl: row.channel_thumbnail_url ?? null,
    })
  }

  /**
   * Returns true if there are any queue items present.
   *
   * @returns {boolean}
   */
  hasQueueItems() {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM queue_items')
      .get()

    return (row?.count ?? 0) > 0
  }

  /**
   * Clears the channel binding and empties the entire queue so the user can
   * authorize a different channel.  This is the "explicit local queue reset"
   * required by the channel-binding policy.
   *
   * @returns {ReturnType<getAuthSnapshot>}
   */
  resetChannelBinding() {
    const timestamp = nowUtc()

    // Remove all queue items (cascade deletes upload_steps rows too).
    this.database.prepare('DELETE FROM queue_items').run()

    this.database
      .prepare(
        `
          UPDATE auth_session
          SET
            channel_id = NULL,
            channel_title = NULL,
            channel_thumbnail_url = NULL,
            scopes_json = '[]',
            refresh_token_ciphertext = NULL,
            access_token_expires_at = NULL,
            last_authenticated_at = NULL,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, DEFAULT_AUTH_SESSION_ID)

    return this.getAuthSnapshot()
  }

  listQueueItems() {
    const rows = this.database
      .prepare('SELECT * FROM queue_items ORDER BY sort_order ASC, created_at ASC')
      .all()
    const stepRows = this.database
      .prepare('SELECT * FROM upload_steps ORDER BY updated_at ASC, step_name ASC')
      .all()

    return queueListSchema.parse(rows.map((row) => rowToQueueItem(row, stepRows)))
  }

  getQueueItemById(id) {
    const row = this.database.prepare('SELECT * FROM queue_items WHERE id = ?').get(id)
    if (!row) {
      return null
    }

    const stepRows = this.database
      .prepare('SELECT * FROM upload_steps WHERE queue_item_id = ? ORDER BY step_name ASC')
      .all(id)

    return rowToQueueItem(row, stepRows)
  }

  getRequiredQueueItem(id) {
    const item = this.getQueueItemById(id)
    if (!item) {
      throw new Error(`Queue item not found: ${id}`)
    }

    return item
  }

  transitionQueueItemStatus(
    id,
    allowedCurrentStatuses,
    nextStatus,
    { clearLastError = false, lastError, incrementRetryCount = false } = {}
  ) {
    const item = this.getRequiredQueueItem(id)
    if (!allowedCurrentStatuses.includes(item.status)) {
      throw new Error(formatTransitionError(id, item.status, nextStatus))
    }

    const timestamp = nowUtc()
    const assignments = ['status = ?', 'updated_at = ?']
    const params = [nextStatus, timestamp]

    if (clearLastError) {
      assignments.push('last_error = NULL')
    } else if (lastError !== undefined) {
      assignments.push('last_error = ?')
      params.push(lastError)
    }

    if (incrementRetryCount) {
      assignments.push('retry_count = retry_count + 1')
    }

    this.database
      .prepare(`UPDATE queue_items SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...params, id)

    return { item, timestamp }
  }

  async addQueueItem(filePath, rawMetadata) {
    const metadata = queueMetadataInputSchema.parse(rawMetadata ?? {})
    const stats = ensureLocalFile(filePath)
    const fingerprint = await createFileFingerprint(filePath, stats)
    const timestamp = nowUtc()
    const id = randomUUID()
    const sortOrderRow = this.database
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM queue_items')
      .get()
    const sortOrder = (sortOrderRow?.max_sort_order ?? -1) + 1
    const captionTrack = buildCaptionTrack(metadata)

    this.database
      .prepare(
        `
          INSERT INTO queue_items (
            id,
            sort_order,
            status,
            source_file_path,
            source_thumbnail_path,
            source_caption_path,
            source_caption_language,
            source_caption_name,
            source_caption_is_draft,
            fingerprint_algorithm,
            fingerprint_digest,
            file_size_bytes,
            file_mtime_utc,
            title,
            description,
            tags_json,
            category_id,
            playlist_id,
            privacy_status,
            made_for_kids,
            notify_subscribers,
            synthetic_media,
            publish_at_utc,
            source_timezone,
            resumable_session_url,
            resumable_uploaded_bytes,
            resumable_total_bytes,
            resumable_updated_at,
            resumable_last_status_code,
            youtube_video_id,
            retry_count,
            last_error,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        sortOrder,
        deriveDraftStatus(metadata),
        filePath,
        toNullableText(metadata.thumbnailPath),
        toNullableText(captionTrack?.path),
        toNullableText(captionTrack?.language),
        toNullableText(captionTrack?.name),
        captionTrack?.isDraft ? 1 : 0,
        fingerprint.algorithm,
        fingerprint.digest,
        fingerprint.fileSizeBytes,
        fingerprint.lastModifiedUtc,
        metadata.title,
        metadata.description,
        JSON.stringify(metadata.tags),
        toNullableText(metadata.categoryId),
        toNullableText(metadata.playlistId),
        metadata.privacyStatus,
        metadata.madeForKids ? 1 : 0,
        metadata.notifySubscribers ? 1 : 0,
        metadata.syntheticMedia ? 1 : 0,
        toNullableText(metadata.publishAtUtc),
        toNullableText(metadata.sourceTimezone),
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        timestamp,
        timestamp
      )

    this.insertUploadStepsTransaction(buildStepRows(id, timestamp))

    return this.getQueueItemById(id)
  }

  removeQueueItem(id) {
    const info = this.database.prepare('DELETE FROM queue_items WHERE id = ?').run(id)
    return queueRemovalResultSchema.parse({ id, removed: info.changes > 0 })
  }

  reorderQueue(ids) {
    const existingIds = new Set(
      this.database.prepare('SELECT id FROM queue_items').all().map((row) => row.id)
    )

    if (existingIds.size !== ids.length || ids.some((id) => !existingIds.has(id))) {
      throw new Error('queue:reorder requires all existing queue item IDs exactly once')
    }

    const timestamp = nowUtc()
    this.reorderQueueItemsTransaction(ids, timestamp)

    return this.listQueueItems()
  }

  updateQueueItem(id, changes) {
    const existingItem = this.getQueueItemById(id)
    if (!existingItem) {
      throw new Error(`Queue item not found: ${id}`)
    }

    const mergedMetadata = mergeQueueMetadata(existingItem, queueMetadataUpdateSchema.parse(changes))
    const captionTrack = buildCaptionTrack(mergedMetadata)
    const timestamp = nowUtc()
    const nextStatus = EDITABLE_QUEUE_STATUSES.includes(existingItem.status)
      ? deriveDraftStatus(mergedMetadata)
      : existingItem.status

    this.database
      .prepare(
        `
          UPDATE queue_items
          SET
            status = ?,
            source_thumbnail_path = ?,
            source_caption_path = ?,
            source_caption_language = ?,
            source_caption_name = ?,
            source_caption_is_draft = ?,
            title = ?,
            description = ?,
            tags_json = ?,
            category_id = ?,
            playlist_id = ?,
            privacy_status = ?,
            made_for_kids = ?,
            notify_subscribers = ?,
            synthetic_media = ?,
            publish_at_utc = ?,
            source_timezone = ?,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        nextStatus,
        toNullableText(mergedMetadata.thumbnailPath),
        toNullableText(captionTrack?.path),
        toNullableText(captionTrack?.language),
        toNullableText(captionTrack?.name),
        captionTrack?.isDraft ? 1 : 0,
        mergedMetadata.title,
        mergedMetadata.description,
        JSON.stringify(mergedMetadata.tags),
        toNullableText(mergedMetadata.categoryId),
        toNullableText(mergedMetadata.playlistId),
        mergedMetadata.privacyStatus,
        mergedMetadata.madeForKids ? 1 : 0,
        mergedMetadata.notifySubscribers ? 1 : 0,
        mergedMetadata.syntheticMedia ? 1 : 0,
        toNullableText(mergedMetadata.publishAtUtc),
        toNullableText(mergedMetadata.sourceTimezone),
        timestamp,
        id
      )

    return this.getQueueItemById(id)
  }

  updateStepState(queueItemId, stepName, status, { lastError = null, startedAt = null, completedAt = null } = {}) {
    this.database
      .prepare(
        `
          UPDATE upload_steps
          SET
            status = ?,
            last_error = ?,
            started_at = COALESCE(?, started_at),
            completed_at = ?,
            updated_at = ?
          WHERE queue_item_id = ? AND step_name = ?
        `
      )
      .run(status, lastError, startedAt, completedAt, nowUtc(), queueItemId, stepName)
  }

  startNextUpload() {
    const candidate = this.database
      .prepare(
        `
          SELECT id
          FROM queue_items
          WHERE status = 'ready'
          ORDER BY sort_order ASC, created_at ASC
          LIMIT 1
        `
      )
      .get()

    if (!candidate) {
      return null
    }

    const { timestamp } = this.transitionQueueItemStatus(candidate.id, ['ready'], 'uploading', {
      clearLastError: true,
    })
    this.updateStepState(candidate.id, 'video_upload', 'in_progress', { startedAt: timestamp })

    return this.getQueueItemById(candidate.id)
  }

  pauseUpload(id) {
    this.transitionQueueItemStatus(id, ['uploading'], 'paused')

    return this.getQueueItemById(id)
  }

  resumeUpload(id) {
    this.transitionQueueItemStatus(id, ['paused'], 'uploading', {
      clearLastError: true,
    })
    this.updateStepState(id, 'video_upload', 'in_progress')

    return this.getQueueItemById(id)
  }

  cancelUpload(id) {
    const { timestamp } = this.transitionQueueItemStatus(id, ['uploading', 'paused'], 'failed', {
      incrementRetryCount: true,
      lastError: 'Upload cancelled by user',
    })
    this.updateStepState(id, 'video_upload', 'failed', {
      lastError: 'Upload cancelled by user',
      completedAt: timestamp,
    })

    return this.getQueueItemById(id)
  }
}
