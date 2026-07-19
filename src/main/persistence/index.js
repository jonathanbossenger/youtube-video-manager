import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { YouTubeManagerStore } from './store.js'

let store

export function getYouTubeManagerStore() {
  if (!store) {
    const databasePath = join(app.getPath('userData'), 'youtube-manager.sqlite')
    store = new YouTubeManagerStore(new Database(databasePath))
  }

  return store
}
