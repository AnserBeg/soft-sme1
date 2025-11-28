import { pool } from '../db';

type SequenceSource = 'quotes' | 'salesorderhistory' | 'invoices';

async function getNextSequenceNumberForTable(
  table: SequenceSource,
  year: number
): Promise<{ sequenceNumber: string; nnnnn: number }> {
  const yearPrefix = `${year}`;
  const likeValue = `${yearPrefix}%`;

  const query = table === 'quotes'
    ? `SELECT MAX(CAST(SUBSTRING(CAST(sequence_number AS TEXT), 5, 5) AS INTEGER)) AS max_seq
       FROM quotes
       WHERE sequence_number IS NOT NULL
         AND CAST(sequence_number AS TEXT) LIKE $1`
    : table === 'salesorderhistory'
      ? `SELECT MAX(CAST(SUBSTRING(CAST(sequence_number AS TEXT), 5, 5) AS INTEGER)) AS max_seq
         FROM salesorderhistory
         WHERE sequence_number IS NOT NULL
           AND CAST(sequence_number AS TEXT) LIKE $1`
      : `SELECT MAX(CAST(SUBSTRING(CAST(sequence_number AS TEXT), 5, 5) AS INTEGER)) AS max_seq
         FROM invoices
         WHERE sequence_number IS NOT NULL
           AND CAST(sequence_number AS TEXT) LIKE $1`;

  const result = await pool.query(query, [likeValue]);
  const maxSeq = result.rows[0]?.max_seq || 0;
  const nextSeq = maxSeq + 1;
  const sequenceNumber = `${yearPrefix}${nextSeq.toString().padStart(5, '0')}`;
  return { sequenceNumber, nnnnn: nextSeq };
}

export function getNextQuoteSequenceNumberForYear(year: number) {
  return getNextSequenceNumberForTable('quotes', year);
}

export function getNextSalesOrderSequenceNumberForYear(year: number) {
  return getNextSequenceNumberForTable('salesorderhistory', year);
}

export function getNextInvoiceSequenceNumberForYear(year: number) {
  return getNextSequenceNumberForTable('invoices', year);
}

export async function getNextPurchaseOrderNumberForYear(year: number): Promise<{ poNumber: string, nnnnn: number }> {
  const yearPrefix = `PO-${year}-`;

  // Get all existing PO numbers for this year
  const existingPOsResult = await pool.query(
    `SELECT purchase_number 
    FROM purchasehistory 
    WHERE purchase_number LIKE $1 
    ORDER BY purchase_number`,
    [`${yearPrefix}%`]
  );

  const existingNumbers = existingPOsResult.rows.map(row => parseInt(row.purchase_number.substring(yearPrefix.length))).sort((a, b) => a - b);

  let nextNumber = 1;
  for (const num of existingNumbers) {
    if (num !== nextNumber) {
      break; // Found a gap
    }
    nextNumber++;
  }

  const poNumber = `${yearPrefix}${nextNumber.toString().padStart(5, '0')}`;

  console.log(`Generated PO number: ${poNumber} (next_number: ${nextNumber}, existing_count: ${existingNumbers.length})`);

  return { poNumber, nnnnn: nextNumber };
} 
