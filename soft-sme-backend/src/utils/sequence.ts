import { pool } from '../db';

export async function getNextSequenceNumberForYear(year: number): Promise<{ sequenceNumber: string, nnnnn: number }> {
  const yearPrefix = `${year}`;
  // Get max from both tables
  const result = await pool.query(
    `
    SELECT MAX(seq) as max_seq FROM (
      SELECT CAST(SUBSTRING(sequence_number, 5, 5) AS INTEGER) as seq
      FROM quotes WHERE sequence_number LIKE $1
      UNION ALL
      SELECT CAST(SUBSTRING(sequence_number, 5, 5) AS INTEGER) as seq
      FROM salesorderhistory WHERE sequence_number LIKE $1
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
  const yearPrefix = `${year}`;
  
  // Get the maximum sequence number for the current year
  const result = await pool.query(
    `
    SELECT MAX(seq) as max_seq FROM (
      SELECT CAST(SUBSTRING(purchase_number, 8, 5) AS INTEGER) as seq
      FROM purchasehistory WHERE purchase_number LIKE $1
    ) AS all_seqs
    `,
    [`PO-${yearPrefix}-%`]
  );
  
  const maxSeq = result.rows[0].max_seq || 0;
  const nextSeq = maxSeq + 1;
  const poNumber = `PO-${yearPrefix}-${nextSeq.toString().padStart(5, '0')}`;
  
  console.log(`Generated PO number: ${poNumber} (max_seq: ${maxSeq}, next_seq: ${nextSeq})`);
  
  return { poNumber, nnnnn: nextSeq };
} 