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

// Add a function to check if a PO number already exists
export async function checkPurchaseOrderNumberExists(poNumber: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM purchasehistory WHERE purchase_number = $1',
    [poNumber]
  );
  return parseInt(result.rows[0].count) > 0;
}

// Add a function to generate a unique PO number with retry logic
export async function generateUniquePurchaseOrderNumber(year: number, maxRetries: number = 5): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { poNumber } = await getNextPurchaseOrderNumberForYear(year);
    
    // Check if this number already exists
    const exists = await checkPurchaseOrderNumberExists(poNumber);
    if (!exists) {
      return poNumber;
    }
    
    console.log(`PO number ${poNumber} already exists, retrying... (attempt ${attempt + 1}/${maxRetries})`);
    
    // If we're on the last attempt, try with a higher number
    if (attempt === maxRetries - 1) {
      // Get the actual max number and increment by 1
      const result = await pool.query(
        `
        SELECT MAX(CAST(SUBSTRING(purchase_number, 8, 5) AS INTEGER)) as max_seq
        FROM purchasehistory WHERE purchase_number LIKE $1
        `,
        [`PO-${year}-%`]
      );
      const actualMaxSeq = result.rows[0].max_seq || 0;
      const emergencySeq = actualMaxSeq + 1;
      const emergencyPoNumber = `PO-${year}-${emergencySeq.toString().padStart(5, '0')}`;
      console.log(`Using emergency PO number: ${emergencyPoNumber}`);
      return emergencyPoNumber;
    }
  }
  
  throw new Error('Failed to generate unique purchase order number after maximum retries');
} 