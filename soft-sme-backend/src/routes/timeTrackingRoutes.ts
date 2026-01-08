import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import Papa from 'papaparse';
import { SalesOrderService } from '../services/SalesOrderService';
import { resolveTenantUserId } from '../utils/tenantUser';

const DEFAULT_TIMEZONE = process.env.TIME_TRACKING_TIMEZONE || process.env.TZ || 'UTC';

function normalizeTimeZone(timeZone?: string | null): string {
  const candidate = (timeZone || '').toString().trim();
  if (!candidate) {
    return DEFAULT_TIMEZONE;
  }
  try {
    // Validate the timezone by attempting to format a date
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch (err) {
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

    // Handle overnight breaks (e.g., 23:00 - 01:00)
    if (breakEndTime.getTime() <= breakStartTime.getTime()) {
      breakEndTime = makeZonedDate(addDays(clockIn, 1), breakEndStr, resolvedTimeZone);
    }

    // Check if shift spans multiple days
    const isMultiDayShift =
      clockOut.getUTCDate() !== clockIn.getUTCDate() ||
      clockOut.getUTCMonth() !== clockIn.getUTCMonth() ||
      clockOut.getUTCFullYear() !== clockIn.getUTCFullYear();

    if (isMultiDayShift) {
      // Multi-day shift - handle breaks for each day
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

const router = express.Router();
const salesOrderService = new SalesOrderService(pool);

function parseDurationHours(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }

    const hhmmssMatch = trimmed.match(/^(-?)(\d+):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (hhmmssMatch) {
      const sign = hhmmssMatch[1] === '-' ? -1 : 1;
      const hours = parseInt(hhmmssMatch[2], 10);
      const minutes = parseInt(hhmmssMatch[3], 10);
      const seconds = hhmmssMatch[4] ? parseInt(hhmmssMatch[4], 10) : 0;
      if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        return null;
      }
      return sign * (hours + minutes / 60 + seconds / 3600);
    }

    const isoDurationMatch = trimmed.match(/^(-)?P?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
    if (isoDurationMatch) {
      const sign = isoDurationMatch[1] === '-' ? -1 : 1;
      const hours = isoDurationMatch[2] ? parseFloat(isoDurationMatch[2]) : 0;
      const minutes = isoDurationMatch[3] ? parseFloat(isoDurationMatch[3]) : 0;
      const seconds = isoDurationMatch[4] ? parseFloat(isoDurationMatch[4]) : 0;
      if ([hours, minutes, seconds].some(part => Number.isNaN(part))) {
        return null;
      }
      return sign * (hours + minutes / 60 + seconds / 3600);
    }
  }

  return null;
}

function formatDurationForOutput(value: unknown, fractionDigits = 2): string {
  const parsed = parseDurationHours(value);
  return parsed !== null ? parsed.toFixed(fractionDigits) : '';
}

type AttendanceShiftWindow = {
  clock_in: string;
  clock_out: string | null;
};

function normalizeToMinute(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setSeconds(0, 0);
  return normalized;
}

function isTimeRangeCoveredByAttendanceShifts(start: Date, end: Date, shifts: AttendanceShiftWindow[]): boolean {
  if (shifts.length === 0) {
    return false;
  }

  const normalizedStart = normalizeToMinute(start);
  const normalizedEnd = normalizeToMinute(end);

  const sorted = shifts
    .map(shift => ({
      start: normalizeToMinute(new Date(shift.clock_in)),
      end: shift.clock_out ? normalizeToMinute(new Date(shift.clock_out)) : null,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const endTime = normalizedEnd.getTime();
  let cursor = normalizedStart.getTime();

  for (const shift of sorted) {
    const shiftStart = shift.start.getTime();
    const shiftEnd = shift.end ? shift.end.getTime() : Number.POSITIVE_INFINITY;

    if (shiftEnd < cursor) {
      continue;
    }

    if (shiftStart > cursor) {
      return false;
    }

    if (shiftEnd >= endTime) {
      return true;
    }

    cursor = shiftEnd;
  }

  return false;
}

async function recalcSalesOrderLabourOverheadAndSupply(soId: number) {
  try {
    const sumRes = await pool.query(
      `SELECT COALESCE(SUM(duration), 0) as total_hours
       FROM time_entries
       WHERE sales_order_id = $1 AND clock_out IS NOT NULL`,
      [soId]
    );
    const totalHours = parseFloat(sumRes.rows[0]?.total_hours) || 0;

    const labourRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
    const labourRate = labourRateRes.rows.length > 0 ? parseFloat(labourRateRes.rows[0].value) : 60;
    const labourTotal = totalHours * labourRate;

    const overheadRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'overhead_rate'");
    const overheadRate = overheadRateRes.rows.length > 0 ? parseFloat(overheadRateRes.rows[0].value) : 0;
    const overheadTotal = totalHours * overheadRate;

    const labourRes = await pool.query(
      `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
      [soId]
    );

    if (labourRes.rows.length > 0) {
      await pool.query(
        `UPDATE salesorderlineitems
         SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5
         WHERE sales_order_id = $6 AND part_number = 'LABOUR'`,
        ['Labour Hours', totalHours, 'hr', labourRate, labourTotal, soId]
      );
    } else {
      await pool.query(
        `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
         VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)`,
        [soId, 'Labour Hours', totalHours, 'hr', labourRate, labourTotal]
      );
    }

    const overheadRes = await pool.query(
      `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'OVERHEAD'`,
      [soId]
    );

    if (overheadRes.rows.length > 0) {
      await pool.query(
        `UPDATE salesorderlineitems
         SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5
         WHERE sales_order_id = $6 AND part_number = 'OVERHEAD'`,
        ['Overhead Hours', totalHours, 'hr', overheadRate, overheadTotal, soId]
      );
    } else {
      await pool.query(
        `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
         VALUES ($1, 'OVERHEAD', $2, $3, $4, $5, $6)`,
        [soId, 'Overhead Hours', totalHours, 'hr', overheadRate, overheadTotal]
      );
    }

    const labourLineAmount = labourTotal;
    const supplyRateRes = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['supply_rate']);
    const supplyRate = supplyRateRes.rows.length > 0 ? parseFloat(supplyRateRes.rows[0].value) : 0;
    const existingSupplyResult = await pool.query(
      'SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
      [soId, 'SUPPLY']
    );

    if (supplyRate > 0 && labourLineAmount > 0) {
      const supplyAmount = labourLineAmount * (supplyRate / 100);

      if (existingSupplyResult.rows.length > 0) {
        await pool.query(
          `UPDATE salesorderlineitems
           SET line_amount = $1, unit_price = $2, updated_at = NOW()
           WHERE sales_order_id = $3 AND part_number = $4`,
          [supplyAmount, supplyAmount, soId, 'SUPPLY']
        );
      } else {
        await pool.query(
          `INSERT INTO salesorderlineitems
             (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [soId, 'SUPPLY', 'Supply', 1, 'Each', supplyAmount, supplyAmount]
        );
      }
    } else if (existingSupplyResult.rows.length > 0) {
      await pool.query(
        `UPDATE salesorderlineitems
         SET line_amount = 0, unit_price = 0, updated_at = NOW()
         WHERE sales_order_id = $1 AND part_number = $2`,
        [soId, 'SUPPLY']
      );
    }

    try {
      await salesOrderService.recalculateAndUpdateSummary(soId);
    } catch (error) {
      console.warn(`⚠️ Failed to recalculate totals for sales order ${soId}:`, error);
    }
  } catch (error) {
    console.error(`Failed to recalculate labour/overhead for sales order ${soId}:`, error);
  }
}

// Role-based access middleware
function mobileTimeTrackerOnly(req: Request, res: Response, next: Function) {
  if (
    req.user?.access_role === 'Mobile Time Tracker' ||
    req.user?.access_role === 'Time Tracking' ||
    req.user?.access_role === 'Admin'
  ) {
    return next();
  }
  return res.status(403).json({ message: 'Not authorized' });
}

// Apply the middleware to all routes except profiles, sales-orders, and time tracking endpoints
router.use((req: Request, res: Response, next: Function) => {
  // Allow access to profiles, sales-orders, and time tracking endpoints for all authenticated users
  if (req.path === '/profiles' || req.path.startsWith('/sales-orders') || req.path.startsWith('/time-entries')) {
    return next();
  }
  // Apply mobileTimeTrackerOnly middleware for other routes
  return mobileTimeTrackerOnly(req, res, next);
});

// Get time entries for a given date
router.get('/time-entries', async (req: Request, res: Response) => {
  const { date, profile_id } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Date query parameter is required' });
  }

  try {
    let query = `SELECT
      te.id,
      te.profile_id,
      p.name as profile_name,
      te.sales_order_id,
      soh.sales_order_number,
      soh.product_name,
      te.clock_in,
      te.clock_out,
      te.duration,
      te.unit_price
    FROM
      time_entries te
    JOIN
      profiles p ON te.profile_id = p.id
    JOIN
      salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
    WHERE
      te.clock_in::date = $1`;
    const params: any[] = [date];
    if (profile_id) {
      query += ' AND te.profile_id = $2';
      params.push(profile_id);
    }
    query += ' ORDER BY te.clock_in DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching time entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock-in
router.post('/time-entries/clock-in', async (req: Request, res: Response) => {
  const { profile_id, so_id } = req.body;

  if (!profile_id || !so_id) {
    return res.status(400).json({ 
      error: 'Missing Required Fields',
      message: 'Profile ID and Sales Order ID are required to clock in for time tracking.',
      details: 'Please ensure you have selected both a profile and a sales order before attempting to clock in.'
    });
  }

  try {
    // Check if profile is clocked in for attendance
    const attendanceCheck = await pool.query(
      'SELECT * FROM attendance_shifts WHERE profile_id = $1 AND clock_out IS NULL',
      [profile_id]
    );

    if (attendanceCheck.rows.length === 0) {
      return res.status(400).json({ 
        error: 'Attendance Required', 
        message: 'You must clock in for attendance before you can clock in for time tracking on a sales order.',
        details: 'Please go to the Attendance page and clock in first, then return here to track time on sales orders.'
      });
    }

    // Check if profile already has an open time entry (prevent overlapping entries)
    const openTimeEntryCheck = await pool.query(
      'SELECT * FROM time_entries WHERE profile_id = $1 AND clock_out IS NULL',
      [profile_id]
    );

    if (openTimeEntryCheck.rows.length > 0) {
      const openEntry = openTimeEntryCheck.rows[0];
      const salesOrderResult = await pool.query(
        'SELECT sales_order_number FROM salesorderhistory WHERE sales_order_id = $1',
        [openEntry.sales_order_id]
      );
      const currentSO = salesOrderResult.rows[0]?.sales_order_number || 'Unknown';
      
      return res.status(400).json({ 
        error: 'Already Clocked In', 
        message: `You are already clocked in to sales order ${currentSO}. Please clock out first before clocking into another sales order.`,
        details: 'You can only be clocked into one sales order at a time.'
      });
    }

    // Get global labour rate
    const rateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
    const unit_price = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].value) : 0;

    const result = await pool.query(
      'INSERT INTO time_entries (profile_id, sales_order_id, clock_in, unit_price) VALUES ($1, $2, date_trunc(\'minute\', NOW()), $3) RETURNING *',
      [profile_id, so_id, unit_price]
    );
    
    // Fetch newly created entry with joins for the response
    const newEntryRes = await pool.query(
      `SELECT
        te.id, te.profile_id, p.name as profile_name, te.sales_order_id, soh.sales_order_number,
        soh.product_name, te.clock_in, te.clock_out, te.duration, te.unit_price
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
      WHERE te.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json(newEntryRes.rows[0]);
    
    // Note: No sales order recalculation needed here since we're only creating a time entry
    // Sales order totals will be recalculated when the time entry is completed (clock-out)
    // or when the time entry is edited
  } catch (err) {
    console.error('Error clocking in:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock-out
router.post('/time-entries/:id/clock-out', async (req: Request, res: Response) => {
  const { id } = req.params;

  console.log('Clock out route hit for ID:', id);

  try {
    const requestTimeZone = req.headers['x-timezone'] as string | undefined;
    const techStoryEntry = typeof req.body?.tech_story_entry === 'string' ? req.body.tech_story_entry.trim() : '';
    // Get daily break times
    const breakStartRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'");
    const breakEndRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'");
    const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
    const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;

    const clockOutTime = normalizeToMinute(new Date());
    const timeEntryRes = await pool.query('SELECT clock_in FROM time_entries WHERE id = $1', [id]);

    if (timeEntryRes.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    const clockInTime = normalizeToMinute(new Date(timeEntryRes.rows[0].clock_in));
    const effectiveDuration = calculateEffectiveDuration(
      clockInTime,
      clockOutTime,
      dailyBreakStart,
      dailyBreakEnd,
      requestTimeZone,
    );

    const clockOutRes = await pool.query(
      'UPDATE time_entries SET clock_out = $1, duration = $2 WHERE id = $3 AND clock_out IS NULL RETURNING *',
      [clockOutTime, effectiveDuration, id]
    );

    console.log('Clock out DB result:', clockOutRes.rows);
    if (clockOutRes.rows.length > 0) {
      console.log('Duration calculated:', clockOutRes.rows[0].duration);
      console.log('Duration type:', typeof clockOutRes.rows[0].duration);
    }

    if (clockOutRes.rows.length === 0) {
      console.log('No open time entry found for ID:', id);
      return res.status(404).json({ error: 'Time entry not found or already clocked out' });
    }
    
    // Fetch updated entry with joins for the response
    const updatedEntryRes = await pool.query(
      `SELECT
        te.id, te.profile_id, p.name as profile_name, te.sales_order_id, soh.sales_order_number,
        soh.product_name, te.clock_in, te.clock_out, te.duration, te.unit_price
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
      WHERE te.id = $1`,
      [id]
    );

    const updatedEntry = updatedEntryRes.rows[0];
    let updatedTechStory: string | undefined;

    if (techStoryEntry && updatedEntry) {
      const storyTimeZone = normalizeTimeZone(requestTimeZone);
      const formattedDate = new Intl.DateTimeFormat('en-CA', { timeZone: storyTimeZone }).format(clockOutTime);
      const durationValue = typeof updatedEntry.duration === 'number'
        ? updatedEntry.duration
        : parseFloat(updatedEntry.duration ?? clockOutRes.rows[0]?.duration ?? effectiveDuration ?? 0);
      const durationLabel = Number.isFinite(durationValue) ? durationValue.toFixed(2) : '0.00';
      const profileName = updatedEntry.profile_name || 'Technician';

      const existingStoryRes = await pool.query(
        'SELECT tech_story FROM salesorderhistory WHERE sales_order_id = $1',
        [updatedEntry.sales_order_id]
      );
      const existingStory = existingStoryRes.rows[0]?.tech_story ?? '';
      const newEntry = `${profileName} - ${formattedDate} (${durationLabel} hrs)\n${techStoryEntry}`;
      updatedTechStory = [existingStory?.trim(), newEntry.trim()].filter(Boolean).join('\n\n');

      await pool.query(
        'UPDATE salesorderhistory SET tech_story = $1, updated_at = NOW() WHERE sales_order_id = $2',
        [updatedTechStory, updatedEntry.sales_order_id]
      );
    }

    if (updatedEntry?.sales_order_id) {
      await recalcSalesOrderLabourOverheadAndSupply(updatedEntry.sales_order_id);
    }

    res.json({
      ...updatedEntry,
      tech_story: updatedTechStory,
    });
  } catch (err) {
    console.error('Error clocking out:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit a time entry (clock_in and clock_out)

// Manually create a completed time entry
router.post('/time-entries/manual', async (req: Request, res: Response) => {
  const { profile_id, sales_order_id, clock_in, clock_out } = req.body || {};

  const profileId = Number(profile_id);
  const salesOrderId = Number(sales_order_id);

  if (!Number.isFinite(profileId) || profileId <= 0 || !Number.isFinite(salesOrderId) || salesOrderId <= 0 || !clock_in || !clock_out) {
    return res.status(400).json({
      error: 'Missing Required Fields',
      message: 'Profile, sales order, clock in, and clock out are required.'
    });
  }

  try {
    const requestTimeZone = req.headers['x-timezone'] as string | undefined;
    const clockInTime = normalizeToMinute(new Date(clock_in));
    const clockOutTime = normalizeToMinute(new Date(clock_out));

    if (Number.isNaN(clockInTime.getTime()) || Number.isNaN(clockOutTime.getTime())) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Clock in or clock out time is invalid.'
      });
    }

    if (clockOutTime.getTime() <= clockInTime.getTime()) {
      return res.status(400).json({
        error: 'Invalid Time Range',
        message: 'Clock out must be after clock in.'
      });
    }

    const clockInIso = clockInTime.toISOString();
    const clockOutIso = clockOutTime.toISOString();

    const attendanceShiftRes = await pool.query(
      `SELECT id, clock_in, clock_out
       FROM attendance_shifts
       WHERE profile_id = $1
         AND (CASE
                WHEN clock_out IS NULL OR clock_out >= clock_in
                  THEN tstzrange(clock_in, COALESCE(clock_out, 'infinity'::timestamptz), '[)')
              END)
             && tstzrange($2::timestamptz, $3::timestamptz, '[)')
       ORDER BY clock_in ASC`,
      [profileId, clockInIso, clockOutIso]
    );

    if (!isTimeRangeCoveredByAttendanceShifts(clockInTime, clockOutTime, attendanceShiftRes.rows)) {
      const nearestShiftRes = await pool.query(
        `SELECT id, clock_in, clock_out
         FROM attendance_shifts
         WHERE profile_id = $1
         ORDER BY ABS(EXTRACT(EPOCH FROM (clock_in - $2::timestamptz))) ASC
         LIMIT 1`,
        [profileId, clockInIso]
      );

      const attendanceErrorPayload: {
        error: string;
        message: string;
        closest_shift?: unknown;
      } = {
        error: 'Outside Attendance Shift',
        message: 'The user was not clocked into attendance during that time.'
      };

      if (nearestShiftRes.rows.length > 0) {
        attendanceErrorPayload.closest_shift = nearestShiftRes.rows[0];
      }

      return res.status(400).json(attendanceErrorPayload);
    }

    const overlapRes = await pool.query(
      `SELECT id, clock_in, clock_out, sales_order_id
       FROM time_entries
       WHERE profile_id = $1
         AND (CASE
                WHEN clock_out IS NULL OR clock_out >= clock_in
                  THEN tstzrange(clock_in, COALESCE(clock_out, 'infinity'::timestamptz), '[)')
              END)
             && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [profileId, clockInIso, clockOutIso]
    );

    if (overlapRes.rows.length > 0) {
      return res.status(400).json({
        error: 'Overlapping Time Entry',
        message: 'The user was already clocked in during that time.',
        conflicts: overlapRes.rows
      });
    }

    const breakStartRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'");
    const breakEndRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'");
    const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
    const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;

    const effectiveDuration = calculateEffectiveDuration(
      clockInTime,
      clockOutTime,
      dailyBreakStart,
      dailyBreakEnd,
      requestTimeZone,
    );

    const unitPriceRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
    const unitPrice = unitPriceRes.rows.length > 0 ? parseFloat(unitPriceRes.rows[0].value) : 0;

    const insertRes = await pool.query(
      `INSERT INTO time_entries (profile_id, sales_order_id, clock_in, clock_out, duration, unit_price)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6)
       RETURNING id`,
      [profileId, salesOrderId, clockInIso, clockOutIso, effectiveDuration, unitPrice]
    );

    const newEntryId = insertRes.rows[0].id;

    const newEntryRes = await pool.query(
      `SELECT
        te.id, te.profile_id, p.name as profile_name, te.sales_order_id, soh.sales_order_number,
        soh.product_name, te.clock_in, te.clock_out, te.duration, te.unit_price
       FROM time_entries te
       JOIN profiles p ON te.profile_id = p.id
       JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
       WHERE te.id = $1`,
      [newEntryId]
    );

    if (newEntryRes.rows.length === 0) {
      return res.status(500).json({ error: 'Failed to load new time entry' });
    }

    await recalcSalesOrderLabourOverheadAndSupply(salesOrderId);

    return res.status(201).json(newEntryRes.rows[0]);
  } catch (err) {
    console.error('Error creating manual time entry:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.put('/time-entries/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { clock_in, clock_out } = req.body;
  try {
    const requestTimeZone = req.headers['x-timezone'] as string | undefined;
    const existingEntryRes = await pool.query(
      'SELECT profile_id, sales_order_id FROM time_entries WHERE id = $1',
      [id]
    );
    if (existingEntryRes.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }
    const { profile_id: profileId, sales_order_id: existingSalesOrderId } = existingEntryRes.rows[0];

    // Convert empty strings to null
    if (!clock_in || clock_in === '') clock_in = null;
    if (!clock_out || clock_out === '') clock_out = null;

    if (!clock_in) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Clock in time is required.'
      });
    }

    const clockInTime = normalizeToMinute(new Date(clock_in));
    if (Number.isNaN(clockInTime.getTime())) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Clock in time is invalid.'
      });
    }

    let clockOutTime: Date | null = null;
    if (clock_out) {
      clockOutTime = normalizeToMinute(new Date(clock_out));
      if (Number.isNaN(clockOutTime.getTime())) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Clock out time is invalid.'
        });
      }

      if (clockOutTime.getTime() <= clockInTime.getTime()) {
        return res.status(400).json({
          error: 'Invalid Time Range',
          message: 'Clock out must be after clock in.'
        });
      }

      clock_out = clockOutTime.toISOString();
    }

    const clockInIso = clockInTime.toISOString();
    const clockOutIso = clockOutTime ? clockOutTime.toISOString() : null;

    const attendanceQueryEnd = clockOutTime ? clockOutTime : new Date(clockInTime.getTime() + 60 * 1000);
    const attendanceQueryEndIso = attendanceQueryEnd.toISOString();
    const attendanceCoverageEnd = clockOutTime ? clockOutTime : clockInTime;

    const attendanceShiftRes = await pool.query(
      `SELECT id, clock_in, clock_out
       FROM attendance_shifts
       WHERE profile_id = $1
         AND (CASE
                WHEN clock_out IS NULL OR clock_out >= clock_in
                  THEN tstzrange(clock_in, COALESCE(clock_out, 'infinity'::timestamptz), '[)')
              END)
             && tstzrange($2::timestamptz, $3::timestamptz, '[)')
       ORDER BY clock_in ASC`,
      [profileId, clockInIso, attendanceQueryEndIso]
    );

    if (!isTimeRangeCoveredByAttendanceShifts(clockInTime, attendanceCoverageEnd, attendanceShiftRes.rows)) {
      return res.status(400).json({
        error: 'Outside Attendance Shift',
        message: 'The user was not clocked into attendance during that time.'
      });
    }

    const overlapRes = await pool.query(
      `SELECT id, clock_in, clock_out
       FROM time_entries
       WHERE profile_id = $1
         AND id <> $2
         AND (CASE
                WHEN clock_out IS NULL OR clock_out >= clock_in
                  THEN tstzrange(clock_in, COALESCE(clock_out, 'infinity'::timestamptz), '[)')
              END)
             && tstzrange($3::timestamptz, COALESCE($4::timestamptz, 'infinity'::timestamptz), '[)')`,
      [profileId, id, clockInIso, clockOutIso]
    );

    if (overlapRes.rows.length > 0) {
      return res.status(400).json({
        error: 'Overlapping Time Entry',
        message: 'The user was already clocked in during that time.',
        conflicts: overlapRes.rows
      });
    }

    // Get daily break times
    const breakStartRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'");
    const breakEndRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'");
    const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
    const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;

    let effectiveDuration = null;
    if (clockOutTime) {
      effectiveDuration = calculateEffectiveDuration(
        clockInTime,
        clockOutTime,
        dailyBreakStart,
        dailyBreakEnd,
        requestTimeZone,
      );
    }

    const result = await pool.query(
      `UPDATE time_entries
       SET clock_in = $1::timestamptz,
           clock_out = $2::timestamptz,
           duration = $3
       WHERE id = $4
       RETURNING *`,
      [clockInIso, clockOutIso, effectiveDuration, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    const soId = existingSalesOrderId;
    if (soId) {
      await recalcSalesOrderLabourOverheadAndSupply(soId);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error editing time entry:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/time-entries/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const entryRes = await pool.query(
      `SELECT sales_order_id
       FROM time_entries
       WHERE id = $1`,
      [id]
    );

    if (entryRes.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    await pool.query('DELETE FROM time_entries WHERE id = $1', [id]);

    const soId = entryRes.rows[0].sales_order_id;
    if (soId) {
      await recalcSalesOrderLabourOverheadAndSupply(soId);
    }

    return res.status(204).send();
  } catch (err) {
    console.error('Error deleting time entry:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all time tracking entries for the current user's company
router.get('/', async (req: Request, res: Response) => {
  try {
    const company_id = req.user?.company_id;
    const result = await pool.query(
      'SELECT * FROM TimeTrackingEntries WHERE company_id = $1 ORDER BY start_time DESC',
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('timeTrackingRoutes: Error fetching entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new time tracking entry
router.post('/', async (req: Request, res: Response) => {
  const { user_id, start_time, end_time, task_description } = req.body;
  try {
    const company_id = req.user?.company_id;
    const result = await pool.query(
      'INSERT INTO TimeTrackingEntries (user_id, company_id, start_time, end_time, task_description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [user_id, company_id, start_time, end_time, task_description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('timeTrackingRoutes: Error creating entry:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Frontend profiles endpoint - Admin and Time Tracking users see all profiles
router.get('/profiles', async (req: Request, res: Response) => {
  try {
    const userRole = req.user?.access_role;

    let query: string;
    let params: any[] = [];

    // Admin and Time Tracking users can see all profiles
    // Mobile users can only see profiles they have access to
    if (userRole === 'Admin' || userRole === 'Time Tracking') {
      query = `
        SELECT p.id, p.name, p.email, p.phone_number 
        FROM profiles p
        ORDER BY p.name
      `;
      params = [];
    } else {
      const tenantUserId = await resolveTenantUserId(pool, req.user);
      if (!tenantUserId) {
        return res.status(403).json({ error: 'User record not found for this tenant' });
      }

      // Mobile users can only see profiles they have access to
      query = `
        SELECT DISTINCT p.id, p.name, p.email, p.phone_number 
        FROM profiles p
        INNER JOIN user_profile_access upa ON p.id = upa.profile_id
        WHERE upa.user_id = $1 AND upa.is_active = true
        ORDER BY p.name
      `;
      params = [tenantUserId];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching profiles:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mobile profiles endpoint - Mobile users (including admin) only see profiles they have access to
router.get('/mobile/profiles', async (req: Request, res: Response) => {
  try {
    const userId = await resolveTenantUserId(pool, req.user);
    if (!userId) {
      return res.status(403).json({ error: 'User record not found for this tenant' });
    }
    
    // Mobile users (including admin) can only see profiles they have access to
    const query = `
      SELECT DISTINCT p.id, p.name, p.email, p.phone_number 
      FROM profiles p
      INNER JOIN user_profile_access upa ON p.id = upa.profile_id
      WHERE upa.user_id = $1 AND upa.is_active = true
      ORDER BY p.name
    `;
    
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching mobile profiles:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profiles', async (req: Request, res: Response) => {
  const { name, email, phone_number } = req.body;

  try {
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const result = await pool.query(
      'INSERT INTO profiles (name, email, phone_number) VALUES ($1, $2, $3) RETURNING *',
      [name, email, phone_number || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profiles/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, phone_number } = req.body;

  try {
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const result = await pool.query(
      'UPDATE profiles SET name = $1, email = $2, phone_number = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, email, phone_number || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sales-orders', async (req: Request, res: Response) => {
  try {
    const includeClosed = ['true', '1', 'yes'].includes(String(req.query.include_closed || '').toLowerCase());
    // First, let's check what columns exist and what data we have
    const schemaCheck = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'salesorderhistory' AND column_name = 'product_name'"
    );
    console.log('Product name column exists:', schemaCheck.rows.length > 0);
    
    const whereClause = includeClosed ? '' : "WHERE soh.status = 'Open'";
    const result = await pool.query(
      `SELECT 
        soh.sales_order_id as id, 
        soh.sales_order_number as number, 
        soh.product_name,
        soh.unit_number,
        soh.status,
        COALESCE(cm.customer_name, 'Unknown Customer') as customer_name
       FROM salesorderhistory soh
       LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
       ${whereClause}
       ORDER BY soh.sales_order_number`
    );
    console.log('Sales orders API response:', result.rows);
    
    // Let's also check a few sample records to see what's in the database
    const sampleData = await pool.query(
      `SELECT 
        soh.sales_order_id, 
        soh.sales_order_number, 
        soh.product_name, 
        soh.status,
        COALESCE(cm.customer_name, 'Unknown Customer') as customer_name
       FROM salesorderhistory soh
       LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
       LIMIT 5`
    );
    console.log('Sample sales order data:', sampleData.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sales orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sales-orders/:id/tech-story', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const salesOrderId = Number(id);
    if (!Number.isFinite(salesOrderId)) {
      return res.status(400).json({ error: 'Invalid sales order id' });
    }
    const result = await pool.query(
      'SELECT sales_order_id, sales_order_number, tech_story FROM salesorderhistory WHERE sales_order_id = $1',
      [salesOrderId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales order not found' });
    }
    const row = result.rows[0];
    res.json({
      sales_order_id: row.sales_order_id,
      sales_order_number: row.sales_order_number,
      tech_story: row.tech_story || '',
    });
  } catch (err) {
    console.error('Error fetching sales order tech story:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all open (not clocked out) time entries for a profile
router.get('/time-entries/open', async (req: Request, res: Response) => {
  const { profile_id } = req.query;
  if (!profile_id) {
    return res.status(400).json({ error: 'profile_id query parameter is required' });
  }
  try {
    const result = await pool.query(
      `SELECT te.*, soh.sales_order_number, soh.product_name
       FROM time_entries te
       JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
       WHERE te.profile_id = $1 AND te.clock_out IS NULL
       ORDER BY te.clock_in DESC`,
      [profile_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching open time entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add the correct /reports/time-entries endpoint
router.get('/reports/time-entries', async (req: Request, res: Response) => {
  const { from, to, profile, so } = req.query;
  try {
    console.log('Time entry report request:', { from, to, profile, so });
    
    let query = `
      SELECT 
        te.*,
        p.name as profile_name,
        soh.sales_order_number,
        DATE(te.clock_in) as date
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
      WHERE DATE(te.clock_in) BETWEEN $1 AND $2
    `;
    const params = [from, to];

    if (profile && profile !== '') {
      query += ' AND te.profile_id = $' + (params.length + 1);
      params.push(profile);
    }
    if (so && so !== '') {
      query += ' AND te.sales_order_id = $' + (params.length + 1);
      params.push(so);
    }

    query += ' ORDER BY te.clock_in DESC';

    console.log('Executing query:', query);
    console.log('Query parameters:', params);
    
    const result = await pool.query(query, params);
    console.log('Query result count:', result.rows.length);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error generating time entry report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test duration calculation endpoint
router.get('/test-duration', async (req: Request, res: Response) => {
  try {
    const testQuery = `
      SELECT 
        NOW() as current_time,
        (NOW() - INTERVAL '2 hours') as two_hours_ago,
        EXTRACT(EPOCH FROM (NOW() - (NOW() - INTERVAL '2 hours'))) as seconds_diff,
        EXTRACT(EPOCH FROM (NOW() - (NOW() - INTERVAL '2 hours'))) / 3600 as hours_diff,
        ROUND((EXTRACT(EPOCH FROM (NOW() - (NOW() - INTERVAL '2 hours'))) / 3600)::numeric, 2) as rounded_hours
    `;
    const result = await pool.query(testQuery);
    res.json({
      test: result.rows[0],
      message: 'Duration calculation test'
    });
  } catch (err) {
    console.error('Error testing duration calculation:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export time entry report
router.get('/reports/time-entries/export', async (req: Request, res: Response) => {
  console.log('Time tracking report export endpoint hit');
  const { from, to, profile, format } = req.query;
  
  try {
    // 1. Query all time entries for the range/profile
    let query = `
      SELECT 
        te.*, p.name as profile_name, soh.sales_order_number, DATE(te.clock_in) as date
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
      WHERE DATE(te.clock_in) BETWEEN $1 AND $2
    `;
    const params = [from, to];
    if (profile && profile !== '') {
      query += ' AND te.profile_id = $' + (params.length + 1);
      params.push(profile);
    }
    query += ' ORDER BY te.clock_in DESC';
    const result = await pool.query(query, params);
    const timeEntries = result.rows;

    // 2. Compute shift/idle summary and per-shift breakdowns
    // Query all shifts for the range/profile
    let shiftQuery = `SELECT * FROM attendance_shifts WHERE clock_in >= $1 AND clock_in < ($2::date + INTERVAL '1 day')`;
    const shiftParams = [from, to];
    if (profile && profile !== '') {
      shiftQuery += ' AND profile_id = $3';
      shiftParams.push(profile);
    }
    shiftQuery += ' ORDER BY clock_in DESC';
    const shiftResult = await pool.query(shiftQuery, shiftParams);
    const shifts = shiftResult.rows;

    // Group time entries by shift
    const shiftEntryMap: { [shiftId: number]: any[] } = {};
    const unscheduled: any[] = [];
    shifts.forEach(shift => { shiftEntryMap[shift.id] = []; });
    timeEntries.forEach(entry => {
      const entryIn = new Date(entry.clock_in).getTime();
      const entryProfileId = Number(entry.profile_id);
      let found = false;
      for (const shift of shifts) {
        const shiftIn = new Date(shift.clock_in).getTime();
        const shiftOut = shift.clock_out ? new Date(shift.clock_out).getTime() : null;
        const shiftProfileId = Number(shift.profile_id);
        if (
          shiftOut &&
          !Number.isNaN(entryProfileId) &&
          !Number.isNaN(shiftProfileId) &&
          entryProfileId === shiftProfileId &&
          entryIn >= shiftIn &&
          entryIn < shiftOut
        ) {
          shiftEntryMap[shift.id].push(entry);
          found = true;
          break;
        }
      }
      if (!found) unscheduled.push(entry);
    });

    // Compute shift/idle summary by profile
    const profileShiftStats: { [profileId: number]: { hours: number, idle: number } } = {};
    shifts.forEach(shift => {
      if (shift.clock_in && shift.clock_out) {
        const inTime = new Date(shift.clock_in).getTime();
        const outTime = new Date(shift.clock_out).getTime();
        const storedDuration = parseDurationHours(shift.duration);
        const dur = storedDuration !== null && !Number.isNaN(storedDuration)
          ? storedDuration
          : Math.max(0, (outTime - inTime) / (1000 * 60 * 60));
        const entries = (shiftEntryMap[shift.id] || []);
        let booked = 0;
        entries.forEach(e => {
          const parsedDuration = parseDurationHours(e.duration);
          const entryDur = parsedDuration !== null ? parsedDuration : 0;
          booked += entryDur;
        });
        const idle = Math.max(0, dur - booked);
        if (!profileShiftStats[shift.profile_id]) profileShiftStats[shift.profile_id] = { hours: 0, idle: 0 };
        profileShiftStats[shift.profile_id].hours += dur;
        profileShiftStats[shift.profile_id].idle += idle;
      }
    });

    // 3. Build CSV sections
    if (format === 'csv') {
      let csvSections: string[] = [];
      // Section 1: Shift/Idle Summary
      csvSections.push('Shift/Idle Summary by Profile');
      csvSections.push('Profile,Total Shift Hours,Total Idle Hours');
      for (const [profileId, stats] of Object.entries(profileShiftStats)) {
        const profileName = timeEntries.find(e => String(e.profile_id) === String(profileId))?.profile_name || profileId;
        csvSections.push(`${profileName},${stats.hours.toFixed(2)},${stats.idle.toFixed(2)}`);
      }
      csvSections.push('');
      // Section 2: Per-Shift Breakdown
      csvSections.push('Per-Shift Breakdown');
      csvSections.push('Profile,Date,Shift In,Shift Out,Shift Duration (hrs),Sales Order,Booked Hours,Idle (hrs)');
      for (const shift of shifts) {
        const shiftIn = shift.clock_in ? new Date(shift.clock_in) : null;
        const shiftOut = shift.clock_out ? new Date(shift.clock_out) : null;
        const storedDuration = parseDurationHours(shift.duration);
        const shiftDuration = storedDuration !== null && !Number.isNaN(storedDuration)
          ? storedDuration
          : shiftIn && shiftOut
            ? ((shiftOut.getTime() - shiftIn.getTime()) / (1000 * 60 * 60))
            : 0;
        const entries = shiftEntryMap[shift.id] || [];
        // Group by sales order
        const soMap: { [so: string]: number } = {};
        let booked = 0;
        entries.forEach(e => {
          const so = e.sales_order_number || 'Unknown';
          const parsedDuration = parseDurationHours(e.duration);
          const dur = parsedDuration !== null ? parsedDuration : 0;
          soMap[so] = (soMap[so] || 0) + dur;
          booked += dur;
        });
        const idle = Math.max(0, shiftDuration - booked);
        const profileName = entries[0]?.profile_name || shift.profile_id;
        if (Object.keys(soMap).length === 0) {
          csvSections.push(`${profileName},${shiftIn ? shiftIn.toLocaleDateString() : ''},${shiftIn ? shiftIn.toLocaleTimeString() : ''},${shiftOut ? shiftOut.toLocaleTimeString() : ''},${shiftDuration.toFixed(2)},,,${idle.toFixed(3)}`);
        } else {
          for (const [so, hrs] of Object.entries(soMap)) {
            csvSections.push(`${profileName},${shiftIn ? shiftIn.toLocaleDateString() : ''},${shiftIn ? shiftIn.toLocaleTimeString() : ''},${shiftOut ? shiftOut.toLocaleTimeString() : ''},${shiftDuration.toFixed(2)},${so},${Number(hrs).toFixed(3)},${idle.toFixed(3)}`);
          }
        }
      }
      csvSections.push('');
      // Section 3: Unscheduled Entries
      csvSections.push('Unscheduled Entries');
      csvSections.push('Sales Order,Clock In,Clock Out,Duration');
      for (const entry of unscheduled) {
        const durationStr = formatDurationForOutput(entry.duration, 3);
        csvSections.push(`${entry.sales_order_number || ''},${entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : ''},${entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : ''},${durationStr}`);
      }
      csvSections.push('');
      // Section 4: Full Time Entry Table
      csvSections.push('Full Time Entry Table');
      csvSections.push('Profile,Sales Order,Date,Clock In,Clock Out,Duration');
      for (const entry of timeEntries) {
        const durationStr = formatDurationForOutput(entry.duration, 3);
        csvSections.push(`${entry.profile_name || ''},${entry.sales_order_number || ''},${entry.date ? new Date(entry.date).toLocaleDateString() : ''},${entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : ''},${entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : ''},${durationStr}`);
      }
      const csv = csvSections.join('\n');
      const filename = `time_entries_report_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'text/csv');
      res.send(csv);
      return;
    }

    if (format === 'pdf') {
      // Generate PDF
      const doc = new PDFDocument({ margin: 50 });
      const filename = `time_entries_report_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'application/pdf');
      doc.pipe(res);

      // Header
      doc.font('Helvetica-Bold').fontSize(20).text('Time Entries Report', { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica').fontSize(10).text(`Date Range: ${from} to ${to}`, { align: 'center' });
      doc.moveDown(2);

      // Table headers
      const headers = ['Profile', 'Sales Order', 'Date', 'Clock In', 'Clock Out', 'Duration (hrs)'];
      const columnWidths = [100, 120, 80, 80, 80, 80];
      let y = doc.y;

      // Draw header row
      doc.font('Helvetica-Bold').fontSize(9);
      let x = 50;
      headers.forEach((header, index) => {
        doc.text(header, x, y, { width: columnWidths[index] });
        x += columnWidths[index];
      });

      y += 20;
      doc.moveTo(50, y).lineTo(550, y).stroke();

      // Draw data rows
      doc.font('Helvetica').fontSize(8);
      timeEntries.forEach((entry, index) => {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }

        x = 50;
        doc.text(entry.profile_name || '', x, y, { width: columnWidths[0] });
        x += columnWidths[0];
        doc.text(entry.sales_order_number || '', x, y, { width: columnWidths[1] });
        x += columnWidths[1];
        
        const date = entry.date ? new Date(entry.date).toLocaleDateString() : '';
        doc.text(date, x, y, { width: columnWidths[2] });
        x += columnWidths[2];
        
        const clockIn = entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : '';
        doc.text(clockIn, x, y, { width: columnWidths[3] });
        x += columnWidths[3];
        
        const clockOut = entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : '-';
        doc.text(clockOut, x, y, { width: columnWidths[4] });
        x += columnWidths[4];
        
        const parsedDuration = parseDurationHours(entry.duration);
        const duration = parsedDuration !== null ? parsedDuration.toFixed(2) : '-';
        doc.text(duration, x, y, { width: columnWidths[5] });

        y += 15;
        
        // Draw row separator
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 5;
      });

      doc.end();
    } else {
      // Generate CSV
      const csvData = timeEntries.map(entry => ({
        Profile: entry.profile_name || '',
        'Sales Order': entry.sales_order_number || '',
        Date: entry.date ? new Date(entry.date).toLocaleDateString() : '',
        'Clock In': entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : '',
        'Clock Out': entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : '',
        'Duration (hrs)': formatDurationForOutput(entry.duration, 2)
      }));

      const csv = Papa.unparse(csvData);
      const filename = `time_entries_report_${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'text/csv');
      res.send(csv);
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error exporting time entry report:', err);
    res.status(500).json({ error: 'Internal server error during export', details: err.message, stack: err.stack });
  }
});

// Admin endpoints for managing user profile access
// Only Admin users can access these endpoints

// Get all user profile access assignments
router.get('/admin/user-profile-access', async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user?.access_role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await pool.query(`
      SELECT 
        upa.id,
        upa.user_id,
        u.email as user_email,
        u.access_role as user_role,
        upa.profile_id,
        p.name as profile_name,
        p.email as profile_email,
        upa.granted_by,
        admin.email as granted_by_email,
        upa.granted_at,
        upa.is_active,
        upa.created_at,
        upa.updated_at
      FROM user_profile_access upa
      JOIN users u ON upa.user_id = u.id
      JOIN profiles p ON upa.profile_id = p.id
      LEFT JOIN users admin ON upa.granted_by = admin.id
      ORDER BY u.email, p.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user profile access:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Grant profile access to a user
router.post('/admin/user-profile-access', async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user?.access_role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { user_id, profile_id } = req.body;

  if (!user_id || !profile_id) {
    return res.status(400).json({ error: 'User ID and Profile ID are required' });
  }

  try {
    const grantedBy = await resolveTenantUserId(pool, req.user);
    if (!grantedBy) {
      console.warn('[user-profile-access] Granting access with NULL granted_by (admin not found in tenant DB)', {
        sharedId: req.user?.id,
        email: req.user?.email,
      });
    }

    // Check if user exists and is a mobile user
    const userCheck = await pool.query(
      'SELECT id, access_role FROM users WHERE id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userRole = userCheck.rows[0].access_role;
    if (userRole !== 'Mobile Time Tracker') {
      return res.status(400).json({ error: 'Can only grant access to Mobile Time Tracker users' });
    }

    // Check if profile exists
    const profileCheck = await pool.query(
      'SELECT id FROM profiles WHERE id = $1',
      [profile_id]
    );

    if (profileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Insert or update the access record
    const result = await pool.query(`
      INSERT INTO user_profile_access (user_id, profile_id, granted_by, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (user_id, profile_id)
      DO UPDATE SET 
        granted_by = $3,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [user_id, profile_id, grantedBy]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error granting profile access:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Revoke profile access from a user
router.delete('/admin/user-profile-access/:id', async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user?.access_role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE user_profile_access SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Access record not found' });
    }

    res.json({ message: 'Profile access revoked successfully' });
  } catch (err) {
    console.error('Error revoking profile access:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get available users for profile access (only Mobile Time Tracker users)
router.get('/admin/available-users', async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user?.access_role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await pool.query(`
      SELECT id, email, access_role, created_at
      FROM users 
      WHERE access_role = 'Mobile Time Tracker'
      ORDER BY email
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching available users:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a profile (Admin only)
router.delete('/profiles/:id', async (req: Request, res: Response) => {
  if (req.user?.access_role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { id } = req.params;
  console.log('timeTrackingRoutes: Received DELETE request for profile ID:', id);
  
  try {
    // Check if profile exists
    const profileResult = await pool.query('SELECT id, name FROM profiles WHERE id = $1', [id]);
    if (profileResult.rows.length === 0) {
      console.log('timeTrackingRoutes: Profile not found for deletion:', id);
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const profileName = profileResult.rows[0].name;
    
    // Check if profile is in use by any time entries
    const usageResult = await pool.query(
      'SELECT COUNT(*) as count FROM time_entries WHERE profile_id = $1',
      [id]
    );
    
    const entryCount = parseInt(usageResult.rows[0].count);
    if (entryCount > 0) {
      console.log('timeTrackingRoutes: Cannot delete profile in use:', profileName, 'entries:', entryCount);
      return res.status(400).json({ 
        error: 'Cannot delete profile',
        details: `Profile "${profileName}" is currently used by ${entryCount} time entries. Please delete these entries first.`,
        entryCount
      });
    }
    
    // Check if profile is in use by any user access records
    const accessResult = await pool.query(
      'SELECT COUNT(*) as count FROM user_profile_access WHERE profile_id = $1 AND is_active = true',
      [id]
    );
    
    const accessCount = parseInt(accessResult.rows[0].count);
    if (accessCount > 0) {
      console.log('timeTrackingRoutes: Cannot delete profile with active access:', profileName, 'access records:', accessCount);
      return res.status(400).json({ 
        error: 'Cannot delete profile',
        details: `Profile "${profileName}" has ${accessCount} active user access records. Please revoke access first.`,
        accessCount
      });
    }
    
    // Delete the profile
    await pool.query('DELETE FROM profiles WHERE id = $1', [id]);
    
    console.log('timeTrackingRoutes: Successfully deleted profile:', profileName);
    res.json({ message: 'Profile deleted successfully' });
  } catch (err) {
    console.error('timeTrackingRoutes: Error deleting profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
