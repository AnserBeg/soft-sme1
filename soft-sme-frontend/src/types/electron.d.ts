declare global {
  interface Window {
    electron: {
      isDev: boolean;
      platform: string;
    };
    api: {
      send: (channel: string, data: any) => void;
      receive: (channel: string, func: (...args: any[]) => void) => void;
      browseDirectory: (options: { title?: string }) => Promise<{
        success: boolean;
        directory?: string;
        error?: string;
      }>;
      timeEvents?: {
        insert: (evt: { event_id: string; user_id?: number; device_id?: string; type: string; timestamp_utc: string; payload_json: string; created_at: string; }) => Promise<{ success: boolean; error?: string }>;
        listPending: (limit?: number) => Promise<{ success: boolean; rows?: Array<{ event_id: string; user_id?: number; device_id?: string; type: string; timestamp_utc: string; payload_json: string; created_at: string; synced_at?: string | null }>; error?: string }>;
        markSynced: (eventIds: string[]) => Promise<{ success: boolean; error?: string }>;
        pendingCount: () => Promise<{ success: boolean; count: number; error?: string }>;
      };
    };
  }
}

export {}; 