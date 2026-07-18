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

const { execSync } = require('child_process')
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

  try {
    execSync(
      [
        'npx',
        '@electron/rebuild',
        '--force',
        `--electron-version=${electronVersion}`,
        `--arch=${arch}`,
        `--module-dir=${path.join(appOutDir, 'resources', 'app')}`,
      ].join(' '),
      { stdio: 'inherit', cwd: path.resolve(__dirname, '..') }
    )
    console.log('[afterPack] Native module rebuild complete.')
  } catch (err) {
    console.error('[afterPack] Native module rebuild failed:', err.message)
    // Do not throw — allow packaging to continue even if optional native
    // modules are absent.  The main process handles missing-module errors
    // gracefully at runtime.
  }
}
