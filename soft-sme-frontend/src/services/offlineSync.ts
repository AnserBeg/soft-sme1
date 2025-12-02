import api from '../api/axios';

type PendingRow = {
  event_id: string;
  user_id?: number;
  device_id?: string;
  type: string;
  timestamp_utc: string;
  payload_json: string;
  created_at: string;
  synced_at?: string | null;
};

export const getPendingCount = async (): Promise<number> => {
  try {
    const res = await (window as any)?.api?.timeEvents?.pendingCount?.();
    return res?.success ? (res.count as number) : 0;
  } catch {
    return 0;
  }
};

export const listPending = async (limit = 200): Promise<PendingRow[]> => {
  const res = await (window as any)?.api?.timeEvents?.listPending?.(limit);
  return res?.success ? (res.rows as PendingRow[]) : [];
};

export const syncPending = async (): Promise<{ synced: number; failed: number }> => {
  const rows = await listPending(200);
  let synced = 0;
  let failed = 0;
  const succeededIds: string[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json || '{}');
      switch (row.type) {
        case 'attendance_clock_in':
          await api.post('/api/attendance/clock-in', {
            profile_id: payload.profile_id,
            latitude: payload.latitude,
            longitude: payload.longitude,
          });
          break;
        case 'attendance_clock_out':
          await api.post('/api/attendance/clock-out', { shift_id: payload.shift_id });
          break;
        case 'attendance_update':
          await api.put(`/api/attendance/${payload.shift_id}`, { clock_in: payload.clock_in, clock_out: payload.clock_out });
          break;
        case 'time_clock_in':
          await api.post('/api/time-tracking/time-entries/clock-in', { profile_id: payload.profile_id, so_id: payload.so_id });
          break;
        case 'time_clock_out':
          await api.post(`/api/time-tracking/time-entries/${payload.id}/clock-out`);
          break;
        default:
          // Unknown type; skip but mark failed (or leave pending)
          failed++;
          continue;
      }
      succeededIds.push(row.event_id);
      synced++;
    } catch {
      failed++;
    }
  }
  if (succeededIds.length) {
    await (window as any)?.api?.timeEvents?.markSynced?.(succeededIds);
  }
  return { synced, failed };
};


