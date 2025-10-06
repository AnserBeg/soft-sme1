import api from '../api/axios';

const toUtcIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
const uuid = () => (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const getShifts = async (profileId: number) => {
  const response = await api.get('/api/attendance', { params: { profile_id: profileId } });
  return response.data;
};

export const clockInShift = async (profileId: number) => {
  try {
    const response = await api.post('/api/attendance/clock-in', { profile_id: profileId });
    return response.data;
  } catch (err) {
    const evt = {
      event_id: uuid(),
      user_id: profileId,
      device_id: localStorage.getItem('deviceId') || 'unknown-device',
      type: 'attendance_clock_in',
      timestamp_utc: toUtcIso(new Date()),
      payload_json: JSON.stringify({ profile_id: profileId }),
      created_at: toUtcIso(new Date()),
    };
    await (window as any)?.api?.timeEvents?.insert?.(evt);
    return {
      id: -Math.floor(Math.random() * 1e9),
      profile_id: profileId,
      clock_in: new Date().toISOString(),
      clock_out: null,
      duration: null,
      __pending: true,
      __pending_event_id: evt.event_id,
    };
  }
};

export const clockOutShift = async (shiftId: number) => {
  try {
    const response = await api.post('/api/attendance/clock-out', { shift_id: shiftId });
    return response.data;
  } catch (err) {
    const evt = {
      event_id: uuid(),
      user_id: undefined,
      device_id: localStorage.getItem('deviceId') || 'unknown-device',
      type: 'attendance_clock_out',
      timestamp_utc: toUtcIso(new Date()),
      payload_json: JSON.stringify({ shift_id: shiftId }),
      created_at: toUtcIso(new Date()),
    };
    await (window as any)?.api?.timeEvents?.insert?.(evt);
    return {
      id: shiftId,
      clock_out: new Date().toISOString(),
      __pending: true,
      __pending_event_id: evt.event_id,
    };
  }
};

export const createShift = async (profileId: number, clockInISO: string, clockOutISO: string) => {
  try {
    const response = await api.post('/api/attendance/manual', {
      profile_id: profileId,
      clock_in: clockInISO,
      clock_out: clockOutISO,
    });
    return response.data;
  } catch (err) {
    throw err;
  }
};

export const updateShift = async (shiftId: number, clockIn: string, clockOut: string) => {
  try {
    const response = await api.put(`/api/attendance/${shiftId}`, { clock_in: clockIn, clock_out: clockOut });
    return response.data;
  } catch (err: any) {
    if (err?.response) {
      throw err;
    }

    const evt = {
      event_id: uuid(),
      device_id: localStorage.getItem('deviceId') || 'unknown-device',
      type: 'attendance_update',
      timestamp_utc: toUtcIso(new Date()),
      payload_json: JSON.stringify({ shift_id: shiftId, clock_in: clockIn, clock_out: clockOut }),
      created_at: toUtcIso(new Date()),
    };
    await (window as any)?.api?.timeEvents?.insert?.(evt);
    return { id: shiftId, clock_in: clockIn, clock_out: clockOut, __pending: true, __pending_event_id: evt.event_id };
  }
};

export const getShiftsInRange = async (profileId: number, from: string, to: string) => {
  const response = await api.get('/api/attendance', { params: { profile_id: profileId, from, to } });
  return response.data;
};

export const deleteShift = async (shiftId: number): Promise<void> => {
  await api.delete(`/api/attendance/${shiftId}`);
};
