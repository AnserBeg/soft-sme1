const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    isDev: process.env.NODE_ENV === 'development',
    platform: process.platform,
  }
);

// Define types for better type safety
type Channel = 'toMain' | 'fromMain';
type Callback = (...args: any[]) => void;
type IpcEvent = Electron.IpcRendererEvent;

const validChannels: Channel[] = ['toMain', 'fromMain'];

contextBridge.exposeInMainWorld(
  'api', {
    send: (channel: Channel, data: any) => {
      // whitelist channels
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel: Channel, func: Callback) => {
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender` 
        ipcRenderer.on(channel, (_event: IpcEvent, ...args: any[]) => func(...args));
      }
    },
    browseDirectory: (options: { title?: string }) => {
      return ipcRenderer.invoke('browse-directory', options);
    },
    timeEvents: {
      insert: (evt: { event_id: string; user_id?: number; device_id?: string; type: string; timestamp_utc: string; payload_json: string; created_at: string; }) => ipcRenderer.invoke('time-events/insert', evt),
      listPending: (limit?: number) => ipcRenderer.invoke('time-events/list-pending', limit),
      markSynced: (eventIds: string[]) => ipcRenderer.invoke('time-events/mark-synced', eventIds),
      pendingCount: () => ipcRenderer.invoke('time-events/pending-count')
    }
  }
); 