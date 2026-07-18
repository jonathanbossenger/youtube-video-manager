import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  /**
   * Main process configuration.
   * externalizeDepsPlugin keeps Node and Electron modules as external
   * requires so native addons (e.g. better-sqlite3) are never bundled.
   */
  main: {
    plugins: [externalizeDepsPlugin()]
  },

  /**
   * Preload script configuration.
   * Same externalisation policy as main — the preload only needs
   * contextBridge and ipcRenderer from Electron, no npm bundles.
   */
  preload: {
    plugins: [externalizeDepsPlugin()]
  },

  /**
   * Renderer (React) configuration.
   * Vite handles JSX transformation and HMR in dev mode.
   */
  renderer: {
    plugins: [react()]
  }
})
