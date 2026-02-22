import { pool, runWithTenantContext } from '../src/db';
import { SalesOrderService } from '../src/services/SalesOrderService';

type Args = {
  from?: string;
  to?: string;
  tenant?: string;
  dryRun: boolean;
};

const DEFAULT_TIMEZONE = process.env.TIME_TRACKING_TIMEZONE || process.env.TZ || 'America/Edmonton';
const FORCE_TIMEZONE = process.env.FORCE_TIME_TRACKING_TIMEZONE !== 'false';

function normalizeTimeZone(timeZone?: string | null): string {
  if (FORCE_TIMEZONE) {
    return DEFAULT_TIMEZONE;
  }
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

function normalizeToMinute(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setSeconds(0, 0);
  return normalized;
}

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
    return Number.isNaN(numeric) ? null : numeric;
  }
  return null;
}

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
          durationMs -= overlapEnd - overlapStart;
        }
      }
    } else {
      const overlapStart = Math.max(clockIn.getTime(), breakStartTime.getTime());
      const overlapEnd = Math.min(clockOut.getTime(), breakEndTime.getTime());
      if (overlapEnd > overlapStart) {
        durationMs -= overlapEnd - overlapStart;
      }
    }
  }

  const durationHours = Math.max(0, durationMs / (1000 * 60 * 60));
  return Math.round(durationHours * 100) / 100;
}

async function getDailyBreakTimes() {
  const [breakStartRes, breakEndRes] = await Promise.all([
    pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'"),
    pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'"),
  ]);
  const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
  const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;
  return { dailyBreakStart, dailyBreakEnd };
}

async function recalcSalesOrderLabourOverheadAndSupply(soId: number, salesOrderService: SalesOrderService) {
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

  const supplyRateRes = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['supply_rate']);
  const supplyRate = supplyRateRes.rows.length > 0 ? parseFloat(supplyRateRes.rows[0].value) : 0;
  const existingSupplyResult = await pool.query(
    'SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
    [soId, 'SUPPLY']
  );

  if (supplyRate > 0 && labourTotal > 0) {
    const supplyAmount = labourTotal * (supplyRate / 100);
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
    console.warn(`Failed to recalculate totals for sales order ${soId}:`, error);
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    const [key, value] = raw.split('=');
    if (!value) {
      continue;
    }
    switch (key) {
      case '--from':
        args.from = value;
        break;
      case '--to':
        args.to = value;
        break;
      case '--tenant':
        args.tenant = value;
        break;
      default:
        break;
    }
  }
  return args;
}

function buildDateFilter(field: string, from?: string, to?: string) {
  const clauses: string[] = [];
  const params: string[] = [];
  if (from) {
    params.push(from);
    clauses.push(`DATE(${field}) >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`DATE(${field}) <= $${params.length}`);
  }
  const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  return { where, params };
}

async function runRecalc(args: Args) {
  const { dailyBreakStart, dailyBreakEnd } = await getDailyBreakTimes();
  if (!dailyBreakStart || !dailyBreakEnd) {
    console.error('Daily break start/end are not set. Aborting backfill.');
    return;
  }

  const { where: entryDateWhere, params: entryParams } = buildDateFilter('clock_in', args.from, args.to);
  const entriesRes = await pool.query(
    `SELECT id, clock_in, clock_out, duration, sales_order_id
     FROM time_entries
     WHERE clock_out IS NOT NULL${entryDateWhere}
     ORDER BY id`,
    entryParams
  );

  const salesOrderIds = new Set<number>();
  let entryChecked = 0;
  let entryUpdated = 0;
  let entryChanged = 0;

  for (const row of entriesRes.rows) {
    entryChecked += 1;
    const clockIn = normalizeToMinute(new Date(row.clock_in));
    const clockOut = normalizeToMinute(new Date(row.clock_out));
    const nextDuration = calculateEffectiveDuration(
      clockIn,
      clockOut,
      dailyBreakStart,
      dailyBreakEnd,
      undefined,
    );
    const currentDuration = parseDurationHours(row.duration);
    const delta = currentDuration === null ? Infinity : Math.abs(currentDuration - nextDuration);
    if (delta > 0.0001) {
      entryChanged += 1;
      if (!args.dryRun) {
        await pool.query('UPDATE time_entries SET duration = $1 WHERE id = $2', [nextDuration, row.id]);
        entryUpdated += 1;
      }
    }
    if (row.sales_order_id) {
      salesOrderIds.add(Number(row.sales_order_id));
    }
  }

  const { where: shiftDateWhere, params: shiftParams } = buildDateFilter('clock_in', args.from, args.to);
  const shiftsRes = await pool.query(
    `SELECT id, clock_in, clock_out, duration
     FROM attendance_shifts
     WHERE clock_out IS NOT NULL${shiftDateWhere}
     ORDER BY id`,
    shiftParams
  );

  let shiftChecked = 0;
  let shiftUpdated = 0;
  let shiftChanged = 0;

  for (const row of shiftsRes.rows) {
    shiftChecked += 1;
    const clockIn = normalizeToMinute(new Date(row.clock_in));
    const clockOut = normalizeToMinute(new Date(row.clock_out));
    const nextDuration = calculateEffectiveDuration(
      clockIn,
      clockOut,
      dailyBreakStart,
      dailyBreakEnd,
      undefined,
    );
    const currentDuration = parseDurationHours(row.duration);
    const delta = currentDuration === null ? Infinity : Math.abs(currentDuration - nextDuration);
    if (delta > 0.0001) {
      shiftChanged += 1;
      if (!args.dryRun) {
        await pool.query(
          'UPDATE attendance_shifts SET duration = $1, updated_at = NOW() WHERE id = $2',
          [nextDuration, row.id]
        );
        shiftUpdated += 1;
      }
    }
  }

  if (!args.dryRun && salesOrderIds.size > 0) {
    const salesOrderService = new SalesOrderService(pool);
    for (const soId of salesOrderIds) {
      await recalcSalesOrderLabourOverheadAndSupply(soId, salesOrderService);
    }
  }

  console.log('Backfill complete.');
  console.log(`Time entries checked: ${entryChecked}`);
  console.log(`Time entries changed: ${entryChanged}`);
  console.log(`Time entries updated: ${entryUpdated}`);
  console.log(`Shifts checked: ${shiftChecked}`);
  console.log(`Shifts changed: ${shiftChanged}`);
  console.log(`Shifts updated: ${shiftUpdated}`);
  if (args.dryRun) {
    console.log('Dry run: no updates were written.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runner = async () => {
    await runRecalc(args);
  };

  if (args.tenant) {
    await runWithTenantContext(args.tenant, runner);
  } else {
    await runner();
  }

  await pool.end();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
  pool.end().catch(() => undefined);
});
