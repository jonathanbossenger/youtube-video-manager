import { z } from 'zod'

const ABSOLUTE_PATH_REGEX = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/
const HEX_64_REGEX = /^[a-f0-9]{64}$/i

const absolutePathSchema = z
  .string()
  .trim()
  .min(1, 'Expected an absolute file path')
  .refine((value) => ABSOLUTE_PATH_REGEX.test(value), 'Expected an absolute file path')

const nullableAbsolutePathSchema = absolutePathSchema.nullable()
const utcDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith('Z'), 'Expected a UTC ISO-8601 timestamp')

const nullableUtcDateTimeSchema = utcDateTimeSchema.nullable()
const idSchema = z.uuid()

const versionInfoSchema = z
  .object({
    app: z.string(),
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
  })
  .strict()

const captionTrackSchema = z
  .object({
    path: absolutePathSchema,
    language: z.string().trim().min(2).max(16),
    name: z.string().trim().min(1).max(150),
    isDraft: z.boolean().default(false),
  })
  .strict()

const queueMetadataShape = {
  title: z
    .string()
    .max(100)
    .transform((value) => value.trim())
    .default(''),
  description: z.string().max(5000).default(''),
  tags: z
    .array(
      z
        .string()
        .max(100)
        .transform((value) => value.trim())
        .refine((value) => value.length > 0, 'Tag cannot be empty')
    )
    .max(500)
    .default([]),
  categoryId: z.string().trim().min(1).nullable().default(null),
  playlistId: z.string().trim().min(1).nullable().default(null),
  privacyStatus: z.enum(['private', 'unlisted', 'public']).default('private'),
  madeForKids: z.boolean().default(false),
  notifySubscribers: z.boolean().default(true),
  thumbnailPath: nullableAbsolutePathSchema.default(null),
  captionTrack: captionTrackSchema.nullable().default(null),
  publishAtUtc: nullableUtcDateTimeSchema.default(null),
  sourceTimezone: z.string().trim().min(1).nullable().default(null),
  syntheticMedia: z.boolean().default(false),
}

const baseQueueMetadataInputSchema = z.object(queueMetadataShape).strict()

function validateSchedulingMetadata(metadata, context) {
  if (metadata.publishAtUtc && !metadata.sourceTimezone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceTimezone'],
      message: 'sourceTimezone is required when publishAtUtc is provided',
    })
  }

  if (!metadata.publishAtUtc && metadata.sourceTimezone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['publishAtUtc'],
      message: 'publishAtUtc is required when sourceTimezone is provided',
    })
  }
}

export const queueMetadataInputSchema = baseQueueMetadataInputSchema.superRefine(
  validateSchedulingMetadata
)

export const queueMetadataUpdateSchema = z
  .object({
    title: queueMetadataShape.title.optional(),
    description: queueMetadataShape.description.optional(),
    tags: queueMetadataShape.tags.optional(),
    categoryId: queueMetadataShape.categoryId.optional(),
    playlistId: queueMetadataShape.playlistId.optional(),
    privacyStatus: queueMetadataShape.privacyStatus.optional(),
    madeForKids: queueMetadataShape.madeForKids.optional(),
    notifySubscribers: queueMetadataShape.notifySubscribers.optional(),
    thumbnailPath: queueMetadataShape.thumbnailPath.optional(),
    captionTrack: queueMetadataShape.captionTrack.optional(),
    publishAtUtc: queueMetadataShape.publishAtUtc.optional(),
    sourceTimezone: queueMetadataShape.sourceTimezone.optional(),
    syntheticMedia: queueMetadataShape.syntheticMedia.optional(),
  })
  .strict()
  .superRefine((metadata, context) => {
    validateSchedulingMetadata(metadata, context)

    if (Object.keys(metadata).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one editable queue field must be provided',
      })
    }
  })

export const UPLOAD_STATES = [
  'draft',
  'ready',
  'uploading',
  'paused',
  'finalizing',
  'scheduled',
  'needs_review',
  'failed',
]

export const UPLOAD_STEP_NAMES = [
  'video_upload',
  'thumbnail_upload',
  'playlist_attach',
  'caption_upload',
  'processing_check',
]

export const UPLOAD_STEP_STATES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'needs_review',
  'skipped',
]

export const uploadStateSchema = z.enum(UPLOAD_STATES)
export const uploadStepNameSchema = z.enum(UPLOAD_STEP_NAMES)
export const uploadStepStateSchema = z.enum(UPLOAD_STEP_STATES)

export const fileFingerprintSchema = z
  .object({
    algorithm: z.literal('sha256'),
    digest: z.string().regex(HEX_64_REGEX, 'Expected a SHA-256 hex digest'),
    fileSizeBytes: z.number().int().nonnegative(),
    lastModifiedUtc: utcDateTimeSchema,
  })
  .strict()

export const resumableSessionSchema = z
  .object({
    sessionUrl: z.string().url(),
    uploadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    updatedAt: utcDateTimeSchema,
    lastStatusCode: z.number().int().min(100).max(599).nullable(),
  })
  .strict()

export const uploadStepRecordSchema = z
  .object({
    id: idSchema,
    queueItemId: idSchema,
    stepName: uploadStepNameSchema,
    status: uploadStepStateSchema,
    retryCount: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    startedAt: nullableUtcDateTimeSchema,
    completedAt: nullableUtcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()

export const queueItemRecordSchema = z
  .object({
    id: idSchema,
    sortOrder: z.number().int().nonnegative(),
    status: uploadStateSchema,
    asset: z
      .object({
        filePath: absolutePathSchema,
        thumbnailPath: nullableAbsolutePathSchema,
        captionTrack: captionTrackSchema.nullable(),
        fingerprint: fileFingerprintSchema,
      })
      .strict(),
    metadata: z
      .object({
        title: z.string(),
        description: z.string(),
        tags: z.array(z.string()),
        categoryId: z.string().nullable(),
        playlistId: z.string().nullable(),
        privacyStatus: z.enum(['private', 'unlisted', 'public']),
        madeForKids: z.boolean(),
        notifySubscribers: z.boolean(),
        syntheticMedia: z.boolean(),
      })
      .strict(),
    schedule: z
      .object({
        publishAtUtc: nullableUtcDateTimeSchema,
        sourceTimezone: z.string().nullable(),
      })
      .strict(),
    resumableSession: resumableSessionSchema.nullable(),
    youtube: z
      .object({
        videoId: z.string().trim().min(1).nullable(),
      })
      .strict(),
    steps: z.array(uploadStepRecordSchema),
    retryCount: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()

export const queueListSchema = z.array(queueItemRecordSchema)

export const queueRemovalResultSchema = z
  .object({
    id: idSchema,
    removed: z.boolean(),
  })
  .strict()

export const authCredentialsRecordSchema = z
  .object({
    clientId: z.string().trim().min(1),
    projectId: z.string().trim().min(1).nullable(),
    authUri: z.string().url(),
    tokenUri: z.string().url(),
    redirectUris: z.array(z.string().url()).min(1),
    importedAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()

export const authSessionRecordSchema = z
  .object({
    channelId: z.string().trim().min(1).nullable(),
    scopes: z.array(z.string()),
    hasRefreshToken: z.boolean(),
    accessTokenExpiresAt: nullableUtcDateTimeSchema,
    lastAuthenticatedAt: nullableUtcDateTimeSchema,
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()

export const authSnapshotSchema = z
  .object({
    authenticated: z.boolean(),
    credentials: authCredentialsRecordSchema.nullable(),
    session: authSessionRecordSchema,
  })
  .strict()

export const googleDesktopOAuthCredentialsSchema = z
  .object({
    installed: z
      .object({
        client_id: z.string().trim().min(1),
        project_id: z.string().trim().min(1).optional(),
        auth_uri: z.string().url(),
        token_uri: z.string().url(),
        auth_provider_x509_cert_url: z.string().url().optional(),
        client_secret: z.string().trim().min(1).optional(),
        redirect_uris: z.array(z.string().url()).min(1),
      })
      .strict(),
  })
  .strict()

export const channelInfoSchema = z
  .object({
    channelId: z.string().trim().min(1),
    title: z.string(),
    thumbnailUrl: z.string().url().nullable(),
  })
  .strict()
  .nullable()

export const metadataCategorySchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
  })
  .strict()

export const metadataPlaylistSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
  })
  .strict()

export const uploadProgressEventSchema = z
  .object({
    id: idSchema,
    bytesUploaded: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
  })
  .strict()

export const uploadStatusChangedEventSchema = z
  .object({
    id: idSchema,
    status: uploadStateSchema,
    error: z.string().nullable().default(null),
  })
  .strict()

export const REQUEST_SCHEMAS = {
  APP_PING: z.undefined().optional(),
  APP_GET_VERSION: z.undefined().optional(),
  AUTH_IMPORT_CREDENTIALS: z.object({ filePath: absolutePathSchema }).strict(),
  AUTH_START_OAUTH: z.undefined().optional(),
  AUTH_GET_STATUS: z.undefined().optional(),
  AUTH_SIGN_OUT: z.undefined().optional(),
  CHANNEL_GET_INFO: z.undefined().optional(),
  QUEUE_LIST: z.undefined().optional(),
  QUEUE_ADD: z
    .object({
      filePath: absolutePathSchema,
      metadata: queueMetadataInputSchema.default({}),
    })
    .strict(),
  QUEUE_REMOVE: z.object({ id: idSchema }).strict(),
  QUEUE_REORDER: z
    .object({
      ids: z.array(idSchema).min(1),
    })
    .strict()
    .superRefine(({ ids }, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ids'],
          message: 'Queue reorder payload cannot contain duplicate IDs',
        })
      }
    }),
  QUEUE_UPDATE: z
    .object({
      id: idSchema,
      title: queueMetadataShape.title.optional(),
      description: queueMetadataShape.description.optional(),
      tags: queueMetadataShape.tags.optional(),
      categoryId: queueMetadataShape.categoryId.optional(),
      playlistId: queueMetadataShape.playlistId.optional(),
      privacyStatus: queueMetadataShape.privacyStatus.optional(),
      madeForKids: queueMetadataShape.madeForKids.optional(),
      notifySubscribers: queueMetadataShape.notifySubscribers.optional(),
      thumbnailPath: queueMetadataShape.thumbnailPath.optional(),
      captionTrack: queueMetadataShape.captionTrack.optional(),
      publishAtUtc: queueMetadataShape.publishAtUtc.optional(),
      sourceTimezone: queueMetadataShape.sourceTimezone.optional(),
      syntheticMedia: queueMetadataShape.syntheticMedia.optional(),
    })
    .strict()
    .superRefine((payload, context) => {
      const { id: _id, ...changes } = payload
      const parsedChanges = queueMetadataUpdateSchema.safeParse(changes)

      if (!parsedChanges.success) {
        for (const issue of parsedChanges.error.issues) {
          context.addIssue(issue)
        }
      }
    }),
  UPLOAD_START: z.undefined().optional(),
  UPLOAD_PAUSE: z.object({ id: idSchema }).strict(),
  UPLOAD_RESUME: z.object({ id: idSchema }).strict(),
  UPLOAD_CANCEL: z.object({ id: idSchema }).strict(),
  METADATA_GET_CATEGORIES: z.undefined().optional(),
  METADATA_GET_PLAYLISTS: z.undefined().optional(),
}

export const RESPONSE_SCHEMAS = {
  APP_PING: z.literal('pong'),
  APP_GET_VERSION: versionInfoSchema,
  AUTH_IMPORT_CREDENTIALS: authSnapshotSchema,
  AUTH_START_OAUTH: z
    .object({
      supported: z.boolean(),
      message: z.string(),
    })
    .strict(),
  AUTH_GET_STATUS: authSnapshotSchema,
  AUTH_SIGN_OUT: authSnapshotSchema,
  CHANNEL_GET_INFO: channelInfoSchema,
  QUEUE_LIST: queueListSchema,
  QUEUE_ADD: queueItemRecordSchema,
  QUEUE_REMOVE: queueRemovalResultSchema,
  QUEUE_REORDER: queueListSchema,
  QUEUE_UPDATE: queueItemRecordSchema,
  UPLOAD_START: queueItemRecordSchema.nullable(),
  UPLOAD_PAUSE: queueItemRecordSchema,
  UPLOAD_RESUME: queueItemRecordSchema,
  UPLOAD_CANCEL: queueItemRecordSchema,
  METADATA_GET_CATEGORIES: z.array(metadataCategorySchema),
  METADATA_GET_PLAYLISTS: z.array(metadataPlaylistSchema),
}

export const EVENT_SCHEMAS = {
  UPLOAD_PROGRESS: uploadProgressEventSchema,
  UPLOAD_STATUS_CHANGED: uploadStatusChangedEventSchema,
}

export const YOUTUBE_MANAGER_API_CONTRACT = Object.freeze({
  version: 1,
  uploadStates: [...UPLOAD_STATES],
  uploadStepNames: [...UPLOAD_STEP_NAMES],
  uploadStepStates: [...UPLOAD_STEP_STATES],
  methods: {
    ping: {
      description: 'Connectivity check for the validated preload bridge.',
      requestSchema: 'void',
      responseSchema: 'pong',
    },
    getVersion: {
      description: 'Returns application, Electron, Chrome, and Node versions.',
      requestSchema: 'void',
      responseSchema: 'VersionInfo',
    },
    importCredentials: {
      description: 'Imports and validates a Google Desktop OAuth credentials JSON file.',
      requestSchema: 'ImportCredentialsPayload',
      responseSchema: 'AuthSnapshot',
    },
    startOAuth: {
      description: 'Reserved hook for the future OAuth flow entry point.',
      requestSchema: 'void',
      responseSchema: 'OAuthStartResult',
    },
    getAuthStatus: {
      description: 'Returns validated credential and session status.',
      requestSchema: 'void',
      responseSchema: 'AuthSnapshot',
    },
    signOut: {
      description: 'Clears persisted auth session state and imported credentials.',
      requestSchema: 'void',
      responseSchema: 'AuthSnapshot',
    },
    getChannelInfo: {
      description: 'Returns the active channel metadata when available.',
      requestSchema: 'void',
      responseSchema: 'ChannelInfo | null',
    },
    listQueue: {
      description: 'Lists persisted queue records in user-defined order.',
      requestSchema: 'void',
      responseSchema: 'QueueItem[]',
    },
    addToQueue: {
      description: 'Adds a local asset to the queue and fingerprints the source file.',
      requestSchema: 'QueueAddPayload',
      responseSchema: 'QueueItem',
    },
    removeFromQueue: {
      description: 'Removes a queue item and its step state rows.',
      requestSchema: 'QueueRemovePayload',
      responseSchema: 'QueueRemovalResult',
    },
    reorderQueue: {
      description: 'Persists an explicit queue order.',
      requestSchema: 'QueueReorderPayload',
      responseSchema: 'QueueItem[]',
    },
    updateJob: {
      description: 'Updates editable metadata, scheduling data, and asset references for a queue item.',
      requestSchema: 'QueueUpdatePayload',
      responseSchema: 'QueueItem',
    },
    startUpload: {
      description: 'Transitions the next ready queue item into the uploading state.',
      requestSchema: 'void',
      responseSchema: 'QueueItem | null',
    },
    pauseUpload: {
      description: 'Marks an active queue item as paused.',
      requestSchema: 'QueueItemIdPayload',
      responseSchema: 'QueueItem',
    },
    resumeUpload: {
      description: 'Marks a paused queue item as uploading again.',
      requestSchema: 'QueueItemIdPayload',
      responseSchema: 'QueueItem',
    },
    cancelUpload: {
      description: 'Marks an upload as failed and records a cancellation error.',
      requestSchema: 'QueueItemIdPayload',
      responseSchema: 'QueueItem',
    },
    getCategories: {
      description: 'Returns validated cached or fetched YouTube video categories.',
      requestSchema: 'void',
      responseSchema: 'MetadataCategory[]',
    },
    getPlaylists: {
      description: 'Returns validated cached or fetched channel playlists.',
      requestSchema: 'void',
      responseSchema: 'MetadataPlaylist[]',
    },
  },
  events: {
    onUploadProgress: {
      description: 'Subscribes to validated upload byte progress updates.',
      payloadSchema: 'UploadProgressEvent',
    },
    onUploadStatusChanged: {
      description: 'Subscribes to validated queue item status transitions.',
      payloadSchema: 'UploadStatusChangedEvent',
    },
  },
})
