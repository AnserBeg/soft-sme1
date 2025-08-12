import { pool } from '../db';

export async function getNextSequenceNumberForYear(year: number): Promise<{ sequenceNumber: string, nnnnn: number }> {
  const yearPrefix = `${year}`;
  // Get max from both tables
  const result = await pool.query(
    `
    SELECT MAX(seq) as max_seq FROM (
      SELECT CAST(SUBSTRING(CAST(sequence_number AS TEXT), 5, 5) AS INTEGER) as seq
      FROM quotes WHERE sequence_number IS NOT NULL AND CAST(sequence_number AS TEXT) LIKE $1
      UNION ALL
      SELECT CAST(SUBSTRING(CAST(sequence_number AS TEXT), 5, 5) AS INTEGER) as seq
      FROM salesorderhistory WHERE sequence_number IS NOT NULL AND CAST(sequence_number AS TEXT) LIKE $1
    ) AS all_seqs
    `,
    [`${yearPrefix}%`]
  );
  const maxSeq = result.rows[0].max_seq || 0;
  const nextSeq = maxSeq + 1;
  const sequenceNumber = `${yearPrefix}${nextSeq.toString().padStart(5, '0')}`;
  return { sequenceNumber, nnnnn: nextSeq };
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