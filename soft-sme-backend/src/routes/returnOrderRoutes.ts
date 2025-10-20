import express, { Request, Response } from 'express';
import { pool } from '../db';
import { InventoryService } from '../services/InventoryService';
import { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';

const router = express.Router();
const inventoryService = new InventoryService(pool);

type ReturnOrderStatus = 'Requested' | 'Returned';

function normalizeStatus(status?: string | null): ReturnOrderStatus {
  if (!status) return 'Requested';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'returned') return 'Returned';
  return 'Requested';
}

async function generateReturnNumber(client: PoolClient): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const prefix = `RET-${year}-`;
  const existing = await client.query(
    `SELECT return_number FROM return_orders WHERE return_number LIKE $1 ORDER BY return_number`,
    [`${prefix}%`]
  );
  const numbers = existing.rows
    .map((row) => parseInt(String(row.return_number).substring(prefix.length), 10))
    .filter((num) => Number.isFinite(num))
    .sort((a, b) => a - b);
  let next = 1;
  for (const num of numbers) {
    if (num !== next) break;
    next += 1;
  }
  return `${prefix}${next.toString().padStart(5, '0')}`;
}

async function getPurchaseLineItemMap(client: PoolClient, purchaseId: number) {
  const res = await client.query(
    `SELECT pli.line_item_id, pli.part_id, pli.part_number, pli.part_description,
            pli.quantity, pli.unit, pli.unit_cost
     FROM purchaselineitems pli
     WHERE pli.purchase_id = $1`,
    [purchaseId]
  );
  const map = new Map<number, any>();
  for (const row of res.rows) {
    map.set(Number(row.line_item_id), row);
  }
  return map;
}

async function getExistingReturnQuantities(
  client: PoolClient,
  purchaseId: number,
  excludeReturnId?: number
): Promise<Map<number, number>> {
  const res = await client.query(
    `SELECT rol.purchase_line_item_id, COALESCE(SUM(rol.quantity), 0) AS total
     FROM return_order_line_items rol
     JOIN return_orders ro ON ro.return_id = rol.return_id
     WHERE ro.purchase_id = $1
       AND ($2::INT IS NULL OR ro.return_id <> $2)
     GROUP BY rol.purchase_line_item_id`,
    [purchaseId, excludeReturnId ?? null]
  );
  const map = new Map<number, number>();
  for (const row of res.rows) {
    if (row.purchase_line_item_id == null) continue;
    map.set(Number(row.purchase_line_item_id), Number(row.total));
  }
  return map;
}

function validateLineItems(
  lineItems: any[],
  purchaseLineItems: Map<number, any>,
  existingTotals: Map<number, number>
) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error('At least one line item is required for a return order.');
  }

  for (const item of lineItems) {
    const lineId = Number(item.purchase_line_item_id);
    if (!Number.isFinite(lineId)) {
      throw new Error('Each return line item must reference a purchase order line item.');
    }
    const purchaseLine = purchaseLineItems.get(lineId);
    if (!purchaseLine) {
      throw new Error(`Purchase order line item ${lineId} was not found.`);
    }
    const requestedQty = Number(item.quantity);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      throw new Error(`Invalid quantity provided for part ${purchaseLine.part_number}.`);
    }
    const purchaseQty = Number(purchaseLine.quantity);
    const existing = existingTotals.get(lineId) ?? 0;
    if (requestedQty + existing - purchaseQty > 1e-6) {
      throw new Error(
        `Requested return quantity for part ${purchaseLine.part_number} exceeds the purchased quantity.`
      );
    }
  }
}

function mapLineItemPayload(item: any, purchaseLine: any) {
  return {
    purchase_line_item_id: purchaseLine.line_item_id ?? null,
    part_id: purchaseLine.part_id ?? null,
    part_number: purchaseLine.part_number,
    part_description: purchaseLine.part_description,
    quantity: Number(item.quantity),
    unit: purchaseLine.unit,
    unit_cost: purchaseLine.unit_cost,
    reason: item.reason ?? null,
  };
}

async function fetchReturnOrderById(client: PoolClient, id: number) {
  const headerRes = await client.query(
    `SELECT ro.*, ph.purchase_number, ph.status AS purchase_status,
            vm.vendor_name
     FROM return_orders ro
     JOIN purchasehistory ph ON ph.purchase_id = ro.purchase_id
     LEFT JOIN vendormaster vm ON vm.vendor_id = ph.vendor_id
     WHERE ro.return_id = $1`,
    [id]
  );
  if (headerRes.rows.length === 0) {
    return null;
  }
  const lineRes = await client.query(
    `SELECT rol.*, pli.part_number AS purchase_part_number
     FROM return_order_line_items rol
     LEFT JOIN purchaselineitems pli ON pli.line_item_id = rol.purchase_line_item_id
     WHERE rol.return_id = $1
     ORDER BY rol.line_item_id`,
    [id]
  );
  return {
    ...headerRes.rows[0],
    line_items: lineRes.rows,
  };
}

router.get('/', async (req: Request, res: Response) => {
  const { status } = req.query;
  const normalized = normalizeStatus(typeof status === 'string' ? status : undefined);
  const applyStatusFilter = typeof status === 'string' && status.toLowerCase() !== 'all';

  try {
    const result = await pool.query(
      `SELECT ro.return_id, ro.return_number, ro.status, ro.requested_at, ro.returned_at,
              ro.purchase_id, ph.purchase_number, ph.status AS purchase_status,
              COALESCE(vm.vendor_name, 'No Vendor') AS vendor_name,
              COALESCE(SUM(rol.quantity), 0) AS total_quantity
       FROM return_orders ro
       JOIN purchasehistory ph ON ph.purchase_id = ro.purchase_id
       LEFT JOIN vendormaster vm ON vm.vendor_id = ph.vendor_id
       LEFT JOIN return_order_line_items rol ON rol.return_id = ro.return_id
       ${applyStatusFilter ? 'WHERE ro.status = $1' : ''}
       GROUP BY ro.return_id, ph.purchase_number, ph.status, vm.vendor_name
       ORDER BY ro.requested_at DESC`,
      applyStatusFilter ? [normalized] : []
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to list return orders', error);
    res.status(500).json({ error: 'Failed to load return orders' });
  }
});

router.get('/by-purchase/:purchaseId', async (req: Request, res: Response) => {
  const purchaseId = Number(req.params.purchaseId);
  if (!Number.isFinite(purchaseId)) {
    return res.status(400).json({ error: 'Invalid purchase order id' });
  }
  try {
    const result = await pool.query(
      `SELECT ro.return_id, ro.return_number, ro.status, ro.requested_at, ro.returned_at,
              COALESCE(SUM(rol.quantity), 0) AS total_quantity
       FROM return_orders ro
       LEFT JOIN return_order_line_items rol ON rol.return_id = ro.return_id
       WHERE ro.purchase_id = $1
       GROUP BY ro.return_id
       ORDER BY ro.requested_at DESC`,
      [purchaseId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to load return orders for purchase', error);
    res.status(500).json({ error: 'Failed to load return orders for purchase order' });
  }
});

router.get('/purchase/:purchaseId/line-items', async (req: Request, res: Response) => {
  const purchaseId = Number(req.params.purchaseId);
  const excludeReturnId = req.query.excludeReturnId ? Number(req.query.excludeReturnId) : undefined;
  if (!Number.isFinite(purchaseId)) {
    return res.status(400).json({ error: 'Invalid purchase order id' });
  }
  try {
    const client = await pool.connect();
    try {
      const purchaseMap = await getPurchaseLineItemMap(client, purchaseId);
      const totals = await getExistingReturnQuantities(client, purchaseId, excludeReturnId);
      const items = Array.from(purchaseMap.values()).map((line) => {
        const lineId = Number(line.line_item_id);
        const alreadyRequested = totals.get(lineId) ?? 0;
        const purchasedQty = Number(line.quantity) || 0;
        const returnable = Math.max(purchasedQty - alreadyRequested, 0);
        return {
          line_item_id: lineId,
          part_number: line.part_number,
          part_description: line.part_description,
          quantity: Number(line.quantity),
          unit: line.unit,
          unit_cost: Number(line.unit_cost),
          part_id: line.part_id,
          already_requested: alreadyRequested,
          returnable_quantity: returnable,
        };
      });
      res.json({ items });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to load purchase line item context', error);
    res.status(500).json({ error: 'Failed to load purchase order items for returns' });
  }
});

router.get('/:id/pdf', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid return order id' });
  }

  const client = await pool.connect();
  try {
    const returnOrder = await fetchReturnOrderById(client, id);
    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    const purchaseRes = await client.query(
      `SELECT ph.purchase_number, ph.purchase_id, vm.vendor_name, vm.street_address, vm.city,
              vm.province, vm.country, vm.postal_code
       FROM purchasehistory ph
       LEFT JOIN vendormaster vm ON vm.vendor_id = ph.vendor_id
       WHERE ph.purchase_id = $1`,
      [returnOrder.purchase_id]
    );
    const purchaseInfo = purchaseRes.rows[0];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${returnOrder.return_number}.pdf"`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text('Return Order', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Return Number: ${returnOrder.return_number}`);
    doc.text(`Status: ${returnOrder.status}`);
    doc.text(`Requested At: ${returnOrder.requested_at ? new Date(returnOrder.requested_at).toLocaleString() : 'N/A'}`);
    if (returnOrder.returned_at) {
      doc.text(`Returned At: ${new Date(returnOrder.returned_at).toLocaleString()}`);
    }
    doc.moveDown();
    if (purchaseInfo) {
      doc.text(`Purchase Order: ${purchaseInfo.purchase_number} (ID ${purchaseInfo.purchase_id})`);
      if (purchaseInfo.vendor_name) {
        doc.text(`Vendor: ${purchaseInfo.vendor_name}`);
      }
      const addressParts = [purchaseInfo.street_address, purchaseInfo.city, purchaseInfo.province, purchaseInfo.country, purchaseInfo.postal_code]
        .filter(Boolean)
        .join(', ');
      if (addressParts) {
        doc.text(`Vendor Address: ${addressParts}`);
      }
    }
    if (returnOrder.notes) {
      doc.moveDown();
      doc.text(`Notes: ${returnOrder.notes}`);
    }

    doc.moveDown();
    doc.text('Line Items:', { underline: true });
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('Part Number', { continued: true, width: 150 });
    doc.text('Description', { continued: true, width: 200 });
    doc.text('Quantity', { continued: true, width: 80 });
    doc.text('Unit Cost', { continued: true, width: 80 });
    doc.text('Reason');
    doc.font('Helvetica');

    for (const line of returnOrder.line_items) {
      doc.text(String(line.part_number || ''), { continued: true, width: 150 });
      doc.text(String(line.part_description || ''), { continued: true, width: 200 });
      doc.text(Number(line.quantity).toFixed(2), { continued: true, width: 80 });
      const unitCost = line.unit_cost != null ? Number(line.unit_cost).toFixed(2) : '';
      doc.text(unitCost, { continued: true, width: 80 });
      doc.text(line.reason || '');
    }

    doc.end();
  } catch (error) {
    console.error('Failed to generate return order PDF', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  } finally {
    client.release();
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid return order id' });
  }

  const client = await pool.connect();
  try {
    const data = await fetchReturnOrderById(client, id);
    if (!data) {
      return res.status(404).json({ error: 'Return order not found' });
    }
    const purchaseItems = await getPurchaseLineItemMap(client, data.purchase_id);
    const totals = await getExistingReturnQuantities(client, data.purchase_id, id);
    const availableItems = Array.from(purchaseItems.values()).map((line) => {
      const lineId = Number(line.line_item_id);
      const alreadyRequested = totals.get(lineId) ?? 0;
      const purchasedQty = Number(line.quantity) || 0;
      const returnable = Math.max(purchasedQty - alreadyRequested, 0);
      return {
        line_item_id: lineId,
        part_number: line.part_number,
        part_description: line.part_description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_cost: Number(line.unit_cost),
        part_id: line.part_id,
        already_requested: alreadyRequested,
        returnable_quantity: returnable,
      };
    });
    res.json({ ...data, available_items: availableItems });
  } catch (error) {
    console.error('Failed to load return order detail', error);
    res.status(500).json({ error: 'Failed to load return order' });
  } finally {
    client.release();
  }
});

router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const purchaseId = Number(req.body.purchase_id);
    if (!Number.isFinite(purchaseId)) {
      throw new Error('A valid purchase order is required.');
    }
    const status = normalizeStatus(req.body.status);
    const lineItems = Array.isArray(req.body.line_items) ? req.body.line_items : [];

    const purchaseRes = await client.query(
      'SELECT purchase_id FROM purchasehistory WHERE purchase_id = $1',
      [purchaseId]
    );
    if (purchaseRes.rows.length === 0) {
      throw new Error('Purchase order not found.');
    }

    const purchaseLineItems = await getPurchaseLineItemMap(client, purchaseId);
    const existingTotals = await getExistingReturnQuantities(client, purchaseId);
    validateLineItems(lineItems, purchaseLineItems, existingTotals);

    const returnNumber = await generateReturnNumber(client);
    const now = new Date();
    const returnedAt = status === 'Returned' ? now : null;

    const headerResult = await client.query(
      `INSERT INTO return_orders (return_number, purchase_id, status, requested_by, requested_at, returned_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING return_id`,
      [
        returnNumber,
        purchaseId,
        status,
        req.body.requested_by || null,
        req.body.requested_at ? new Date(req.body.requested_at) : now,
        returnedAt,
        req.body.notes || null,
      ]
    );
    const returnId = Number(headerResult.rows[0].return_id);

    for (const item of lineItems) {
      const lineId = Number(item.purchase_line_item_id);
      const purchaseLine = purchaseLineItems.get(lineId);
      if (!purchaseLine) continue;
      const payload = mapLineItemPayload(item, purchaseLine);
      await client.query(
        `INSERT INTO return_order_line_items
           (return_id, purchase_line_item_id, part_id, part_number, part_description, quantity, unit, unit_cost, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          returnId,
          payload.purchase_line_item_id,
          payload.part_id,
          payload.part_number,
          payload.part_description,
          payload.quantity,
          payload.unit,
          payload.unit_cost,
          payload.reason,
        ]
      );
    }

    if (status === 'Returned') {
      for (const item of lineItems) {
        const lineId = Number(item.purchase_line_item_id);
        const purchaseLine = purchaseLineItems.get(lineId);
        if (!purchaseLine) continue;
        const partId = purchaseLine.part_id;
        const quantity = Number(item.quantity);
        if (partId) {
          await inventoryService.adjustInventoryByPartId(
            Number(partId),
            -quantity,
            `Return Order ${returnNumber}`,
            undefined,
            req.user?.id ? Number((req.user as any).id) : undefined,
            client
          );
        } else {
          await inventoryService.adjustInventory(
            purchaseLine.part_number,
            -quantity,
            `Return Order ${returnNumber}`,
            undefined,
            req.user?.id ? Number((req.user as any).id) : undefined,
            client
          );
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ return_id: returnId, return_number: returnNumber });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Failed to create return order', error);
    const message = error instanceof Error ? error.message : 'Failed to create return order';
    res.status(400).json({ error: message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid return order id' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await fetchReturnOrderById(client, id);
    if (!existing) {
      throw new Error('Return order not found.');
    }
    if (existing.status === 'Returned') {
      throw new Error('Returned orders cannot be modified.');
    }

    const purchaseId = Number(existing.purchase_id);
    const status = normalizeStatus(req.body.status);
    const lineItems = Array.isArray(req.body.line_items) ? req.body.line_items : [];

    const purchaseLineItems = await getPurchaseLineItemMap(client, purchaseId);
    const existingTotals = await getExistingReturnQuantities(client, purchaseId, id);
    validateLineItems(lineItems, purchaseLineItems, existingTotals);

    const returnedAt = status === 'Returned' ? new Date() : null;

    await client.query(
      `UPDATE return_orders
       SET status = $1,
           requested_by = $2,
           requested_at = COALESCE($3::timestamptz, requested_at),
           returned_at = COALESCE($4::timestamptz, returned_at),
           notes = $5
       WHERE return_id = $6`,
      [
        status,
        req.body.requested_by || existing.requested_by || null,
        req.body.requested_at ? new Date(req.body.requested_at) : existing.requested_at,
        returnedAt,
        req.body.notes ?? existing.notes ?? null,
        id,
      ]
    );

    await client.query('DELETE FROM return_order_line_items WHERE return_id = $1', [id]);

    for (const item of lineItems) {
      const lineId = Number(item.purchase_line_item_id);
      const purchaseLine = purchaseLineItems.get(lineId);
      if (!purchaseLine) continue;
      const payload = mapLineItemPayload(item, purchaseLine);
      await client.query(
        `INSERT INTO return_order_line_items
           (return_id, purchase_line_item_id, part_id, part_number, part_description, quantity, unit, unit_cost, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          payload.purchase_line_item_id,
          payload.part_id,
          payload.part_number,
          payload.part_description,
          payload.quantity,
          payload.unit,
          payload.unit_cost,
          payload.reason,
        ]
      );
    }

    if (status === 'Returned') {
      for (const item of lineItems) {
        const lineId = Number(item.purchase_line_item_id);
        const purchaseLine = purchaseLineItems.get(lineId);
        if (!purchaseLine) continue;
        const partId = purchaseLine.part_id;
        const quantity = Number(item.quantity);
        if (partId) {
          await inventoryService.adjustInventoryByPartId(
            Number(partId),
            -quantity,
            `Return Order ${existing.return_number}`,
            undefined,
            req.user?.id ? Number((req.user as any).id) : undefined,
            client
          );
        } else {
          await inventoryService.adjustInventory(
            purchaseLine.part_number,
            -quantity,
            `Return Order ${existing.return_number}`,
            undefined,
            req.user?.id ? Number((req.user as any).id) : undefined,
            client
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Failed to update return order', error);
    const message = error instanceof Error ? error.message : 'Failed to update return order';
    res.status(400).json({ error: message });
  } finally {
    client.release();
  }
});

export default router;
