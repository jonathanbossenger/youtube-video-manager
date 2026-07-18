/**
 * electron-builder afterPack hook — rebuilds native Node modules for the
 * Electron runtime that will be bundled in the app package.
 *
 * This is required for native addons such as better-sqlite3 that ship
 * pre-compiled C++ bindings.  The hook ensures that the binaries match the
 * exact Electron/Node ABI that ships in the final package rather than the
 * system Node.js used during development.
 *
 * Usage: electron-builder will call this script automatically after packing.
 * To rebuild manually during development run:  npm run rebuild
 */

const { spawnSync } = require('child_process')
const path = require('path')

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context

  const electronVersion = require('../node_modules/electron/package.json').version

  console.log(
    `[afterPack] Rebuilding native modules for Electron ${electronVersion} ` +
      `on ${electronPlatformName} (${arch}) …`
  )

  // Use spawnSync with an argument array (never a shell-interpolated string)
  // so that electronVersion, arch, and appOutDir cannot be used for command
  // injection even if they contain unexpected characters.
  const moduleDir = path.join(appOutDir, 'resources', 'app')
  const result = spawnSync(
    'npx',
    [
      '@electron/rebuild',
      '--force',
      `--electron-version=${electronVersion}`,
      `--arch=${arch}`,
      `--module-dir=${moduleDir}`,
    ],
    {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
      shell: false,
    }
  )

  if (result.error) {
    console.error('[afterPack] Native module rebuild failed:', result.error.message)
  } else if (result.status !== 0) {
    console.error(`[afterPack] Native module rebuild exited with code ${result.status}`)
  } else {
    console.log('[afterPack] Native module rebuild complete.')
  }
  // Do not throw — allow packaging to continue even if optional native
  // modules are absent.  The main process handles missing-module errors
  // gracefully at runtime.
}
