import { safeStorage } from 'electron'

// ---------------------------------------------------------------------------
// In-memory session-only fallback — used when OS-level encryption is
// unavailable (e.g. headless CI, some Linux desktop environments without a
// keyring).  The token is never written to disk in this path and is lost
// when the app quits.
// ---------------------------------------------------------------------------

let inMemoryRefreshToken = null

/**
 * Returns true when the OS keychain / DPAPI / libsecret is available for use
 * with Electron's safeStorage API.
 */
export function isEncryptionAvailable() {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Encrypts a plaintext refresh token for at-rest storage.
 * Returns a Base64-encoded ciphertext string ready for SQLite, or null when
 * encryption is unavailable (caller should fall back to in-memory storage).
 *
 * @param {string} plainText
 * @returns {string | null}
 */
export function encryptToken(plainText) {
  if (!isEncryptionAvailable()) {
    return null
  }

  try {
    return safeStorage.encryptString(plainText).toString('base64')
  } catch (err) {
    console.error('[token-storage] encryptToken failed:', err)
    return null
  }
}

/**
 * Decrypts a previously encrypted refresh token.
 * Returns the plaintext string or null if decryption fails.
 *
 * @param {string | null} ciphertext  Base64-encoded ciphertext from the DB.
 * @returns {string | null}
 */
export function decryptToken(ciphertext) {
  if (!ciphertext) {
    return null
  }

  if (!isEncryptionAvailable()) {
    return null
  }

  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  } catch (err) {
    console.error('[token-storage] decryptToken failed:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// In-memory token helpers (session-only fallback)
// ---------------------------------------------------------------------------

/**
 * Stores the refresh token in memory only (no disk write).
 * Called when safeStorage is unavailable.
 *
 * @param {string} token
 */
export function setInMemoryToken(token) {
  inMemoryRefreshToken = token
}

/**
 * Returns the in-memory refresh token, or null if not set.
 *
 * @returns {string | null}
 */
export function getInMemoryToken() {
  return inMemoryRefreshToken
}

/**
 * Clears the in-memory token (called on sign-out).
 */
export function clearInMemoryToken() {
  inMemoryRefreshToken = null
}
