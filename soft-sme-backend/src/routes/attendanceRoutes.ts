import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { pool, getTenantPool } from '../db';

async function getDailyBreakTimes() {
  const [breakStartRes, breakEndRes] = await Promise.all([
    pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'"),
    pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'")
  ]);
  const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
  const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;
  return { dailyBreakStart, dailyBreakEnd };
}
const DEFAULT_TIMEZONE = process.env.TIME_TRACKING_TIMEZONE || process.env.TZ || 'UTC';

function normalizeTimeZone(timeZone?: string | null): string {
  const candidate = (timeZone || '').toString().trim();
  if (!candidate) {
    return DEFAULT_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    console.warn(`Invalid timezone "${candidate}" supplied. Falling back to ${DEFAULT_TIMEZONE}.`);
    return DEFAULT_TIMEZONE;
  }
}

function getDatePartsInZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const lookup = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const lookup = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  const utcEquivalent = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );

  return (utcEquivalent - date.getTime()) / (1000 * 60);
}

function makeZonedDate(baseDate: Date, timeStr: string, timeZone: string): Date {
  const [rawHour = '0', rawMinute = '0'] = timeStr.split(':');
  const hours = Number(rawHour);
  const minutes = Number(rawMinute);

  const { year, month, day } = getDatePartsInZone(baseDate, timeZone);
  const candidateUtc = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const offsetMinutes = getTimeZoneOffset(candidateUtc, timeZone);
  return new Date(candidateUtc.getTime() - offsetMinutes * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Helper function to calculate effective duration, excluding daily break times
function calculateEffectiveDuration(
  clockIn: Date,
  clockOut: Date,
  breakStartStr: string | null,
  breakEndStr: string | null,
  timeZone?: string | null,
): number {
  let durationMs = clockOut.getTime() - clockIn.getTime();

  if (breakStartStr && breakEndStr) {
    const resolvedTimeZone = normalizeTimeZone(timeZone);
    const breakStartTime = makeZonedDate(clockIn, breakStartStr, resolvedTimeZone);
    let breakEndTime = makeZonedDate(clockIn, breakEndStr, resolvedTimeZone);

    if (breakEndTime.getTime() <= breakStartTime.getTime()) {
      breakEndTime = makeZonedDate(addDays(clockIn, 1), breakEndStr, resolvedTimeZone);
    }

    const isMultiDayShift =
      clockOut.getUTCDate() !== clockIn.getUTCDate() ||
      clockOut.getUTCMonth() !== clockIn.getUTCMonth() ||
      clockOut.getUTCFullYear() !== clockIn.getUTCFullYear();

    if (isMultiDayShift) {
      const daysDiff = Math.round(
        (Date.UTC(clockOut.getUTCFullYear(), clockOut.getUTCMonth(), clockOut.getUTCDate()) -
          Date.UTC(clockIn.getUTCFullYear(), clockIn.getUTCMonth(), clockIn.getUTCDate())) /
          (1000 * 60 * 60 * 24),
      );

      for (let i = 0; i <= daysDiff; i++) {
        const baseDay = addDays(clockIn, i);
        const currentDayBreakStart = makeZonedDate(baseDay, breakStartStr, resolvedTimeZone);
        let currentDayBreakEnd = makeZonedDate(baseDay, breakEndStr, resolvedTimeZone);

        if (currentDayBreakEnd.getTime() <= currentDayBreakStart.getTime()) {
          currentDayBreakEnd = makeZonedDate(addDays(baseDay, 1), breakEndStr, resolvedTimeZone);
        }

        const overlapStart = Math.max(clockIn.getTime(), currentDayBreakStart.getTime());
        const overlapEnd = Math.min(clockOut.getTime(), currentDayBreakEnd.getTime());

        if (overlapEnd > overlapStart) {
          const breakDurationMs = overlapEnd - overlapStart;
          durationMs -= breakDurationMs;
          console.log(`Break deducted: ${breakDurationMs / (1000 * 60)} minutes for day ${i + 1}`);
        }
      }
    } else {
      const overlapStart = Math.max(clockIn.getTime(), breakStartTime.getTime());
      const overlapEnd = Math.min(clockOut.getTime(), breakEndTime.getTime());

      if (overlapEnd > overlapStart) {
        const breakDurationMs = overlapEnd - overlapStart;
        durationMs -= breakDurationMs;
        console.log(`Break deducted: ${breakDurationMs / (1000 * 60)} minutes`);
      }
    }
  }

  const durationHours = Math.max(0, durationMs / (1000 * 60 * 60));
  return Math.round(durationHours * 100) / 100;
}

type GeoFenceSettings = {
  enabled: boolean;
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
};

const toBoolean = (value: any): boolean => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized);
  }
  return Boolean(value);
};

async function loadGeoFenceSettings(db: Pool = pool): Promise<GeoFenceSettings> {
  const result = await db.query(
    `SELECT geo_fence_enabled, geo_fence_center_latitude, geo_fence_center_longitude, geo_fence_radius_meters
     FROM business_profile
     ORDER BY id DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return { enabled: false, centerLat: null, centerLng: null, radiusMeters: null };
  }

  const row = result.rows[0];
  return {
    enabled: toBoolean(row.geo_fence_enabled),
    centerLat: row.geo_fence_center_latitude !== null ? Number(row.geo_fence_center_latitude) : null,
    centerLng: row.geo_fence_center_longitude !== null ? Number(row.geo_fence_center_longitude) : null,
    radiusMeters: row.geo_fence_radius_meters !== null ? Number(row.geo_fence_radius_meters) : null,
  };
}

const isGeoFenceActive = (fence: GeoFenceSettings) =>
  fence.enabled && fence.centerLat !== null && fence.centerLng !== null && fence.radiusMeters !== null;

const haversineDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const router = express.Router();

router.get('/geofence', async (_req: Request, res: Response) => {
  try {
    const fence = await loadGeoFenceSettings(getTenantPool());
    res.json({
      enabled: fence.enabled,
      configured: isGeoFenceActive(fence),
      center_latitude: fence.centerLat,
      center_longitude: fence.centerLng,
      radius_meters: fence.radiusMeters,
    });
  } catch (err) {
    console.error('attendanceRoutes: Error fetching geofence settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List/filter shifts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { profile_id, from, to } = req.query;
    let query = `
      SELECT 
        s.*,
        p.name as profile_name,
        p.email as profile_email
      FROM attendance_shifts s
      LEFT JOIN profiles p ON s.profile_id = p.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (profile_id) {
      conditions.push('s.profile_id = $' + (params.length + 1));
      params.push(profile_id);
    }
    if (from) {
      conditions.push('s.clock_in >= $' + (params.length + 1));
      params.push(from);
    }
    if (to) {
      conditions.push('s.clock_in <= $' + (params.length + 1));
      params.push(to);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY s.clock_in DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('attendanceRoutes: Error fetching shifts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock in
router.post('/clock-in', async (req: Request, res: Response) => {
  const { profile_id, latitude, longitude } = req.body;
  try {
    const tenantPool = getTenantPool();

    // Prevent multiple open shifts
    const open = await tenantPool.query(
      'SELECT * FROM attendance_shifts WHERE profile_id = $1 AND clock_out IS NULL',
      [profile_id]
    );
    if (open.rows.length > 0) {
      return res.status(400).json({ error: 'Already clocked in. Please clock out first.' });
    }

    const geofence = await loadGeoFenceSettings(tenantPool);
    let geofenceCheck: { within: boolean; distance_meters: number; radius_meters: number | null } | null = null;
    if (isGeoFenceActive(geofence)) {
      const latNum = latitude === undefined || latitude === null || latitude === '' ? NaN : Number(latitude);
      const lngNum = longitude === undefined || longitude === null || longitude === '' ? NaN : Number(longitude);

      if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
        return res.status(400).json({
          error: 'Location required',
          message: 'Location is required to clock in because a geofence is enabled for this business. Please enable location services and try again.',
        });
      }

      const distanceMeters = haversineDistanceMeters(latNum, lngNum, geofence.centerLat as number, geofence.centerLng as number);
      geofenceCheck = {
        within: distanceMeters <= (geofence.radiusMeters as number),
        distance_meters: Math.round(distanceMeters),
        radius_meters: geofence.radiusMeters,
      };

      if (!geofenceCheck.within) {
        return res.status(403).json({
          error: 'Outside geofence',
          message: 'You are outside the allowed clock-in area. Move inside the geofence and try again.',
          geofence: {
            ...geofenceCheck,
            center_latitude: geofence.centerLat,
            center_longitude: geofence.centerLng,
          },
        });
      }
    }

    const result = await tenantPool.query(
      'INSERT INTO attendance_shifts (profile_id, clock_in) VALUES ($1, NOW()) RETURNING *',
      [profile_id]
    );
    res.status(201).json({ ...result.rows[0], geofence: geofenceCheck });
  } catch (err) {
    console.error('attendanceRoutes: Error clocking in:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get the current open shift for a profile (helper for mobile)
router.get('/active', async (req: Request, res: Response) => {
  const profileId = Number(req.query.profile_id);
  if (!profileId || Number.isNaN(profileId)) {
    return res.status(400).json({ error: 'A valid profile_id is required' });
  }

  try {
    const result = await pool.query(
      `SELECT *
       FROM attendance_shifts
       WHERE profile_id = $1 AND clock_out IS NULL
       ORDER BY clock_in DESC
       LIMIT 1`,
      [profileId]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error fetching active shift:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual shift creation
router.post('/manual', async (req: Request, res: Response) => {
  const { profile_id, clock_in, clock_out } = req.body;
  const profileId = Number(profile_id);

  if (!profile_id || Number.isNaN(profileId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'A valid profile_id is required.',
    });
  }

  if (!clock_in || !clock_out) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'clock_in and clock_out are required.',
    });
  }

  const clockInDate = new Date(clock_in);
  const clockOutDate = new Date(clock_out);

  if (Number.isNaN(clockInDate.getTime()) || Number.isNaN(clockOutDate.getTime())) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'clock_in and clock_out must be valid ISO timestamps.',
    });
  }

  if (clockInDate >= clockOutDate) {
    return res.status(400).json({
      error: 'Invalid Range',
      message: 'clock_out must be later than clock_in.',
    });
  }

  try {
    const requestTimeZone = req.headers['x-timezone'] as string | undefined;
    const { dailyBreakStart, dailyBreakEnd } = await getDailyBreakTimes();

    const overlapRes = await pool.query(
      `SELECT 1
       FROM attendance_shifts
       WHERE profile_id = $1
         AND tstzrange(clock_in, COALESCE(clock_out, 'infinity'), '[)')
             && tstzrange($2::timestamptz, $3::timestamptz, '[)')
       LIMIT 1`,
      [profileId, clockInDate.toISOString(), clockOutDate.toISOString()]
    );

    if (overlapRes.rows.length > 0) {
      return res.status(400).json({
        error: 'Shift Overlap',
        message: 'This shift overlaps another shift for the selected profile.',
      });
    }

    const duration = calculateEffectiveDuration(
      clockInDate,
      clockOutDate,
      dailyBreakStart,
      dailyBreakEnd,
      requestTimeZone,
    );

    const insertRes = await pool.query(
      `INSERT INTO attendance_shifts (profile_id, clock_in, clock_out, duration, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [profileId, clockInDate.toISOString(), clockOutDate.toISOString(), duration]
    );

    const insertedId = insertRes.rows[0].id;

    const shiftRes = await pool.query(
      `SELECT s.*, p.name as profile_name, p.email as profile_email
       FROM attendance_shifts s
       LEFT JOIN profiles p ON s.profile_id = p.id
       WHERE s.id = $1`,
      [insertedId]
    );

    return res.status(201).json(shiftRes.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error creating manual shift:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Unable to create manual shift.',
    });
  }
});
// Clock out
router.post('/clock-out', async (req: Request, res: Response) => {
  const { shift_id, profile_id } = req.body;
  try {
    const requestTimeZone = req.headers['x-timezone'] as string | undefined;
    // Get daily break times
    const breakStartRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'");
    const breakEndRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'");
    const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
    const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;

    const clockOutTime = new Date();
    let targetShiftId = shift_id;
    let shiftRes;

    if (!targetShiftId && !profile_id) {
      return res.status(400).json({ error: 'shift_id or profile_id is required to clock out.' });
    }

    if (!targetShiftId && profile_id) {
      shiftRes = await pool.query(
        'SELECT * FROM attendance_shifts WHERE profile_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
        [profile_id]
      );
      if (shiftRes.rows.length === 0) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      targetShiftId = shiftRes.rows[0].id;
    } else {
      shiftRes = await pool.query('SELECT * FROM attendance_shifts WHERE id = $1', [targetShiftId]);
      if (shiftRes.rows.length === 0) {
        return res.status(404).json({ error: 'Shift not found' });
      }
    }

    const clockInTime = new Date(shiftRes.rows[0].clock_in);

    console.log('Clock-out Debug:');
    console.log('  clockInTime:', clockInTime);
    console.log('  clockOutTime:', clockOutTime);
    console.log('  dailyBreakStart:', dailyBreakStart);
    console.log('  dailyBreakEnd:', dailyBreakEnd);

    const effectiveDuration = calculateEffectiveDuration(
      clockInTime,
      clockOutTime,
      dailyBreakStart,
      dailyBreakEnd,
      requestTimeZone,
    );
    console.log('  effectiveDuration:', effectiveDuration);

    const result = await pool.query(
      'UPDATE attendance_shifts SET clock_out = $1, duration = $2, updated_at = NOW() WHERE id = $3 AND clock_out IS NULL RETURNING *',
      [clockOutTime, effectiveDuration, targetShiftId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No open shift found to clock out.' });
    }

    // Automatically clock out the last open time entry for this profile
    const profileId = result.rows[0].profile_id;
    const openTimeEntryRes = await pool.query(
      'SELECT id FROM time_entries WHERE profile_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
      [profileId]
    );

    if (openTimeEntryRes.rows.length > 0) {
      const timeEntryId = openTimeEntryRes.rows[0].id;
      const timeEntryClockOutTime = new Date();
      const timeEntryRes = await pool.query('SELECT clock_in FROM time_entries WHERE id = $1', [timeEntryId]);
      const timeEntryClockInTime = new Date(timeEntryRes.rows[0].clock_in);
      const timeEntryEffectiveDuration = calculateEffectiveDuration(
        timeEntryClockInTime,
        timeEntryClockOutTime,
        dailyBreakStart,
        dailyBreakEnd,
        requestTimeZone,
      );

      await pool.query(
        'UPDATE time_entries SET clock_out = $1, duration = $2 WHERE id = $3',
        [timeEntryClockOutTime, timeEntryEffectiveDuration, timeEntryId]
      );

      // Recalculate sales order line items
      const salesOrderIdRes = await pool.query('SELECT sales_order_id FROM time_entries WHERE id = $1', [timeEntryId]);
      if (salesOrderIdRes.rows.length > 0) {
        const soId = salesOrderIdRes.rows[0].sales_order_id;
        const sumRes = await pool.query(
          `SELECT SUM(duration) as total_hours
           FROM time_entries WHERE sales_order_id = $1 AND clock_out IS NOT NULL`,
          [soId]
        );
        const totalHours = parseFloat(sumRes.rows[0].total_hours) || 0;
        
        // Get global labour rate
        const labourRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
        const avgRate = labourRateRes.rows.length > 0 ? parseFloat(labourRateRes.rows[0].value) : 60;
        const totalCost = totalHours * avgRate;

        const overheadRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'overhead_rate'");
        const overheadRate = overheadRateRes.rows.length > 0 ? parseFloat(overheadRateRes.rows[0].value) : 0;
        const totalOverheadCost = totalHours * overheadRate;

        const labourRes = await pool.query(
          `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
          [soId]
        );
        if (labourRes.rows.length > 0) {
          await pool.query(
            `UPDATE salesorderlineitems SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND part_number = 'LABOUR'`,
            ['Labour Hours', totalHours, 'hr', avgRate, totalHours * avgRate, soId]
          );
        } else {
          await pool.query(
            `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
             VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)`,
            [soId, 'Labour Hours', totalHours, 'hr', avgRate, totalHours * avgRate]
          );
        }

        const overheadRes = await pool.query(
          `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'OVERHEAD'`,
          [soId]
        );
        if (overheadRes.rows.length > 0) {
          await pool.query(
            `UPDATE salesorderlineitems SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND part_number = 'OVERHEAD'`,
            ['Overhead Hours', totalHours, 'hr', overheadRate, totalHours * overheadRate, soId]
          );
        } else {
          await pool.query(
            `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
             VALUES ($1, 'OVERHEAD', $2, $3, $4, $5, $6)`,
            [soId, 'Overhead Hours', totalHours, 'hr', overheadRate, totalHours * overheadRate]
          );
        }
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error clocking out:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit shift (admin)
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { clock_in, clock_out } = req.body;

  try {
    const requestTimeZone = req.headers['x-timezone'] as string | undefined;
    const shiftRes = await pool.query('SELECT * FROM attendance_shifts WHERE id = $1', [id]);
    if (shiftRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Shift Not Found',
        message: 'Shift not found.',
      });
    }

    const shift = shiftRes.rows[0];
    const profileId = Number(shift.profile_id);

    if (!clock_in) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'clock_in is required.',
      });
    }

    const newClockInDate = new Date(clock_in);
    if (Number.isNaN(newClockInDate.getTime())) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'clock_in must be a valid ISO timestamp.',
      });
    }

    let newClockOutDate: Date | null = null;
    if (clock_out !== null && clock_out !== undefined && clock_out !== '') {
      newClockOutDate = new Date(clock_out);
      if (Number.isNaN(newClockOutDate.getTime())) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'clock_out must be a valid ISO timestamp.',
        });
      }

      if (newClockInDate >= newClockOutDate) {
        return res.status(400).json({
          error: 'Invalid Range',
          message: 'clock_out must be later than clock_in.',
        });
      }
    }

    const overlapRes = await pool.query(
      `SELECT 1
       FROM attendance_shifts
       WHERE profile_id = $1
         AND id <> $2
         AND tstzrange(clock_in, COALESCE(clock_out, 'infinity'), '[)')
             && tstzrange($3::timestamptz, COALESCE($4::timestamptz, 'infinity'), '[)')
       LIMIT 1`,
      [profileId, id, newClockInDate.toISOString(), newClockOutDate ? newClockOutDate.toISOString() : null]
    );

    if (overlapRes.rows.length > 0) {
      return res.status(400).json({
        error: 'Shift Overlap',
        message: 'This shift overlaps another shift for the selected profile.',
      });
    }

    const originalClockIn = new Date(shift.clock_in);
    const originalClockOut = shift.clock_out ? new Date(shift.clock_out) : null;

    const timeEntryParams: any[] = [profileId, originalClockIn.toISOString()];
    let timeEntryQuery = `
      SELECT id, clock_in, clock_out
      FROM time_entries
      WHERE profile_id = $1
        AND clock_in >= $2
    `;
    if (originalClockOut) {
      timeEntryQuery += ' AND clock_in < $3';
      timeEntryParams.push(originalClockOut.toISOString());
    }
    const timeEntriesRes = await pool.query(timeEntryQuery, timeEntryParams);

    for (const entry of timeEntriesRes.rows) {
      const entryClockIn = new Date(entry.clock_in);
      if (entryClockIn < newClockInDate) {
        return res.status(400).json({
          error: 'Shift Outside Time Entries',
          message: 'Adjust the sales-order entries before shortening this shift.',
        });
      }

      if (newClockOutDate) {
        if (!entry.clock_out) {
          return res.status(400).json({
            error: 'Shift Outside Time Entries',
            message: 'Adjust the sales-order entries before shortening this shift.',
          });
        }
        const entryClockOut = new Date(entry.clock_out);
        if (entryClockOut > newClockOutDate) {
          return res.status(400).json({
            error: 'Shift Outside Time Entries',
            message: 'Adjust the sales-order entries before shortening this shift.',
          });
        }
      }
    }

    let duration: number | null = null;
    if (newClockOutDate) {
      const { dailyBreakStart, dailyBreakEnd } = await getDailyBreakTimes();
      duration = calculateEffectiveDuration(
        newClockInDate,
        newClockOutDate,
        dailyBreakStart,
        dailyBreakEnd,
        requestTimeZone,
      );
    }

    const updateRes = await pool.query(
      `UPDATE attendance_shifts
       SET clock_in = $1, clock_out = $2, duration = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [newClockInDate.toISOString(), newClockOutDate ? newClockOutDate.toISOString() : null, duration, id]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Shift Not Found',
        message: 'Shift not found.',
      });
    }

    const updatedShiftRes = await pool.query(
      `SELECT s.*, p.name as profile_name, p.email as profile_email
       FROM attendance_shifts s
       LEFT JOIN profiles p ON s.profile_id = p.id
       WHERE s.id = $1`,
      [id]
    );

    return res.json(updatedShiftRes.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error editing shift:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Unable to update shift.',
    });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const shiftRes = await pool.query(
      `SELECT id, profile_id, clock_in, clock_out
       FROM attendance_shifts
       WHERE id = $1`,
      [id]
    );

    if (shiftRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Shift Not Found',
        message: 'Shift not found.',
      });
    }

    const shift = shiftRes.rows[0];

    const overlapRes = await pool.query(
      `SELECT id
       FROM time_entries
       WHERE profile_id = $1
         AND tstzrange(clock_in, COALESCE(clock_out, 'infinity'::timestamptz), '[)')
             && tstzrange($2::timestamptz, COALESCE($3::timestamptz, 'infinity'::timestamptz), '[)')
       LIMIT 1`,
      [shift.profile_id, shift.clock_in, shift.clock_out]
    );

    if (overlapRes.rows.length > 0) {
      return res.status(400).json({
        error: 'Shift Has Time Entries',
        message: 'Delete or adjust time entries linked to this shift before deleting it.',
      });
    }

    await pool.query('DELETE FROM attendance_shifts WHERE id = $1', [id]);

    return res.status(204).send();
  } catch (err) {
    console.error('attendanceRoutes: Error deleting shift:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
// List unclosed shifts (for warnings)
router.get('/unclosed', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM attendance_shifts WHERE clock_out IS NULL AND clock_in < NOW()::date`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('attendanceRoutes: Error fetching unclosed shifts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export CSV/PDF (stub)
router.get('/export', async (req: Request, res: Response) => {
  // TODO: Implement export logic
  res.status(501).json({ error: 'Export not implemented yet' });
});

export default router;

