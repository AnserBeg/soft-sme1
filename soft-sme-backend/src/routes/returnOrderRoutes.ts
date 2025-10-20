import express, { Request, Response } from 'express';
import { pool } from '../db';
import { InventoryService } from '../services/InventoryService';
import { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { getLogoImageSource } from '../utils/pdfLogoHelper';

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
      `SELECT ph.purchase_number,
              ph.purchase_id,
              ph.status AS purchase_status,
              vm.vendor_name,
              vm.street_address,
              vm.city,
              vm.province,
              vm.country,
              vm.postal_code,
              vm.telephone_number,
              vm.email
       FROM purchasehistory ph
       LEFT JOIN vendormaster vm ON vm.vendor_id = ph.vendor_id
       WHERE ph.purchase_id = $1`,
      [returnOrder.purchase_id]
    );
    const purchaseInfo = purchaseRes.rows[0] || {};

    const businessProfileResult = await client.query(
      'SELECT * FROM business_profile ORDER BY id DESC LIMIT 1'
    );
    const businessProfile = businessProfileResult.rows[0];

    const filename = encodeURIComponent(`${returnOrder.return_number}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    const logoSource = await getLogoImageSource(businessProfile?.logo_url);
    const headerY = 50;
    const logoHeight = 80;
    const logoWidth = 160;
    const pageWidth = 600;
    const logoX = 50;
    const companyTitleX = logoX + logoWidth + 20;
    const companyTitleY = headerY + (logoHeight - 16) / 2;

    if (logoSource) {
      try {
        doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
      } catch (error) {
        console.error('Failed to render logo in return order PDF:', error);
      }
    }

    if (businessProfile?.business_name) {
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#000000')
        .text((businessProfile.business_name || '').toUpperCase(), companyTitleX, companyTitleY, {
          align: 'left',
          width: pageWidth - companyTitleX - 50,
        });
    }

    let y = headerY + logoHeight + 4;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Vendor', 320, y);
    y += 16;

    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const companyAddress = [
      businessProfile?.street_address,
      businessProfile?.city,
      businessProfile?.province,
      businessProfile?.country,
      businessProfile?.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
    if (businessProfile) {
      doc.text(businessProfile.business_name || '', 50, y);
      doc.text(businessProfile.street_address || '', 50, y + 14);
      doc.text(companyAddress, 50, y + 28);
      doc.text(businessProfile.email || '', 50, y + 42);
      doc.text(businessProfile.telephone_number || '', 50, y + 56);
    }

    doc.text(purchaseInfo.vendor_name || '', 320, y);
    doc.text(purchaseInfo.street_address || '', 320, y + 14);
    const vendorAddress = [
      purchaseInfo.city,
      purchaseInfo.province,
      purchaseInfo.country,
      purchaseInfo.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
    doc.text(vendorAddress, 320, y + 28);
    doc.text(purchaseInfo.email || '', 320, y + 42);
    doc.text(purchaseInfo.telephone_number || '', 320, y + 56);

    y += 72;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('RETURN ORDER', 50, y);
    y += 22;

    const formatDateTime = (value?: string | null) =>
      value ? new Date(value).toLocaleString() : '—';

    const infoRows: Array<[string, string]> = [
      ['Return Order #:', returnOrder.return_number || '—'],
      ['Status:', returnOrder.status || '—'],
      ['Purchase Order #:', purchaseInfo.purchase_number || '—'],
      ['Purchase Status:', purchaseInfo.purchase_status || '—'],
      ['Requested By:', returnOrder.requested_by || '—'],
      ['Requested On:', formatDateTime(returnOrder.requested_at as string)],
      ['Returned On:', formatDateTime(returnOrder.returned_at as string | null)],
      ['Total Quantity:', `${Number(returnOrder.total_quantity || 0)}`],
    ];

    const leftColumnX = 50;
    const rightColumnX = 320;
    const rowHeight = 16;
    infoRows.forEach((row, index) => {
      const targetX = index < 4 ? leftColumnX : rightColumnX;
      const yOffset = index < 4 ? index * rowHeight : (index - 4) * rowHeight;
      doc.font('Helvetica-Bold').fontSize(11).text(row[0], targetX, y + yOffset);
      doc.font('Helvetica').fontSize(11).text(row[1], targetX + 130, y + yOffset);
    });

    y += rowHeight * 4 + 12;

    const totalValue = returnOrder.line_items.reduce((sum, line) => {
      const qty = Number(line.quantity) || 0;
      const unitCost = Number(line.unit_cost) || 0;
      return sum + qty * unitCost;
    }, 0);

    doc.font('Helvetica-Bold').fontSize(11).text('Estimated Return Value:', leftColumnX, y);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(totalValue ? `$${totalValue.toFixed(2)}` : '—', leftColumnX + 160, y);

    y += 24;

    if (returnOrder.notes) {
      doc.font('Helvetica-Bold').fontSize(11).text('Notes:', 50, y);
      const notesResult = doc
        .font('Helvetica')
        .fontSize(11)
        .text(returnOrder.notes, 50, y + 14, { width: 480 });
      y = notesResult.y + 16;
    }

    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 14;

    doc.font('Helvetica-Bold').fontSize(11).text('Line Items', 50, y);
    y += 18;

    const tableHeaders = [
      'SN',
      'Part Number',
      'Description',
      'Qty',
      'Unit',
      'Unit Cost',
      'Reason',
      'Line Value',
    ];
    const columnWidths = [30, 90, 140, 40, 40, 70, 120, 70];
    let currentX = 50;

    doc.font('Helvetica-Bold').fontSize(10);
    tableHeaders.forEach((header, index) => {
      doc.text(header, currentX, y, { width: columnWidths[index], align: 'left' });
      currentX += columnWidths[index];
    });

    y += 16;
    doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#888888').stroke();

    doc.font('Helvetica').fontSize(10);
    let sn = 1;
    returnOrder.line_items.forEach((line) => {
      currentX = 50;
      let rowY = y;

      const quantities = [
        doc.heightOfString(sn.toString(), { width: columnWidths[0] }),
        doc.heightOfString(String(line.part_number || ''), { width: columnWidths[1] }),
        doc.heightOfString(String(line.part_description || ''), { width: columnWidths[2] }),
        doc.heightOfString(Number(line.quantity || 0).toString(), { width: columnWidths[3] }),
        doc.heightOfString(String(line.unit || ''), { width: columnWidths[4] }),
        doc.heightOfString(
          line.unit_cost != null ? Number(line.unit_cost).toFixed(2) : '',
          { width: columnWidths[5] }
        ),
        doc.heightOfString(line.reason || '', { width: columnWidths[6] }),
        doc.heightOfString(
          line.unit_cost != null
            ? (Number(line.quantity || 0) * Number(line.unit_cost || 0)).toFixed(2)
            : '',
          { width: columnWidths[7] }
        ),
      ];
      const rowHeight = Math.max(...quantities, 12);

      doc.text(sn.toString(), currentX, rowY, { width: columnWidths[0], align: 'left' });
      currentX += columnWidths[0];

      doc.text(String(line.part_number || ''), currentX, rowY, { width: columnWidths[1], align: 'left' });
      currentX += columnWidths[1];

      doc.text(String(line.part_description || ''), currentX, rowY, {
        width: columnWidths[2],
        align: 'left',
      });
      currentX += columnWidths[2];

      doc.text(Number(line.quantity || 0).toString(), currentX, rowY, {
        width: columnWidths[3],
        align: 'left',
      });
      currentX += columnWidths[3];

      doc.text(String(line.unit || ''), currentX, rowY, { width: columnWidths[4], align: 'left' });
      currentX += columnWidths[4];

      doc.text(
        line.unit_cost != null ? Number(line.unit_cost).toFixed(2) : '',
        currentX,
        rowY,
        { width: columnWidths[5], align: 'right' }
      );
      currentX += columnWidths[5];

      doc.text(line.reason || '', currentX, rowY, { width: columnWidths[6], align: 'left' });
      currentX += columnWidths[6];

      doc.text(
        line.unit_cost != null
          ? (Number(line.quantity || 0) * Number(line.unit_cost || 0)).toFixed(2)
          : '',
        currentX,
        rowY,
        { width: columnWidths[7], align: 'right' }
      );

      y += rowHeight + 4;
      doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#eeeeee').stroke();

      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
        currentX = 50;
        doc.font('Helvetica-Bold').fontSize(10);
        tableHeaders.forEach((header, index) => {
          doc.text(header, currentX, y, { width: columnWidths[index], align: 'left' });
          currentX += columnWidths[index];
        });
        y += 16;
        doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#888888').stroke();
        doc.font('Helvetica').fontSize(10);
      }

      sn += 1;
    });

    const totalValueText = totalValue ? `$${totalValue.toFixed(2)}` : '—';
    if (returnOrder.line_items.length > 0) {
      y += 20;
      doc.font('Helvetica-Bold').fontSize(11).text('Total Estimated Return Value:', 340, y, {
        align: 'left',
      });
      doc.font('Helvetica-Bold').fontSize(11).text(totalValueText, 500, y, {
        align: 'right',
        width: 50,
      });
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
