# YouTube Video Manager — Electron App Plan

## Summary

Build a greenfield Electron desktop app for a solo creator to queue and schedule long-form videos and Shorts on one YouTube channel. The app will run on macOS, Windows, and Linux in developer mode, using React with JavaScript.

Uploads will begin immediately and use YouTube-native scheduling, so the app can close after YouTube accepts the video and its supporting assets. The imported OAuth credentials must belong to an existing API project approved for public uploads. YouTube otherwise restricts API uploads to private visibility.

## Implementation Changes

- Bootstrap Electron, Vite, React, and JavaScript with separate main, preload, and renderer processes.
- Keep filesystem, OAuth, SQLite, and YouTube API access in the main process. Enable renderer sandboxing, context isolation, a restrictive CSP, and narrowly validated IPC methods.
- Add an onboarding screen that imports a Google Desktop OAuth JSON file, launches authorization in the system browser, uses PKCE with a loopback redirect, and locks the app to the returned channel ID.
- Request `youtube.force-ssl` because uploading captions and managing playlists require more than the upload-only scope.
- Encrypt refresh tokens with Electron `safeStorage`. If secure storage is unavailable, retain tokens only for the current session rather than writing plaintext credentials.
- Store queue state in SQLite using `better-sqlite3`, with runtime validation through Zod and Electron-native dependency rebuilding on each target platform.
- Use `ffprobe-static` to inspect dimensions, duration, MIME type, file size, and media streams. Label square or vertical videos of at most three minutes as expected Shorts; do not send a Shorts flag because YouTube classifies them automatically.
- Provide three screens:
  - Connection/settings: credentials, channel identity, sign-out, and reconnect.
  - Queue: ordered uploads, progress, pause/resume, retry, remove, and completed history.
  - Upload editor: video, title, description, tags, category, optional thumbnail, optional single playlist, optional SRT/VTT caption with language/name, publish date/time, subscriber notification, made-for-kids declaration, and altered/synthetic-content declaration.
- Support scheduled-public uploads only. Convert the selected local time and displayed timezone to RFC 3339 UTC, upload with `privacyStatus: private` and `status.publishAt`, and reject jobs whose scheduled time has passed before upload begins.
- Upload sequentially with YouTube's resumable protocol, persisting the session URL, uploaded byte offset, file size, and modification time. Resume interrupted sessions after restart and use exponential backoff for transient failures.
- After the video is created, independently upload its thumbnail, add it to the selected playlist, and upload the caption track. Persist and retry each step separately so failures cannot create duplicate videos.
- Treat an expired session with an ambiguous completion result as `needs_review`; do not automatically restart it because YouTube offers no upload idempotency key.
- Show explicit states: `draft`, `ready`, `uploading`, `paused`, `finalizing`, `scheduled`, `needs_review`, and `failed`. Display actionable authentication, quota, invalid scheduling, missing-file, changed-file, and post-upload errors.
- Cache categories and playlists, refresh them on demand, and poll video processing status while the app is open. YouTube remains responsible for publishing after successful scheduling.

## Interfaces and Data

- Expose a validated `window.youtubeManager` preload API for credential import, authentication, channel details, queue CRUD and reordering, upload control, metadata lookups, and progress/status subscriptions.
- Define queue records with local asset paths and fingerprints, metadata, UTC publication time plus source timezone, resumable-session state, YouTube video ID, per-step completion/error state, retry counts, and timestamps.
- Allow metadata edits until upload initiation. Once a YouTube video ID exists, freeze publishing metadata in v1 and direct the user to YouTube Studio for further editing.
- On reconnect, verify the authenticated channel ID matches the stored channel. Require an empty queue or explicit local queue reset before binding another channel.

## Test Plan

- Unit-test metadata validation, timezone conversion, Shorts classification, file fingerprinting, state transitions, retry policy, and API error mapping.
- Integration-test OAuth callbacks and YouTube requests against mocked HTTP responses, including token refresh, resumable `308` responses, expired sessions, quota failures, caption failures, and restart recovery.
- Test IPC authorization and schema rejection so the renderer cannot access arbitrary files or main-process capabilities.
- Run React interaction tests for onboarding, job editing, queue ordering, progress, retry, and recovery messaging.
- Run Electron end-to-end smoke tests on macOS, Windows, and Linux for credential import, file selection, persistence across restart, and secure-storage fallback.
- Manually validate private test uploads first, then scheduled-public video and Short uploads using the audited project. Confirm thumbnail, playlist, caption, audience declarations, synthetic-media declaration, subscriber setting, timezone, and final publication time.
- Verify that closing the app after a job reaches `scheduled` does not affect publication.

## Assumptions and Defaults

- This is a personal, single-channel tool using an existing YouTube API project approved for public uploads.
- One sequential persistent queue is sufficient; parallel uploads, multiple channels, teams, presets, calendar views, analytics, comments, editing, and transcoding are deferred.
- The application supports one optional playlist and one timed caption track per upload.
- Only source and developer execution is required initially; installers, signing, notarization, auto-update, and public distribution are deferred.
- Runtime dependencies remain cross-platform, and target-specific development is verified on each operating system rather than cross-compiled from one machine.

## References

- [Videos: insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [Captions: insert](https://developers.google.com/youtube/v3/docs/captions/insert)
- [Three-minute YouTube Shorts](https://support.google.com/youtube/answer/15424877?hl=en-EN)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
