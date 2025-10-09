import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
// Lazy require for native module to avoid issues in non-electron tooling
let Database: any;

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main.js
// │ └─┬ preload.js
// ├─┬ dist
// │ └── index.html

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let mainWindow: BrowserWindow | null = null;
let db: any | null = null;

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

const isDev = process.env.NODE_ENV === 'development' || process.defaultApp || /node_modules[\\/]electron[\\/]/.test(process.execPath);

// IPC handlers for backup directory browsing
ipcMain.handle('browse-directory', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: options.title || 'Select Directory'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, directory: result.filePaths[0] };
    } else {
      return { success: false, directory: '' };
    }
  } catch (error) {
    console.error('Error browsing directory:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    show: false, // Don't show until ready
    frame: true,
    titleBarStyle: 'default',
    icon: path.join(__dirname, '../build/icon.ico'), // Add icon for production
    title: 'Aiven - Business Management System'
  });

  // Load the index.html from a url
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow?.loadURL('http://localhost:3000');
    // Open the DevTools in development.
    mainWindow?.webContents.openDevTools();
  } else {
    // In production, load from the packaged frontend files
    const frontendPath = path.join(__dirname, '..', 'frontend-dist', 'index.html');
    console.log('Loading frontend from:', frontendPath);
    
    mainWindow?.loadFile(frontendPath).catch((error) => {
      console.error('Failed to load frontend:', error);
      // Fallback error page
      mainWindow?.loadURL('data:text/html,<h1>Error loading application</h1><p>Could not find frontend files.</p>');
    });
  }

  // Show window when ready
  mainWindow?.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle external links
mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url);
  return { action: 'deny' };
});
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Initialize SQLite database in a writable directory
  try {
    const baseDir = (process.env.PORTABLE_EXECUTABLE_DIR as string) || app.getPath('userData');
    const dataDir = path.join(baseDir, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'timekeeping.db');
    // Defer require to runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Database = require('better-sqlite3');
    db = new Database(dbPath);
    // Create table if not exists
    db.exec(`CREATE TABLE IF NOT EXISTS time_events (
      event_id TEXT PRIMARY KEY,
      user_id INTEGER,
      device_id TEXT,
      type TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_time_events_unsynced ON time_events(synced_at);
    `);
  } catch (error) {
    console.error('Failed to initialize SQLite:', error);
  }

  // IPC: insert event
  ipcMain.handle('time-events/insert', async (_e, evt: {
    event_id: string; user_id?: number; device_id?: string; type: string; timestamp_utc: string; payload_json: string; created_at: string;
  }) => {
    if (!db) return { success: false, error: 'DB not initialized' };
    try {
      const stmt = db.prepare(`INSERT OR IGNORE INTO time_events (
        event_id, user_id, device_id, type, timestamp_utc, payload_json, created_at, synced_at
      ) VALUES (@event_id, @user_id, @device_id, @type, @timestamp_utc, @payload_json, @created_at, NULL)`);
      stmt.run(evt);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // IPC: list pending (unsynced)
  ipcMain.handle('time-events/list-pending', async (_e, limit = 200) => {
    if (!db) return { success: false, error: 'DB not initialized' };
    try {
      const rows = db.prepare(`SELECT * FROM time_events WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT ?`).all(limit);
      return { success: true, rows };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // IPC: mark synced
  ipcMain.handle('time-events/mark-synced', async (_e, eventIds: string[]) => {
    if (!db) return { success: false, error: 'DB not initialized' };
    if (!Array.isArray(eventIds) || eventIds.length === 0) return { success: true };
    try {
      const now = new Date().toISOString();
      const tx = db.transaction((ids: string[]) => {
        const stmt = db.prepare(`UPDATE time_events SET synced_at = ? WHERE event_id = ?`);
        for (const id of ids) stmt.run(now, id);
      });
      tx(eventIds);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // IPC: pending count
  ipcMain.handle('time-events/pending-count', async () => {
    if (!db) return { success: false, error: 'DB not initialized' };
    try {
      const row = db.prepare(`SELECT COUNT(1) as cnt FROM time_events WHERE synced_at IS NULL`).get();
      return { success: true, count: row?.cnt ?? 0 };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  createWindow();
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 