import express, { Request, Response } from 'express';
import { pool } from '../db';
import { resolveTenantCompanyIdFromRequest } from '../utils/companyContext';
import PDFDocument from 'pdfkit';
import { getNextPurchaseOrderNumberForYear } from '../utils/sequence';
import { qboHttp } from '../utils/qboHttp'; // Added for QBO API integration
import { ensureFreshQboAccess } from '../utils/qboTokens';
import { getQboApiBaseUrl } from '../utils/qboBaseUrl';
import { resolveTaxableQboTaxCodeId } from '../utils/qboTaxCodes';
import { getLogoImageSource } from '../utils/pdfLogoHelper';
import { PurchaseOrderCalculationService } from '../services/PurchaseOrderCalculationService';
import { PurchaseOrderService } from '../services/PurchaseOrderService';
import { InventoryService } from '../services/InventoryService';
import { ACCESS_ROLES, requireAccessRoles } from '../middleware/roleAccessMiddleware';

// Format unit costs with up to 4 decimals; keep at least 2 decimals.
const formatUnitCost = (value: any): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0.00';
  }
  const rounded = Number(num.toFixed(4));
  let text = rounded.toFixed(4).replace(/0+$/, '');
  if (text.endsWith('.')) {
    text = text.slice(0, -1);
  }
  if (!text.includes('.')) {
    return `${text}.00`;
  }
  const [whole, decimals] = text.split('.');
  if ((decimals || '').length < 2) {
    return `${whole}.${(decimals || '').padEnd(2, '0')}`;
  }
  return text;
};

// Utility function to create vendor mappings for parts in a purchase order
async function createVendorMappingsForPO(client: any, lineItems: any[], vendorId: number) {
  console.log(`Creating vendor mappings for vendor ${vendorId}...`);
  
  for (const item of lineItems) {
    const { part_number, part_description } = item;
    if (!part_number) continue;

    const normalizedPartNumber = part_number.toString().trim().toUpperCase();
    
    // Check if this part exists in inventory
    const existingPartResult = await client.query(
      `SELECT part_number, part_id FROM "inventory" 
       WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')`,
      [normalizedPartNumber]
    );

          if (existingPartResult.rows.length > 0) {
        const canonicalPartNumber = existingPartResult.rows[0].part_number;
        const canonicalPartId = existingPartResult.rows[0].part_id;
        const vendorPartNumber = normalizedPartNumber;
        
        // Check if vendor mapping already exists
      const existingMapping = await client.query(
        `SELECT id, usage_count FROM inventory_vendors 
         WHERE part_id = $1 AND vendor_id = $2 AND vendor_part_number = $3`,
        [canonicalPartId, vendorId, vendorPartNumber]
      );

      if (existingMapping.rows.length > 0) {
        // Update existing mapping
        const currentMapping = existingMapping.rows[0];
        await client.query(
          `UPDATE inventory_vendors SET 
           usage_count = $1,
           vendor_part_description = COALESCE($2, vendor_part_description),
           last_used_at = NOW()
           WHERE id = $3`,
          [currentMapping.usage_count + 1, part_description || null, currentMapping.id]
        );
      } else {
        // Insert new mapping
        await client.query(
          `INSERT INTO inventory_vendors (part_number, part_id, vendor_id, vendor_part_number, vendor_part_description, preferred, is_active, usage_count, last_used_at)
           VALUES ($1, $2, $3, $4, $5, false, true, 1, NOW())`,
          [canonicalPartNumber, canonicalPartId, vendorId, vendorPartNumber, part_description || null]
        );
      }
    } else {
      console.log(`Skipping vendor mapping for part ${normalizedPartNumber} - not found in inventory`);
    }
  }
  
  console.log(`✅ Vendor mapping completed for vendor ${vendorId}`);
}

const router = express.Router();
const adminOnly = requireAccessRoles([ACCESS_ROLES.ADMIN]);
const calculationService = new PurchaseOrderCalculationService(pool);
const purchaseOrderService = new PurchaseOrderService(pool);
const inventoryService = new InventoryService(pool);

// Get all open purchase orders
router.get('/open', async (req: Request, res: Response) => {
  console.log('purchaseOrderRoutes: GET /open - Request received');
  console.log('purchaseOrderRoutes: Query params:', req.query);
  
  try {
    const { startDate, endDate, status, searchTerm } = req.query;
    
    let query = `
      SELECT poh.purchase_id, poh.purchase_number, COALESCE(vm.vendor_name, 'No Vendor') as vendor_name, poh.purchase_date as bill_date, 
             poh.purchase_number as bill_number, poh.subtotal, poh.total_gst_amount, poh.total_amount, poh.status, poh.gst_rate
      FROM purchasehistory poh
      LEFT JOIN vendormaster vm ON poh.vendor_id = vm.vendor_id
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramIndex = 1;

    // Add date range filter if provided
    if (startDate && endDate) {
      query += ` AND poh.purchase_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(startDate, endDate);
      paramIndex += 2;
    }

    // Add status filter if provided and not 'all'
    if (status && status !== 'all') {
      query += ` AND poh.status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    // Add search term filter if provided
    if (searchTerm) {
      query += ` AND (
        poh.purchase_number ILIKE $${paramIndex} OR
        vm.vendor_name ILIKE $${paramIndex} OR
        poh.purchase_number ILIKE $${paramIndex}
      )`;
      params.push(`%${searchTerm}%`);
      paramIndex += 1;
    }

    query += ` ORDER BY poh.created_at DESC`;

    console.log('purchaseOrderRoutes: Final query:', query);
    console.log('purchaseOrderRoutes: Query params:', params);

    const result = await pool.query(query, params);
    console.log('purchaseOrderRoutes: Query result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseOrderRoutes: Error fetching open purchase orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all closed purchase orders (history)
router.get('/history', async (req: Request, res: Response) => {
  console.log('purchaseOrderRoutes: GET /history - Request received');
  try {
    const result = await pool.query(`
      SELECT poh.purchase_id, poh.purchase_number, COALESCE(vm.vendor_name, 'No Vendor') as vendor_name, poh.purchase_date as bill_date, 
             poh.purchase_number as bill_number, poh.subtotal, poh.total_gst_amount, poh.total_amount, poh.status, poh.gst_rate
      FROM purchasehistory poh
      LEFT JOIN vendormaster vm ON poh.vendor_id = vm.vendor_id
      WHERE poh.status = 'Closed' ORDER BY poh.created_at DESC`);
    console.log('purchaseOrderRoutes: History query result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseOrderRoutes: Error fetching purchase order history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-create purchase order from parts to order
router.post('/auto-create-from-parts-to-order', async (req: Request, res: Response) => {
  console.log('purchaseOrderRoutes: POST /auto-create-from-parts-to-order - Request received');
  
  try {
    const { parts } = req.body;
    
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: 'No parts provided' });
    }

    // Group parts by vendor (last vendor for each part)
    const vendorGroups: { [vendorId: string]: {
      vendor_id: number | null;
      vendor_name: string;
      vendor_address: { street_address: string; city: string; province: string; country: string };
      parts: any[];
    } } = {};
    
    for (const part of parts) {
      // Get the last vendor for this part
      const lastVendorResult = await pool.query(`
        SELECT ph.vendor_id, vm.vendor_name, vm.street_address, vm.city, vm.province, vm.country
        FROM purchasehistory ph
        JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
        JOIN purchaselineitems pli ON ph.purchase_id = pli.purchase_id
        WHERE pli.part_number = $1
        ORDER BY ph.purchase_date DESC, ph.purchase_id DESC
        LIMIT 1
      `, [part.part_number]);

      let vendorId = null;
      let vendorName = 'Unknown Vendor';
      let vendorAddress = { street_address: '', city: '', province: '', country: '' };

      if (lastVendorResult.rows.length > 0) {
        vendorId = lastVendorResult.rows[0].vendor_id;
        vendorName = lastVendorResult.rows[0].vendor_name;
        vendorAddress = {
          street_address: lastVendorResult.rows[0].street_address || '',
          city: lastVendorResult.rows[0].city || '',
          province: lastVendorResult.rows[0].province || '',
          country: lastVendorResult.rows[0].country || ''
        };
      } else {
        // If no vendor found, use null vendor (will be grouped separately)
        vendorId = null;
        vendorName = 'No Vendor Assigned';
        vendorAddress = {
          street_address: '',
          city: '',
          province: '',
          country: ''
        };
      }

      // If no vendor found, create a default group
      const groupKey = vendorId ? vendorId.toString() : 'default';
      
      if (!vendorGroups[groupKey]) {
        vendorGroups[groupKey] = {
          vendor_id: vendorId,
          vendor_name: vendorName,
          vendor_address: vendorAddress,
          parts: []
        };
      }
      
      vendorGroups[groupKey].parts.push(part);
    }

    const createdPOs = [];

    // Create a purchase order for each vendor group
    for (const [groupKey, group] of Object.entries(vendorGroups)) {
      if (group.parts.length === 0) continue;

      // Generate purchase order number
      const currentYear = new Date().getFullYear();
      const { poNumber } = await getNextPurchaseOrderNumberForYear(currentYear);
      const purchaseNumber = poNumber;

      // Calculate totals
      let subtotal = 0;
      const lineItems = [];

      for (const part of group.parts) {
        const lineAmount = part.total_quantity_needed * part.unit_price;
        subtotal += lineAmount;
        
        lineItems.push({
          part_number: part.part_number,
          part_description: part.part_description,
          quantity: part.total_quantity_needed,
          unit: part.unit,
          unit_cost: part.unit_price,
          line_total: lineAmount
        });
      }

      const gstRate = 5.0; // Default GST rate
      const totalGSTAmount = subtotal * (gstRate / 100);
      const totalAmount = subtotal + totalGSTAmount;

      // Create purchase order
      const poResult = await pool.query(`
        INSERT INTO purchasehistory (
          purchase_number, vendor_id, purchase_date, subtotal, total_gst_amount, total_amount, gst_rate, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING purchase_id
      `, [
        purchaseNumber,
        group.vendor_id || null, // Handle null vendor_id
        new Date(),
        subtotal,
        totalGSTAmount,
        totalAmount,
        gstRate,
        'Open'
      ]);

      const purchaseId = poResult.rows[0].purchase_id;

      // Create line items (resolve and store part_id)
      for (const item of lineItems) {
        const normalized = String(item.part_number || '').trim().toUpperCase();
        const invQ = await pool.query(
          `SELECT part_id FROM inventory WHERE REPLACE(REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', ''), '"', '') = REPLACE(REPLACE(REPLACE(UPPER($1), '-', ''), ' ', ''), '"', '')`,
          [normalized]
        );
        const resolvedPartId = invQ.rows[0]?.part_id || null;

        await pool.query(`
          INSERT INTO purchaselineitems (
            purchase_id, part_number, part_description, quantity, unit, unit_cost, line_total, part_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          purchaseId,
          item.part_number,
          item.part_description,
          item.quantity,
          item.unit,
          item.unit_cost,
          item.line_total,
          resolvedPartId
        ]);
      }

      createdPOs.push({
        purchase_id: purchaseId,
        purchase_number: purchaseNumber,
        vendor_name: group.vendor_name,
        total_amount: totalAmount,
        parts_count: group.parts.length
      });

      console.log(`Created PO ${purchaseNumber} for vendor ${group.vendor_name} with ${group.parts.length} parts`);
    }

    res.json({
      success: true,
      message: `Created ${createdPOs.length} purchase order(s)`,
      purchase_orders: createdPOs,
      purchase_order_number: createdPOs.length === 1 ? createdPOs[0].purchase_number : `${createdPOs.length} POs created`
    });

  } catch (error) {
    console.error('purchaseOrderRoutes: Error creating purchase order from parts to order:', error);
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

// Add QBO export fields to PO responses and add export endpoint
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT ph.*, vm.vendor_name, vm.street_address as vendor_street_address, vm.city as vendor_city,
              vm.province as vendor_province, vm.country as vendor_country, vm.postal_code as vendor_postal_code,
              vm.telephone_number as vendor_phone, vm.email as vendor_email, ph.exported_to_qbo, ph.qbo_exported_at, ph.qbo_export_status
       FROM purchasehistory ph
       LEFT JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
       WHERE ph.purchase_id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    // Fetch line items
    const lineItemsRes = await pool.query('SELECT * FROM purchaselineitems WHERE purchase_id = $1', [id]);
    const returnOrdersRes = await pool.query(
      `SELECT ro.return_id, ro.return_number, ro.status, ro.requested_at, ro.returned_at,
              COALESCE(SUM(rol.quantity), 0) AS total_quantity
       FROM return_orders ro
       LEFT JOIN return_order_line_items rol ON rol.return_id = ro.return_id
       WHERE ro.purchase_id = $1
       GROUP BY ro.return_id
       ORDER BY ro.requested_at DESC`,
      [id]
    );
    const returnSummaryRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'Requested') AS requested_count,
         COUNT(*) FILTER (WHERE status = 'Returned') AS returned_count
       FROM return_orders
       WHERE purchase_id = $1`,
      [id]
    );
    const po = result.rows[0];
    po.lineItems = lineItemsRes.rows;
    po.return_orders = returnOrdersRes.rows;
    po.return_summary = returnSummaryRes.rows[0] || { requested_count: 0, returned_count: 0 };
    res.json(po);
  } catch (err) {
    console.error('Error fetching PO detail:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List endpoint: include QBO export fields
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *, exported_to_qbo, qbo_exported_at, qbo_export_status FROM purchasehistory`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching POs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export to QBO endpoint (mock)
router.post('/:id/export-to-qbo', adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    // Check PO exists and is closed
    const result = await pool.query('SELECT * FROM purchasehistory WHERE purchase_id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const po = result.rows[0];
    if (po.status !== 'Closed') return res.status(400).json({ error: 'PO must be closed to export.' });
    if (po.exported_to_qbo) return res.status(400).json({ error: 'PO already exported.' });

    // Get QBO connection
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    let accessContext;
    try {
      accessContext = await ensureFreshQboAccess(pool, qboResult.rows[0], companyId);
    } catch (refreshError) {
      console.error('Error refreshing QBO token:', refreshError instanceof Error ? refreshError.message : String(refreshError));
      return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
    }

    // Get vendor information
    const vendorResult = await pool.query('SELECT * FROM vendormaster WHERE vendor_id = $1', [po.vendor_id]);
    if (vendorResult.rows.length === 0) {
      return res.status(400).json({ error: 'Vendor not found for this purchase order.' });
    }
    const vendor = vendorResult.rows[0];

    // Get line items
    const lineItemsResult = await pool.query('SELECT * FROM purchaselineitems WHERE purchase_id = $1', [id]);
    const lineItems = lineItemsResult.rows;

    // Get QBO account mapping
    const accountMappingResult = await pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [companyId]);
    if (accountMappingResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks account mapping not configured. Please set up account mapping in QBO Settings first.' });
    }
    const accountMapping = accountMappingResult.rows[0];
    const taxableTaxCodeId = await resolveTaxableQboTaxCodeId(
      accessContext.accessToken,
      accessContext.realmId
    );
    if (!taxableTaxCodeId) {
      return res.status(400).json({
        error: 'QBO_TAX_CODE_NOT_FOUND',
        message: 'QuickBooks requires a taxable tax code on bill lines. Please create or activate a GST/HST tax code in QBO and try again.'
      });
    }
    const exportDate = new Date().toISOString().slice(0, 10);

    // Check if vendor exists in QuickBooks first
    const vendorExists = await checkQBOVendorExists(vendor.vendor_name, accessContext.accessToken, accessContext.realmId);
    
    if (!vendorExists) {
      return res.status(400).json({ 
        error: 'VENDOR_NOT_FOUND',
        message: `Vendor '${vendor.vendor_name}' does not exist in QuickBooks.`,
        vendorName: vendor.vendor_name,
        vendorData: {
          DisplayName: vendor.vendor_name,
          CompanyName: vendor.vendor_name,
          PrimaryEmailAddr: vendor.email ? { Address: vendor.email } : undefined,
          PrimaryPhone: vendor.telephone_number ? { FreeFormNumber: vendor.telephone_number } : undefined,
          BillAddr: {
            Line1: vendor.street_address,
            City: vendor.city,
            CountrySubDivisionCode: vendor.province,
            Country: vendor.country
          }
        }
      });
    }

    // Filter line items by part type and create separate arrays
    const stockLineItems = [];
    const supplyLineItems = [];
    console.log('=== QBO Export Debug ===');
    console.log('Total line items:', lineItems.length);
    console.log('QBO account mapping loaded');
    
    for (const item of lineItems) {
      // Check if this part exists in inventory and get its part_type
      const inventoryResult = await pool.query(
        'SELECT part_type FROM inventory WHERE part_number = $1',
        [item.part_number]
      );
      
      console.log(`Item ${item.part_number}:`, {
        part_number: item.part_number,
        inventory_found: inventoryResult.rows.length > 0,
        part_type: inventoryResult.rows[0]?.part_type || 'NOT_FOUND'
      });
      
      if (inventoryResult.rows.length > 0) {
        const partType = inventoryResult.rows[0].part_type;
        if (partType === 'stock') {
          stockLineItems.push(item);
          console.log(`  -> Added to STOCK items`);
        } else if (partType === 'supply') {
          supplyLineItems.push(item);
          console.log(`  -> Added to SUPPLY items`);
        }
      } else {
        console.log(`  -> Item not found in inventory, skipping`);
      }
    }
    
    console.log('Stock items count:', stockLineItems.length);
    console.log('Supply items count:', supplyLineItems.length);
    console.log('Supply expense account configured:', !!accountMapping.qbo_supply_expense_account_id);

    // Create QBO Bill with separate line items for stock and supply items
    const qboBillLines: any[] = [];

    // Add stock items to inventory account
    stockLineItems.forEach((item: any) => {
      const amount = parseFloat(item.unit_cost) * parseFloat(item.quantity);
      console.log(`Adding stock item ${item.part_number} to inventory account: ${accountMapping.qbo_inventory_account_id}`);
      console.log(`  - Unit cost: ${item.unit_cost} (parsed: ${parseFloat(item.unit_cost)})`);
      console.log(`  - Quantity: ${item.quantity} (parsed: ${parseFloat(item.quantity)})`);
      console.log(`  - Calculated amount: ${amount}`);
      qboBillLines.push({
        Amount: amount,
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_inventory_account_id
          },
          BillableStatus: 'NotBillable',
          TaxCodeRef: {
            value: taxableTaxCodeId
          }
        }
      });
    });

    // Add supply items to expense account (if supply expense account is configured)
    if (accountMapping.qbo_supply_expense_account_id && supplyLineItems.length > 0) {
      console.log(`Adding ${supplyLineItems.length} supply items to expense account: ${accountMapping.qbo_supply_expense_account_id}`);
      supplyLineItems.forEach((item: any) => {
        const amount = parseFloat(item.unit_cost) * parseFloat(item.quantity);
        console.log(`Adding supply item ${item.part_number} to expense account: ${accountMapping.qbo_supply_expense_account_id}`);
        console.log(`  - Unit cost: ${item.unit_cost} (parsed: ${parseFloat(item.unit_cost)})`);
        console.log(`  - Quantity: ${item.quantity} (parsed: ${parseFloat(item.quantity)})`);
        console.log(`  - Calculated amount: ${amount}`);
        qboBillLines.push({
          Amount: amount,
          DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_supply_expense_account_id
          },
          BillableStatus: 'NotBillable',
          TaxCodeRef: {
            value: taxableTaxCodeId
          }
        }
      });
      });
    } else {
      console.log('Supply items not added because:', {
        supply_expense_account_configured: !!accountMapping.qbo_supply_expense_account_id,
        supply_items_count: supplyLineItems.length
      });
    }
    
    console.log('Final QBO bill lines count:', qboBillLines.length);

    const qboBill = {
      VendorRef: {
        value: await getQBOVendorId(vendor.vendor_name, accessContext.accessToken, accessContext.realmId)
      },
      Line: qboBillLines,
      APAccountRef: {
        value: accountMapping.qbo_ap_account_id
      },
      DocNumber: po.purchase_number,
      TxnDate: exportDate,
      PrivateNote: `Imported from Aiven - PO: ${po.purchase_number}`
    };

    // Create bill in QBO
    const qboResponse = await qboHttp.post(
      `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/bill`,
      qboBill,
      {
        headers: {
          'Authorization': `Bearer ${accessContext.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    const qboBillLineCount = qboResponse.data?.Bill?.Line?.length || 0;
    console.log('QBO API Response:', qboResponse.status, `lines=${qboBillLineCount}`);

    // Mark as exported
    await pool.query(
      'UPDATE purchasehistory SET exported_to_qbo = TRUE, qbo_exported_at = NOW(), qbo_export_status = NULL WHERE purchase_id = $1',
      [id]
    );

    // Calculate summary for response
    const totalStockAmount = stockLineItems.reduce((sum, item) => sum + (parseFloat(item.unit_cost) * parseFloat(item.quantity)), 0);
    const totalSupplyAmount = supplyLineItems.reduce((sum, item) => sum + (parseFloat(item.unit_cost) * parseFloat(item.quantity)), 0);
    const gstAmount = parseFloat(po.total_gst_amount) || 0;
    const totalAmount = totalStockAmount + totalSupplyAmount + gstAmount;

    res.json({ 
      success: true, 
      qboBillId: qboResponse.data.Bill.Id,
      message: 'Purchase order exported to QuickBooks successfully',
      summary: {
        stockItems: stockLineItems.length,
        totalStockAmount: totalStockAmount.toFixed(2),
        supplyItems: supplyLineItems.length,
        totalSupplyAmount: totalSupplyAmount.toFixed(2),
        gstAmount: gstAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        vendorName: vendor.vendor_name
      }
    });

  } catch (err) {
    console.error('Error exporting PO to QBO:', err instanceof Error ? err.message : String(err));
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await pool.query('UPDATE purchasehistory SET qbo_export_status = $1 WHERE purchase_id = $2', [errorMessage, id]);
    res.status(500).json({ error: 'Failed to export to QuickBooks.', details: errorMessage });
  }
});

// Create vendor in QBO and then export PO
router.post('/:id/export-to-qbo-with-vendor', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { vendorData } = req.body;
  
  try {
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    // Check PO exists and is closed
    const result = await pool.query('SELECT * FROM purchasehistory WHERE purchase_id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const po = result.rows[0];
    if (po.status !== 'Closed') return res.status(400).json({ error: 'PO must be closed to export.' });
    if (po.exported_to_qbo) return res.status(400).json({ error: 'PO already exported.' });

    // Get QBO connection
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    let accessContext;
    try {
      accessContext = await ensureFreshQboAccess(pool, qboResult.rows[0], companyId);
    } catch (refreshError) {
      console.error('Error refreshing QBO token:', refreshError instanceof Error ? refreshError.message : String(refreshError));
      return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
    }

    // Get vendor information
    const vendorResult = await pool.query('SELECT * FROM vendormaster WHERE vendor_id = $1', [po.vendor_id]);
    if (vendorResult.rows.length === 0) {
      return res.status(400).json({ error: 'Vendor not found for this purchase order.' });
    }
    const vendor = vendorResult.rows[0];

    // Get line items
    const lineItemsResult = await pool.query('SELECT * FROM purchaselineitems WHERE purchase_id = $1', [id]);
    const lineItems = lineItemsResult.rows;

    // Get QBO account mapping
    const accountMappingResult = await pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [companyId]);
    if (accountMappingResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks account mapping not configured. Please set up account mapping in QBO Settings first.' });
    }
    const accountMapping = accountMappingResult.rows[0];
    const taxableTaxCodeId = await resolveTaxableQboTaxCodeId(
      accessContext.accessToken,
      accessContext.realmId
    );
    if (!taxableTaxCodeId) {
      return res.status(400).json({
        error: 'QBO_TAX_CODE_NOT_FOUND',
        message: 'QuickBooks requires a taxable tax code on bill lines. Please create or activate a GST/HST tax code in QBO and try again.'
      });
    }
    const exportDate = new Date().toISOString().slice(0, 10);

    // Create vendor in QBO first
    const qboVendorId = await createQBOVendor(vendorData, accessContext.accessToken, accessContext.realmId);

    // Filter line items to only include stock items (not supply)
    const stockLineItems = [];
    for (const item of lineItems) {
      // Check if this part exists in inventory and is marked as stock
      const inventoryResult = await pool.query(
        'SELECT part_type FROM inventory WHERE part_number = $1',
        [item.part_number]
      );
      
      if (inventoryResult.rows.length > 0 && inventoryResult.rows[0].part_type === 'stock') {
        stockLineItems.push(item);
      }
    }

    // Create QBO Bill with individual line items for stock items
    const qboBill = {
      VendorRef: {
        value: qboVendorId
      },
      Line: stockLineItems.map((item: any) => ({
        Amount: parseFloat(item.unit_cost) * parseFloat(item.quantity), // Individual item cost
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_inventory_account_id
          },
          BillableStatus: 'NotBillable',
          TaxCodeRef: {
            value: taxableTaxCodeId
          }
        }
      })),
      APAccountRef: {
        value: accountMapping.qbo_ap_account_id
      },
      DocNumber: po.purchase_number,
      TxnDate: exportDate,
      DueDate: po.purchase_date,
      PrivateNote: `Exported from Aiven Purchase Order #${po.purchase_id}`
    };

    // Create bill in QBO
    const qboResponse = await qboHttp.post(
      `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/bill`,
      qboBill,
      {
        headers: {
          'Authorization': `Bearer ${accessContext.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    // Mark as exported
    await pool.query(
      'UPDATE purchasehistory SET exported_to_qbo = TRUE, qbo_exported_at = NOW(), qbo_export_status = NULL WHERE purchase_id = $1',
      [id]
    );

    // Calculate summary for response
    const totalStockAmount = stockLineItems.reduce((sum, item) => sum + (parseFloat(item.unit_cost) * parseFloat(item.quantity)), 0);
    const gstAmount = parseFloat(po.total_gst_amount) || 0;
    const totalAmount = totalStockAmount + gstAmount;

    res.json({ 
      success: true, 
      qboBillId: qboResponse.data.Bill.Id,
      qboVendorId: qboVendorId,
      message: 'Purchase order exported to QuickBooks successfully',
      summary: {
        stockItems: stockLineItems.length,
        totalStockAmount: totalStockAmount.toFixed(2),
        gstAmount: gstAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        vendorName: vendor.vendor_name
      }
    });

  } catch (err) {
    console.error('Error exporting PO to QBO with vendor creation:', err instanceof Error ? err.message : String(err));
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await pool.query('UPDATE purchasehistory SET qbo_export_status = $1 WHERE purchase_id = $2', [errorMessage, id]);
    res.status(500).json({ error: 'Failed to export to QuickBooks.', details: errorMessage });
  }
});

// Helper function to check if vendor exists in QBO
async function checkQBOVendorExists(vendorName: string, accessToken: string, realmId: string): Promise<boolean> {
  try {
    const searchResponse = await qboHttp.get(
      `${getQboApiBaseUrl()}/v3/company/${realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: `SELECT * FROM Vendor WHERE DisplayName = '${vendorName}'`,
          minorversion: '75'
        }
      }
    );

    return !!(searchResponse.data.QueryResponse?.Vendor && searchResponse.data.QueryResponse.Vendor.length > 0);
  } catch (error) {
    console.error('Error checking QBO vendor existence:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

// Helper function to get vendor ID from QBO (vendor must exist)
async function getQBOVendorId(vendorName: string, accessToken: string, realmId: string): Promise<string> {
  try {
    const searchResponse = await qboHttp.get(
      `${getQboApiBaseUrl()}/v3/company/${realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: `SELECT * FROM Vendor WHERE DisplayName = '${vendorName}'`,
          minorversion: '75'
        }
      }
    );

    if (searchResponse.data.QueryResponse?.Vendor && searchResponse.data.QueryResponse.Vendor.length > 0) {
      return searchResponse.data.QueryResponse.Vendor[0].Id;
    }

    throw new Error(`Vendor '${vendorName}' not found in QuickBooks`);
  } catch (error) {
    console.error('Error getting QBO vendor ID:', error instanceof Error ? error.message : String(error));
    throw new Error(`Vendor '${vendorName}' not found in QuickBooks`);
  }
}

// Helper function to create vendor in QBO
async function createQBOVendor(vendorData: any, accessToken: string, realmId: string): Promise<string> {
  try {
    const createResponse = await qboHttp.post(
      `${getQboApiBaseUrl()}/v3/company/${realmId}/vendor`,
      vendorData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    return createResponse.data.Vendor.Id;
  } catch (error) {
    console.error('Error creating QBO vendor:', error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to create vendor '${vendorData.DisplayName}' in QuickBooks`);
  }
}

// Manual recalculation endpoint for purchase order totals
router.post('/:id/recalculate', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log(`Manual recalculation triggered for PO ${id}`);
    const updatedTotals = await calculationService.recalculateAndUpdateTotals(parseInt(id));
    
    res.json({
      success: true,
      message: `Purchase order ${id} totals recalculated successfully`,
      totals: updatedTotals
    });
  } catch (error) {
    console.error(`Error manually recalculating PO ${id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to recalculate purchase order totals',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create a new parts purchase
router.post('/', async (req: Request, res: Response) => {
  const { lineItems, ...header } = req.body ?? {};

  try {
    const created = await purchaseOrderService.createPurchaseOrder({ ...header, lineItems });
    res.status(201).json(created);
  } catch (err) {
    console.error('partsPurchaseRoutes: Error creating parts purchase:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';

    if (message.includes('vendor_id is required')) {
      res.status(400).json({ error: 'vendor_id is required' });
      return;
    }

    if (message.includes('already exists in another purchase order')) {
      res.status(409).json({
        error: 'Duplicate bill number',
        message,
      });
      return;
    }

    if (message.includes('required')) {
      res.status(400).json({ error: message });
      return;
    }

    res.status(500).json({
      error: 'Internal server error',
      details: message,
      code: 'INTERNAL_ERROR',
    });
  }
});

// Delete a purchase order
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log('purchaseOrderRoutes: DELETE /:id - Request received for ID:', id);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete line items first due to foreign key constraint
    await client.query('DELETE FROM purchaselineitems WHERE purchase_id = $1', [id]);
    
    // Delete the purchase order
    const result = await client.query('DELETE FROM purchasehistory WHERE purchase_id = $1 RETURNING purchase_id', [id]);
    
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Purchase order deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('purchaseOrderRoutes: Error deleting purchase order:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT route to handle comprehensive updates for purchase orders
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  console.log(`purchaseOrderRoutes: PUT /:id - Request to update PO ID: ${id}`);
  console.log('Received data:', JSON.stringify(updatedData, null, 2));

  const { lineItems: incomingLineItems, ...purchaseOrderData } = updatedData;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      vendor_id,
      status,
      subtotal,
      total_gst_amount,
      total_amount,
      bill_number,
      purchase_date,
      gst_rate
    } = purchaseOrderData;

    // Normalize incoming line items for consistent processing
    let lineItems = Array.isArray(incomingLineItems) ? incomingLineItems : [];
    lineItems = lineItems.map((item: any) => {
      const rawLineAmount = item.line_amount ?? item.line_total;
      const parsedQuantity = parseFloat(item.quantity);
      const parsedUnitCost = parseFloat(item.unit_cost);
      const parsedLineAmount = rawLineAmount != null ? parseFloat(rawLineAmount) : NaN;
      return {
        ...item,
        line_item_id: item.line_item_id != null ? Number(item.line_item_id) : undefined,
        part_number: item.part_number ? item.part_number.toString().trim() : '',
        part_description: item.part_description ? item.part_description.toString().trim() : '',
        unit: item.unit ? item.unit.toString().trim() : '',
        quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : 0,
        unit_cost: Number.isFinite(parsedUnitCost) ? parsedUnitCost : 0,
        line_amount: Number.isFinite(parsedLineAmount)
          ? parsedLineAmount
          : (Number.isFinite(parsedQuantity) && Number.isFinite(parsedUnitCost)
            ? parsedQuantity * parsedUnitCost
            : 0),
      };
    });

    // Trim string fields
    const trimmedBillNumber = bill_number ? bill_number.trim() : '';

    // Check for duplicate bill number if bill number is provided (excluding current purchase order)
    if (bill_number && bill_number.trim()) {
      const duplicateCheck = await client.query(
        'SELECT COUNT(*) as count FROM purchasehistory WHERE bill_number = $1 AND purchase_id != $2',
        [bill_number.trim(), id]
      );
      const count = parseInt(duplicateCheck.rows[0].count);
      if (count > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ 
          error: 'Duplicate bill number',
          message: `Bill number "${bill_number}" already exists in another purchase order.`
        });
      }
    }

    // Fetch old status to check for transitions
    const oldStatusResult = await client.query('SELECT status FROM "purchasehistory" WHERE purchase_id = $1', [id]);
    const oldStatus = oldStatusResult.rows[0]?.status;

    const existingLineItemsRes = await client.query(
      'SELECT line_item_id, part_number, quantity, part_id FROM "purchaselineitems" WHERE purchase_id = $1',
      [id]
    );

    const existingLineItemsMap = new Map<number, { partNumber: string; quantity: number; partId: number | null }>();
    for (const row of existingLineItemsRes.rows) {
      const lineItemId = Number(row.line_item_id);
      if (!Number.isFinite(lineItemId)) continue;
      const quantity = Number.parseFloat(row.quantity) || 0;
      const partNumber = row.part_number ? row.part_number.toString().trim() : '';
      const partId = row.part_id != null ? Number(row.part_id) : null;
      existingLineItemsMap.set(lineItemId, { partNumber, quantity, partId });
    }

    const shouldCheckReturns = oldStatus === 'Closed';
    const isClosedEdit = oldStatus === 'Closed' && status === 'Closed';

    const normalizePartKey = (value: string) =>
      value ? value.replace(/[-"\s]/g, '').toUpperCase() : '';

    type InventoryAdjustment = { delta: number; partNumber: string; partId: number | null };
    const inventoryAdjustments = new Map<string, InventoryAdjustment>();
    const addInventoryAdjustment = (partNumber: string, delta: number, partId: number | null) => {
      const trimmed = partNumber ? partNumber.toString().trim() : '';
      if (!trimmed || !Number.isFinite(delta) || delta === 0) return;
      const key = normalizePartKey(trimmed);
      if (!key) return;
      const existingAdjustment = inventoryAdjustments.get(key);
      if (existingAdjustment) {
        existingAdjustment.delta += delta;
        if (!existingAdjustment.partId && partId) {
          existingAdjustment.partId = partId;
        }
      } else {
        inventoryAdjustments.set(key, { delta, partNumber: trimmed, partId });
      }
    };

    const updatedLineItemsById = new Map<number, any>();
    for (const item of lineItems) {
      if (typeof item.line_item_id === 'number') {
        updatedLineItemsById.set(item.line_item_id, item);
      }
    }

    let returnQuantities = new Map<number, number>();
    if (shouldCheckReturns) {
      const returnTotalsRes = await client.query(
        `SELECT rol.purchase_line_item_id, COALESCE(SUM(rol.quantity), 0) AS total
         FROM return_order_line_items rol
         JOIN return_orders ro ON ro.return_id = rol.return_id
         WHERE ro.purchase_id = $1
         GROUP BY rol.purchase_line_item_id`,
        [id]
      );

      returnQuantities = new Map<number, number>();
      for (const row of returnTotalsRes.rows) {
        if (row.purchase_line_item_id == null) continue;
        returnQuantities.set(Number(row.purchase_line_item_id), Number(row.total));
      }

      for (const [lineItemId, existing] of existingLineItemsMap.entries()) {
        const returnedQty = returnQuantities.get(lineItemId) || 0;
        const updatedItem = updatedLineItemsById.get(lineItemId);

        if (!updatedItem) {
          if (returnedQty > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: `Cannot remove line item ${existing.partNumber || lineItemId} because ${returnedQty} units are already associated with return orders.`
            });
          }
          if (isClosedEdit && existing.quantity !== 0) {
            addInventoryAdjustment(existing.partNumber, -existing.quantity, existing.partId);
          }
          continue;
        }

        const newQuantity = Number.isFinite(updatedItem.quantity) ? Number(updatedItem.quantity) : 0;
        if (returnedQty > newQuantity + 1e-6) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Cannot reduce quantity for ${existing.partNumber || lineItemId} below ${returnedQty}. The quantity is already tied to return orders.`
          });
        }

        const existingKey = normalizePartKey(existing.partNumber);
        const newKey = normalizePartKey(updatedItem.part_number || existing.partNumber);

        if (returnedQty > 0 && existingKey !== newKey) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Cannot change the part for line item ${existing.partNumber || lineItemId} because return orders already reference it.`
          });
        }

        if (isClosedEdit) {
          if (existingKey === newKey) {
            const delta = newQuantity - existing.quantity;
            if (Math.abs(delta) > 1e-6) {
              addInventoryAdjustment(updatedItem.part_number || existing.partNumber, delta, updatedItem.part_id ?? existing.partId ?? null);
            }
          } else {
            if (existing.quantity !== 0) {
              addInventoryAdjustment(existing.partNumber, -existing.quantity, existing.partId);
            }
            if (newQuantity !== 0) {
              addInventoryAdjustment(updatedItem.part_number, newQuantity, updatedItem.part_id ?? null);
            }
          }
        }
      }

      if (isClosedEdit) {
        for (const item of lineItems) {
          if (typeof item.line_item_id === 'number') continue;
          const qty = Number.isFinite(item.quantity) ? Number(item.quantity) : 0;
          if (qty !== 0) {
            addInventoryAdjustment(item.part_number, qty, item.part_id ?? null);
          }
        }
      }
    }

    const effectiveGstRateUpdate = typeof gst_rate === 'number' && !isNaN(gst_rate) ? gst_rate : 5.0;

    const updatePoQuery = `
      UPDATE "purchasehistory" SET
        vendor_id = $1,
        purchase_date = $2,
        status = $3,
        subtotal = $4,
        total_gst_amount = $5,
        total_amount = $6,
        bill_number = $7,
        gst_rate = $8,
        updated_at = NOW()
      WHERE purchase_id = $9
      RETURNING *;
    `;

    const updatedPo = await client.query(updatePoQuery, [
      vendor_id,
      purchase_date || new Date(),
      status,
      subtotal,
      total_gst_amount,
      total_amount,
      trimmedBillNumber,
      effectiveGstRateUpdate,
      id
    ]);

    console.log('Updated PO Header:', updatedPo.rows[0]);

    // Delete removed line items, then update or insert provided ones
    // 1) Find existing line_item_ids for this purchase
    const existingIds: number[] = existingLineItemsRes.rows
      .map((r: any) => Number(r.line_item_id))
      .filter((value: number) => Number.isFinite(value));

    // 2) Determine which existing items were kept (present in payload with line_item_id)
    const providedExistingIds: number[] = lineItems
      .map((item: any) => (typeof item.line_item_id === 'number' ? item.line_item_id : undefined))
      .filter((v: any): v is number => typeof v === 'number');

    // 3) Compute deletions = existing - providedExisting
    const toDelete: number[] = existingIds.filter((eid: number) => !providedExistingIds.includes(eid));

    if (toDelete.length > 0) {
      // Delete only those missing from payload (user removed them)
      const placeholders = toDelete.map((_, idx) => `$${idx + 2}`).join(',');
      await client.query(
        `DELETE FROM "purchaselineitems" WHERE purchase_id = $1 AND line_item_id IN (${placeholders})`,
        [id, ...toDelete]
      );
    }

    // 4) Update or insert remaining/provided line items
    for (const item of lineItems) {
      const normalizedPart = String(item.part_number || '').trim().toUpperCase();
      const invQ = await client.query(
        `SELECT part_id FROM inventory WHERE REPLACE(REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', ''), '"', '') = REPLACE(REPLACE(REPLACE(UPPER($1), '-', ''), ' ', ''), '"', '')`,
        [normalizedPart]
      );
      const resolvedPartId = invQ.rows[0]?.part_id || null;

      if (item.line_item_id) {
        // Update existing line item
        await client.query(`
          UPDATE "purchaselineitems" SET
            part_number = $1,
            part_description = $2,
            quantity = $3,
            unit_cost = $4,
            line_total = $5,
            unit = $6,
            part_id = $7,
            updated_at = NOW()
          WHERE line_item_id = $8;
        `, [item.part_number, item.part_description, item.quantity, item.unit_cost, item.line_amount, item.unit, resolvedPartId, item.line_item_id]);
      } else {
        // Insert new line item, storing part_id
        await client.query(`
          INSERT INTO "purchaselineitems" (purchase_id, part_number, part_description, quantity, unit_cost, line_total, unit, part_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
        `, [id, item.part_number, item.part_description, item.quantity, item.unit_cost, item.line_amount, item.unit, resolvedPartId]);
      }
    }

    // Recalculate and update purchase order totals after line item changes
    console.log(`Recalculating totals for PO ${id} after line item updates...`);
    try {
      const updatedTotals = await calculationService.recalculateAndUpdateTotals(parseInt(id), client);
      console.log(`✅ Updated totals for PO ${id}:`, updatedTotals);
    } catch (calcError) {
      console.error(`❌ Error recalculating totals for PO ${id}:`, calcError);
      // Don't fail the entire operation, but log the error
    }
    
    // If editing an already Closed PO, propagate unit and last_unit_cost updates to inventory (no qty changes)
    if (oldStatus === 'Closed' && status === 'Closed') {
      try {
        for (const item of lineItems) {
          const normalizedPart = (item?.part_number || '').toString().trim().toUpperCase();
          if (!normalizedPart) continue;
          const unit = (item?.unit || '').toString().trim();
          const unitCost = Number.isFinite(item?.unit_cost) ? Number(item.unit_cost) : 0;

          // Prefer part_id when present
          if (item?.part_id) {
            await client.query(
              `UPDATE inventory 
                 SET unit = COALESCE(NULLIF($1, ''), unit),
                     last_unit_cost = $2,
                     updated_at = NOW()
               WHERE part_id = $3`,
              [unit, unitCost, item.part_id]
            );
          } else {
            // Fallback by normalized part number matching approach used elsewhere
            const invRes = await client.query(
              `SELECT part_id FROM inventory 
                WHERE REPLACE(REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', ''), '"', '') = 
                      REPLACE(REPLACE(REPLACE(UPPER($1), '-', ''), ' ', ''), '"', '')`,
              [normalizedPart]
            );
            if (invRes.rows.length > 0) {
              const pid = invRes.rows[0].part_id;
              await client.query(
                `UPDATE inventory 
                   SET unit = COALESCE(NULLIF($1, ''), unit),
                       last_unit_cost = $2,
                       updated_at = NOW()
                 WHERE part_id = $3`,
                [unit, unitCost, pid]
              );
            } else {
              // If part doesn't exist in inventory (edge case), insert without affecting quantity
              await client.query(
                `INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, part_type)
                 VALUES ($1, $2, $3, $4, 0, 'stock')`,
                [normalizedPart, item.part_description || '', unit || 'Each', unitCost]
              );
            }
          }
        }
        console.log(`Propagated unit and last_unit_cost changes to inventory for closed PO ${id}.`);
      } catch (invSyncErr) {
        console.error(`Error syncing inventory fields from closed PO ${id}:`, invSyncErr);
        // Do not fail the full request on inventory sync error
      }
    }
    
    // If PO is being newly closed, update inventory and trigger allocation
    if (status === 'Closed' && oldStatus !== 'Closed') {
      console.log(`PO ${id} transitioning to Closed. Starting inventory and allocation process...`);

      // Determine part types for all line items up front so we can enforce service rules
      const normalizedPartNumbers = Array.from(
        new Set(
          lineItems
            .map((item: any) =>
              item?.part_number ? String(item.part_number).trim().toUpperCase() : ''
            )
            .filter((pn: string) => pn.length > 0)
        )
      );

      const partTypeMap = new Map<string, string>();
      if (normalizedPartNumbers.length > 0) {
        const placeholders = normalizedPartNumbers.map((_, idx) => `$${idx + 1}`).join(',');
        const partTypeResult = await client.query(
          `SELECT part_number, part_type FROM inventory WHERE UPPER(part_number) IN (${placeholders})`,
          normalizedPartNumbers
        );
        for (const row of partTypeResult.rows) {
          if (row?.part_number) {
            partTypeMap.set(String(row.part_number).toUpperCase(), (row.part_type || '').toLowerCase());
          }
        }
      }

      // Aggregate any manual allocations stored for this purchase order
      const allocationTotalsResult = await client.query(
        `SELECT UPPER(part_number) AS normalized_part_number,
                COALESCE(SUM(allocate_qty::NUMERIC), 0) AS total_allocated
         FROM purchase_order_allocations
         WHERE purchase_id = $1
         GROUP BY UPPER(part_number)`,
        [id]
      );
      const allocationTotals = new Map<string, number>();
      for (const row of allocationTotalsResult.rows) {
        allocationTotals.set(row.normalized_part_number, parseFloat(row.total_allocated) || 0);
      }

      for (const item of lineItems) {
        const normalizedPart = item?.part_number ? String(item.part_number).trim().toUpperCase() : '';
        if (!normalizedPart) continue;
        const partType = partTypeMap.get(normalizedPart);
        if (partType === 'service') {
          const orderedQuantity = parseFloat(item.quantity) || 0;
          if (orderedQuantity <= 0) continue;
          const allocatedQuantity = allocationTotals.get(normalizedPart) || 0;
          const tolerance = 0.0001;
          if (allocatedQuantity + tolerance < orderedQuantity) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: 'SERVICE_ALLOCATION_REQUIRED',
              message: `Service item ${normalizedPart} must be fully allocated to a sales order before closing this purchase order.`,
              details: {
                part_number: normalizedPart,
                ordered_quantity: orderedQuantity,
                allocated_quantity: allocatedQuantity
              }
            });
          }
        }
      }

      // Step 1: Prepare a map to track total allocated quantities for each part
      const allocatedQuantities: { [key: string]: number } = {};

      // Step 2: Perform allocation first to determine what is used immediately
      console.log(`PO ${id} closed. Triggering automatic allocation process...`);
      try {
        for (const poItem of lineItems) {
          const partNumber = poItem.part_number.toString().trim().toUpperCase();
          const poQuantity = parseFloat(poItem.quantity) || 0;
          if (poQuantity <= 0) continue;

          console.log(`Processing allocation for part ${partNumber} (available quantity: ${poQuantity})`);

          // Get sales orders that need this part from parts to order
          const salesOrdersNeedingPart = await client.query(
            `SELECT sopt.sales_order_id, sopt.quantity_needed, sopt.part_description, sopt.unit, sopt.unit_price
             FROM sales_order_parts_to_order sopt
             JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
             WHERE REPLACE(REPLACE(UPPER(sopt.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
               AND soh.status = 'Open'
             ORDER BY soh.sales_date ASC`,
            [partNumber]
          );

          // Get manually allocated sales orders for this part
          const manuallyAllocatedSalesOrders = await client.query(
  `SELECT 
      poa.sales_order_id,
      poa.allocate_qty AS quantity_needed,
      poa.part_description,
      COALESCE(soli.unit, inv.unit, 'Each') AS unit,
      COALESCE(soli.unit_price, inv.last_unit_cost, 0) AS unit_price
   FROM purchase_order_allocations poa
   JOIN salesorderhistory soh ON poa.sales_order_id = soh.sales_order_id
   LEFT JOIN salesorderlineitems soli 
     ON soh.sales_order_id = soli.sales_order_id 
    AND REPLACE(REPLACE(UPPER(soli.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '')
   LEFT JOIN inventory inv 
     ON REPLACE(REPLACE(UPPER(inv.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '')
   WHERE REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
     AND soh.status = 'Open'
     AND poa.purchase_id = $2
   ORDER BY soh.sales_date ASC`,
  [partNumber, id]
);

          // Combine both sources and remove duplicates
          const allSalesOrdersNeedingPart = [...salesOrdersNeedingPart.rows];
          const existingSalesOrderIds = new Set(salesOrdersNeedingPart.rows.map(row => row.sales_order_id));
          
          for (const manualAllocation of manuallyAllocatedSalesOrders.rows) {
            if (!existingSalesOrderIds.has(manualAllocation.sales_order_id)) {
              allSalesOrdersNeedingPart.push(manualAllocation);
            }
          }

          let remainingPoQuantity = poQuantity;

          for (const salesOrder of allSalesOrdersNeedingPart) {
            if (remainingPoQuantity <= 0) break;

            const neededQuantity = parseFloat(salesOrder.quantity_needed) || 0;
            if (neededQuantity <= 0) continue;

            const allocateQuantity = Math.min(remainingPoQuantity, neededQuantity);
            console.log(`Allocating ${allocateQuantity} of part ${partNumber} to sales order ${salesOrder.sales_order_id}`);

            // Update or create sales order line item
            const existingLineItemResult = await client.query(
              'SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
              [salesOrder.sales_order_id, partNumber]
            );

            if (existingLineItemResult.rows.length > 0) {
              // Update existing line item
              const currentLineItem = existingLineItemResult.rows[0];
              const currentQuantitySold = parseFloat(currentLineItem.quantity_sold) || 0;
              const newQuantitySold = currentQuantitySold + allocateQuantity;
              await client.query(
                'UPDATE salesorderlineitems SET quantity_sold = $1, updated_at = CURRENT_TIMESTAMP WHERE sales_order_id = $2 AND part_number = $3',
                [newQuantitySold, salesOrder.sales_order_id, partNumber]
              );
              console.log(`✅ Updated line item for sales order ${salesOrder.sales_order_id}, part ${partNumber}: quantity_sold increased from ${currentQuantitySold} to ${newQuantitySold}`);
            } else {
              // Create new line item with sensible fallbacks for description/unit/price
              const invRes = await client.query(
                'SELECT part_id, part_description, unit, last_unit_cost FROM inventory WHERE part_number = $1',
                [partNumber]
              );
              const invDesc = invRes.rows[0]?.part_description || '';
              const invUnit = invRes.rows[0]?.unit || '';
              const invPrice = parseFloat(invRes.rows[0]?.last_unit_cost) || 0;

              const poUnit = poItem.unit || '';
              const poDesc = poItem.part_description || '';
              const poPrice = parseFloat(poItem.unit_cost) || 0;

              const soUnit = (salesOrder.unit && salesOrder.unit.trim() && salesOrder.unit.trim() !== 'Each') ? salesOrder.unit : '';
              const insertUnit = soUnit || (poUnit && poUnit.trim() && poUnit.trim() !== 'Each' ? poUnit : '') || invUnit || 'Each';
              const insertDesc = salesOrder.part_description || poDesc || invDesc || '';
              const unitPrice = (parseFloat(salesOrder.unit_price) || 0) || invPrice || poPrice || 0;
              const lineAmount = allocateQuantity * unitPrice;
              
              await client.query(
                `INSERT INTO salesorderlineitems 
                 (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount, part_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [salesOrder.sales_order_id, partNumber, insertDesc, allocateQuantity, insertUnit, unitPrice, lineAmount, invRes.rows[0]?.part_id || null]
              );
              
              console.log(`✅ Created new line item for sales order ${salesOrder.sales_order_id}, part ${partNumber}: quantity_sold=${allocateQuantity}, unit_price=${unitPrice}, line_amount=${lineAmount}`);
            }

            // Update sales_order_parts_to_order only if this sales order was from parts to order
            const isFromPartsToOrder = salesOrdersNeedingPart.rows.some(row => row.sales_order_id === salesOrder.sales_order_id);
            if (isFromPartsToOrder) {
              const newQuantityNeeded = Math.max(0, neededQuantity - allocateQuantity);
              if (newQuantityNeeded > 0) {
                await client.query(
                  'UPDATE sales_order_parts_to_order SET quantity_needed = $1 WHERE sales_order_id = $2 AND part_number = $3',
                  [newQuantityNeeded, salesOrder.sales_order_id, partNumber]
                );
              } else {
                await client.query(
                  'DELETE FROM sales_order_parts_to_order WHERE sales_order_id = $1 AND part_number = $2',
                  [salesOrder.sales_order_id, partNumber]
                );
              }
            }

            remainingPoQuantity -= allocateQuantity;
            
            // Track the total allocated quantity for this part number
            if (!allocatedQuantities[partNumber]) {
              allocatedQuantities[partNumber] = 0;
            }
            allocatedQuantities[partNumber] += allocateQuantity;
          }
        }
        console.log(`✅ Automatic allocation process completed for PO ${id}`);
      } catch (allocationError) {
        console.error('Error during automatic allocation:', allocationError);
        // Decide if you want to rollback or just log
      }

      // Step 3: Update inventory with the remaining (unallocated) quantity
      console.log(`Updating inventory based on received and allocated quantities...`);
      for (const item of lineItems) {
        const { part_number, quantity, unit_cost } = item;
        if (!part_number) continue;

        const normalizedPartNumber = part_number.toString().trim().toUpperCase();
        const inferredPartType = partTypeMap.get(normalizedPartNumber);
        const numericQuantity = parseFloat(quantity) || 0;
        const numericUnitCost = parseFloat(unit_cost) || 0;

        // Calculate the quantity to add to inventory (received minus allocated)
        const allocated = allocatedQuantities[normalizedPartNumber] || 0;
        const quantityToAddToInventory = numericQuantity - allocated;

        console.log(`Part: ${normalizedPartNumber}, Received: ${numericQuantity}, Allocated: ${allocated}, To Inventory: ${quantityToAddToInventory}`);

        if (quantityToAddToInventory < 0) {
          console.warn(`Warning: Allocated quantity (${allocated}) for part ${normalizedPartNumber} exceeds received quantity (${numericQuantity}). Inventory will not be decreased.`);
          // Optionally, handle this case more robustly
          continue;
        }

        const existingPartResult = await client.query(
          `SELECT part_id, part_number, part_type FROM "inventory" 
           WHERE REPLACE(REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', ''), '"', '') = REPLACE(REPLACE(REPLACE(UPPER($1), '-', ''), ' ', ''), '"', '')`,
          [normalizedPartNumber]
        );

        if (existingPartResult.rows.length === 0) {
          if (inferredPartType === 'service') {
            console.log(`Service part '${normalizedPartNumber}' is fully allocated. Skipping inventory insert.`);
            continue;
          }
          // New part - insert as stock by default, only if there's a quantity to add
          if (quantityToAddToInventory > 0) {
            console.log(`Adding new part to inventory: '${normalizedPartNumber}' (quantity: ${quantityToAddToInventory}, unit_cost: ${numericUnitCost})`);
            await client.query(
              `INSERT INTO "inventory" (part_number, quantity_on_hand, last_unit_cost, part_description, unit, part_type)
               VALUES ($1, $2, $3, $4, $5, 'stock')`,
              [normalizedPartNumber, quantityToAddToInventory, numericUnitCost, item.part_description, item.unit]
            );
          } else {
            console.log(`Skipping new part insert for '${normalizedPartNumber}' as the entire quantity was allocated.`);
          }
        } else {
          const partType = (existingPartResult.rows[0].part_type || '').toLowerCase();
          const existingPartNumber: string = existingPartResult.rows[0].part_number;
          const existingPartId: number = existingPartResult.rows[0].part_id;
          if (partType === 'stock') {
            // Update quantity_on_hand for stock items, only if there's a quantity to add
            if (quantityToAddToInventory > 0) {
              console.log(`Updating inventory for stock part: '${normalizedPartNumber}' (adding quantity: ${quantityToAddToInventory}, unit_cost: ${numericUnitCost})`);
              await client.query(
                `UPDATE "inventory" SET
                 quantity_on_hand = CAST(COALESCE(NULLIF(quantity_on_hand, 'NA')::NUMERIC, 0) + CAST($1 AS NUMERIC) AS VARCHAR(20)),
                 last_unit_cost = $2,
                 updated_at = NOW()
                 WHERE part_id = $3`,
                [quantityToAddToInventory, numericUnitCost, existingPartId]
              );
            } else {
              console.log(`Skipping inventory update for '${normalizedPartNumber}' as the entire quantity was allocated.`);
              // Still update the unit cost even if no quantity is added
              await client.query(
                `UPDATE "inventory" SET last_unit_cost = $1, updated_at = NOW() WHERE part_id = $2`,
                [numericUnitCost, existingPartId]
              );
            }
          } else if (partType === 'supply' || partType === 'service') {
            const typeLabel = partType === 'service' ? 'service' : 'supply';
            // For supply and service items, only update last_unit_cost, not quantity_on_hand
            console.log(`Updating last_unit_cost for ${typeLabel} part: '${normalizedPartNumber}' (unit_cost: ${numericUnitCost})`);
            await client.query(
              `UPDATE "inventory" SET last_unit_cost = $1, updated_at = NOW() WHERE part_id = $2`,
              [numericUnitCost, existingPartResult.rows[0].part_id]
            );
          } else {
            console.log(`Unknown part type '${partType}' for part '${normalizedPartNumber}'. Updating last_unit_cost only.`);
            await client.query(
              `UPDATE "inventory" SET last_unit_cost = $1, updated_at = NOW() WHERE part_id = $2`,
              [numericUnitCost, existingPartResult.rows[0].part_id]
            );
          }
        }
      }

      // Step 4: Create automatic vendor mappings for all parts in this purchase order
      console.log(`Creating automatic vendor mappings for PO ${id}...`);
      try {
        await createVendorMappingsForPO(client, lineItems, vendor_id);
        console.log(`✅ Automatic vendor mapping completed for PO ${id}`);
      } catch (vendorMappingError) {
        console.error('Error during automatic vendor mapping:', vendorMappingError);
        // Don't fail the entire operation, but log the error
      }
    }
    // Closed purchase orders are now editable; disallow reopening entirely
    if (status === 'Open' && oldStatus === 'Closed') {
      console.warn(`Reopen attempt blocked for purchase order ${id}.`);
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Reopen not allowed',
        message: 'Closed purchase orders cannot be reopened. Create a new purchase order if additional items are required.'
      });
    }

    // If PO is being closed, trigger automatic allocation process
    if (status === 'Closed' && oldStatus !== 'Closed' && false /* duplicate block disabled */) {
      console.log(`PO ${id} closed. Triggering automatic allocation process...`);
      
      try {
        // Get all open sales orders that need parts from this purchase order
        const openSalesOrdersResult = await client.query(`
          SELECT DISTINCT soh.sales_order_id, soh.sales_order_number
          FROM salesorderhistory soh
          JOIN sales_order_parts_to_order sopt ON soh.sales_order_id = sopt.sales_order_id
          WHERE soh.status = 'Open'
          AND sopt.part_number IN (
            SELECT part_number FROM purchaselineitems WHERE purchase_id = $1
          )
        `, [id]);
        
        console.log(`Found ${openSalesOrdersResult.rows.length} open sales orders for allocation`);
        
        // For each part in the purchase order, try to allocate to open sales orders
        for (const poItem of lineItems) {
          const partNumber = poItem.part_number.toString().trim().toUpperCase();
          const poQuantity = parseFloat(poItem.quantity) || 0;
          
          if (poQuantity <= 0) continue;
          
          console.log(`Processing allocation for part ${partNumber} (quantity: ${poQuantity})`);
          
          // Get sales orders that need this part from parts to order
          const salesOrdersNeedingPart = await client.query(`
            SELECT sopt.sales_order_id, sopt.quantity_needed, sopt.part_description, sopt.unit, sopt.unit_price
            FROM sales_order_parts_to_order sopt
            JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
            WHERE REPLACE(REPLACE(UPPER(sopt.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
              AND soh.status = 'Open'
            ORDER BY soh.sales_date ASC
          `, [partNumber]);

          // Get manually allocated sales orders for this part
          const manuallyAllocatedSalesOrders = await client.query(
  `SELECT 
      poa.sales_order_id,
      poa.allocate_qty AS quantity_needed,
      poa.part_description,
      COALESCE(soli.unit, inv.unit, 'Each') AS unit,
      COALESCE(soli.unit_price, inv.last_unit_cost, 0) AS unit_price
   FROM purchase_order_allocations poa
   JOIN salesorderhistory soh ON poa.sales_order_id = soh.sales_order_id
   LEFT JOIN salesorderlineitems soli 
     ON soh.sales_order_id = soli.sales_order_id 
    AND REPLACE(REPLACE(UPPER(soli.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '')
   LEFT JOIN inventory inv 
     ON REPLACE(REPLACE(UPPER(inv.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '')
   WHERE REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
     AND soh.status = 'Open'
     AND poa.purchase_id = $2
   ORDER BY soh.sales_date ASC`,
  [partNumber, id]
);

          // Combine both sources and remove duplicates
          const allSalesOrdersNeedingPart = [...salesOrdersNeedingPart.rows];
          const existingSalesOrderIds = new Set(salesOrdersNeedingPart.rows.map(row => row.sales_order_id));
          
          for (const manualAllocation of manuallyAllocatedSalesOrders.rows) {
            if (!existingSalesOrderIds.has(manualAllocation.sales_order_id)) {
              allSalesOrdersNeedingPart.push(manualAllocation);
            }
          }
          
          let remainingQuantity = poQuantity;
          
          for (const salesOrder of allSalesOrdersNeedingPart) {
            if (remainingQuantity <= 0) break;
            
            const neededQuantity = parseFloat(salesOrder.quantity_needed) || 0;
            if (neededQuantity <= 0) continue;
            
            const allocateQuantity = Math.min(remainingQuantity, neededQuantity);
            
            console.log(`Allocating ${allocateQuantity} of part ${partNumber} to sales order ${salesOrder.sales_order_id}`);
            
            // Update or create sales order line item
            const existingLineItemResult = await client.query(
              'SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
              [salesOrder.sales_order_id, partNumber]
            );
            
            if (existingLineItemResult.rows.length > 0) {
              // Update existing line item
              const currentLineItem = existingLineItemResult.rows[0];
              const currentQuantitySold = parseFloat(currentLineItem.quantity_sold) || 0;
              const newQuantitySold = currentQuantitySold + allocateQuantity;
              
              await client.query(
                'UPDATE salesorderlineitems SET quantity_sold = $1, updated_at = CURRENT_TIMESTAMP WHERE sales_order_id = $2 AND part_number = $3',
                [newQuantitySold, salesOrder.sales_order_id, partNumber]
              );
              
              console.log(`✅ Updated line item for sales order ${salesOrder.sales_order_id}, part ${partNumber}: quantity_sold increased from ${currentQuantitySold} to ${newQuantitySold}`);
            } else {
              // Create new line item with sensible fallbacks for description/unit/price
              const invRes = await client.query(
                'SELECT part_description, unit, last_unit_cost FROM inventory WHERE part_number = $1',
                [partNumber]
              );
              const invDesc = invRes.rows[0]?.part_description || '';
              const invUnit = invRes.rows[0]?.unit || '';
              const invPrice = parseFloat(invRes.rows[0]?.last_unit_cost) || 0;

              const poUnit = poItem.unit || '';
              const poDesc = poItem.part_description || '';
              const poPrice = parseFloat(poItem.unit_cost) || 0;

              const soUnit = (salesOrder.unit && salesOrder.unit.trim() && salesOrder.unit.trim() !== 'Each') ? salesOrder.unit : '';
              const insertUnit = soUnit || (poUnit && poUnit.trim() && poUnit.trim() !== 'Each' ? poUnit : '') || invUnit || 'Each';
              const insertDesc = salesOrder.part_description || poDesc || invDesc || '';
              const unitPrice = (parseFloat(salesOrder.unit_price) || 0) || invPrice || poPrice || 0;
              const lineAmount = allocateQuantity * unitPrice;
              
              await client.query(
                `INSERT INTO salesorderlineitems 
                 (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [salesOrder.sales_order_id, partNumber, insertDesc, allocateQuantity, insertUnit, unitPrice, lineAmount]
              );
              
              console.log(`✅ Created new line item for sales order ${salesOrder.sales_order_id}, part ${partNumber}: quantity_sold=${allocateQuantity}, unit_price=${unitPrice}, line_amount=${lineAmount}`);
            }
            
            // Update sales_order_parts_to_order only if this sales order was from parts to order
            const isFromPartsToOrder = salesOrdersNeedingPart.rows.some(row => row.sales_order_id === salesOrder.sales_order_id);
            if (isFromPartsToOrder) {
              const newQuantityNeeded = Math.max(0, neededQuantity - allocateQuantity);
              
              if (newQuantityNeeded > 0) {
                await client.query(
                  'UPDATE sales_order_parts_to_order SET quantity_needed = $1 WHERE sales_order_id = $2 AND part_number = $3',
                  [newQuantityNeeded, salesOrder.sales_order_id, partNumber]
                );
                console.log(`📝 Updated parts to order for sales order ${salesOrder.sales_order_id}, part ${partNumber}: quantity_needed reduced from ${neededQuantity} to ${newQuantityNeeded}`);
              } else {
                await client.query(
                  'DELETE FROM sales_order_parts_to_order WHERE sales_order_id = $1 AND part_number = $2',
                  [salesOrder.sales_order_id, partNumber]
                );
                console.log(`🗑️ Removed parts to order entry for sales order ${salesOrder.sales_order_id}, part ${partNumber} (no more quantity needed)`);
              }
            } else {
              console.log(`📝 Manual allocation processed for sales order ${salesOrder.sales_order_id}, part ${partNumber}: allocated ${allocateQuantity}`);
            }
            
            remainingQuantity -= allocateQuantity;
          }
          
          // Update aggregated_parts_to_order table
          const totalNeededResult = await client.query(
            `SELECT SUM(quantity_needed) as total_needed FROM sales_order_parts_to_order sopt 
             JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id 
             WHERE REPLACE(REPLACE(UPPER(sopt.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
               AND soh.status = 'Open'`,
            [partNumber]
          );
          
          const totalNeeded = parseFloat(totalNeededResult.rows[0]?.total_needed || '0');
          
          if (totalNeeded > 0) {
            const partDetailsResult = await client.query(
              `SELECT part_description, unit, unit_price FROM sales_order_parts_to_order 
               WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
               LIMIT 1`,
              [partNumber]
            );
            
            const partDetails = partDetailsResult.rows[0] || {};
            const partDescription = partDetails.part_description || '';
            const unit = partDetails.unit || 'Each';
            const unitPrice = parseFloat(partDetails.unit_price) || 0;
            const totalLineAmount = totalNeeded * unitPrice;
            
                         await client.query(
               `INSERT INTO aggregated_parts_to_order 
                (part_number, part_description, total_quantity_needed, unit, unit_price, total_line_amount, min_required_quantity)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (part_number) 
                DO UPDATE SET 
                  part_description = EXCLUDED.part_description,
                  total_quantity_needed = EXCLUDED.total_quantity_needed,
                  unit = EXCLUDED.unit,
                  unit_price = EXCLUDED.unit_price,
                  total_line_amount = EXCLUDED.total_line_amount,
                  min_required_quantity = EXCLUDED.min_required_quantity,
                  updated_at = CURRENT_TIMESTAMP`,
               [partNumber, partDescription, totalNeeded, unit, unitPrice, totalLineAmount, totalNeeded]
             );
            console.log(`✅ Updated aggregated parts to order for part ${partNumber}: ${totalNeeded}`);
          } else {
            await client.query(
              'DELETE FROM aggregated_parts_to_order WHERE part_number = $1',
              [partNumber]
            );
            console.log(`🗑️ Removed part ${partNumber} from aggregated parts to order (no more needed)`);
          }
        }
        
        console.log(`✅ Automatic allocation process completed for PO ${id}`);
        
      } catch (allocationError) {
        console.error('Error during automatic allocation:', allocationError);
        // Don't fail the entire transaction, just log the error
      }
    }

    // If PO is being closed, validate inventory availability first
    if (status === 'Closed' && oldStatus !== 'Closed') {
      console.log(`PO ${id} transitioning to Closed. Validating inventory availability...`);
      
      // Check if there are sufficient quantities available for allocation
      for (const item of lineItems) {
        if (item.part_number) {
          const normalizedPartNumber = item.part_number.toString().trim().toUpperCase();
          const poQuantity = parseFloat(item.quantity) || 0;
          
          // Check current inventory for this part
          const existingPartResult = await client.query(
            `SELECT part_number, part_type, quantity_on_hand FROM "inventory" 
             WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')`,
            [normalizedPartNumber]
          );
          
          if (existingPartResult.rows.length > 0) {
            const part = existingPartResult.rows[0];
            if (part.part_type === 'stock') {
              const currentQuantity = parseFloat(part.quantity_on_hand) || 0;
              
              // Check if there are open sales orders that need this part
              const salesOrdersNeedingPart = await client.query(
                `SELECT COUNT(*) as count FROM sales_order_parts_to_order sopt
                 JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
                 WHERE REPLACE(REPLACE(UPPER(sopt.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')`,
                [normalizedPartNumber]
              );
              
              const hasOpenDemand = parseInt(salesOrdersNeedingPart.rows[0].count) > 0;
              
              if (hasOpenDemand && currentQuantity < poQuantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                  error: 'Insufficient inventory for allocation',
                  message: `Cannot close purchase order. Part ${normalizedPartNumber} has insufficient quantity: Available: ${currentQuantity}, Required: ${poQuantity}`
                });
              }
            }
          }
        }
      }
      
      console.log(`✅ Inventory validation passed for closing PO ${id}`);
    }

    if (isClosedEdit && inventoryAdjustments.size > 0) {
      console.log(`Applying inventory adjustments for closed PO edit ${id}`, Array.from(inventoryAdjustments.values()));
      for (const adjustment of inventoryAdjustments.values()) {
        const delta = adjustment.delta;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) {
          continue;
        }

        const partLookup = await client.query(
          `SELECT part_id, part_number, part_type
           FROM inventory
           WHERE REPLACE(REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', ''), '"', '') = REPLACE(REPLACE(REPLACE(UPPER($1), '-', ''), ' ', ''), '"', '')
           LIMIT 1`,
          [adjustment.partNumber]
        );

        if (partLookup.rows.length === 0) {
          console.warn(`Skipping inventory adjustment for part ${adjustment.partNumber} - not found in inventory.`);
          continue;
        }

        const partRow = partLookup.rows[0];
        if (partRow.part_type !== 'stock') {
          console.log(`Skipping inventory adjustment for non-stock part ${partRow.part_number}.`);
          continue;
        }

        try {
          await inventoryService.adjustInventoryByPartId(
            Number(partRow.part_id),
            delta,
            `Closed PO edit ${id}`,
            undefined,
            req.user && (req.user as any).id ? Number((req.user as any).id) : undefined,
            client
          );
        } catch (inventoryError) {
          await client.query('ROLLBACK');
          const message = inventoryError instanceof Error ? inventoryError.message : 'Inventory adjustment failed';
          if (inventoryError instanceof Error && inventoryError.message.toLowerCase().includes('insufficient')) {
            return res.status(400).json({
              error: `Insufficient quantity on hand to make this change for part ${partRow.part_number}.`,
              details: message
            });
          }
          return res.status(400).json({
            error: `Unable to adjust inventory for part ${partRow.part_number}.`,
            details: message
          });
        }
      }
    }

    await client.query('COMMIT');
    res.status(200).json(updatedPo.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating purchase order:', error);
    res.status(500).json({ error: 'Failed to update purchase order' });
  } finally {
    client.release();
  }
});

// PDF Generation Route for open purchase orders
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    const purchaseOrderResult = await pool.query(
      `SELECT ph.*, vm.vendor_name, vm.street_address as vendor_street_address, vm.city as vendor_city, vm.province as vendor_province, vm.country as vendor_country, vm.telephone_number as vendor_phone, vm.email as vendor_email, vm.postal_code as vendor_postal_code, ph.gst_rate FROM PurchaseHistory ph JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id = $1`,
      [id]
    );

    if (purchaseOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const purchaseOrder = purchaseOrderResult.rows[0];
    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    purchaseOrder.lineItems = lineItemsResult.rows;

    const doc = new PDFDocument({ margin: 50 });
    let filename = `Purchase_Order_${purchaseOrder.purchase_number}.pdf`;
    filename = encodeURIComponent(filename);
    res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // --- HEADER ---
    let headerY = 50;
    let logoHeight = 100;
    let logoWidth = 180;
    let pageWidth = 600;
    let logoX = 50;
    let companyTitleX = logoX + logoWidth + 20;
    const logoSource = await getLogoImageSource(businessProfile?.logo_url);
    if (logoSource) {
      try {
        doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
      } catch (error) {
        console.error('Error adding logo to PDF:', error);
      }
    }
    // Company name (right of logo, vertically centered with logo)
    const fontSize = 16;
    // Company name slightly above vertical center of logo
    const companyTitleY = headerY + (logoHeight / 2) - (fontSize / 2) - 6;
    if (businessProfile) {
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000').text(
        (businessProfile.business_name || '').toUpperCase(),
        companyTitleX,
        companyTitleY,
        { align: 'left', width: pageWidth - companyTitleX - 50 }
      );
    }
    // Move Y below header (tight 4px gap)
    const logoBottom = headerY + logoHeight;
    const nameBottom = companyTitleY + fontSize;
    let y = Math.max(logoBottom, nameBottom) + 4;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Company & Vendor Info Block ---
    // Headings
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Vendor', 320, y);
    y += 16;
    // Company info (left column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const companyInfoLines = [
      businessProfile?.business_name,
      businessProfile?.street_address,
      [businessProfile?.city, businessProfile?.province, businessProfile?.country, businessProfile?.postal_code].filter(Boolean).join(', '),
      businessProfile?.email,
      businessProfile?.telephone_number
    ].filter(line => line && line.trim() !== '').join('\n');
    doc.text(companyInfoLines, 50, y, { width: 250 });
    // Vendor info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const vendorInfoLines = [
      purchaseOrder.vendor_name,
      purchaseOrder.vendor_street_address,
      [purchaseOrder.vendor_city, purchaseOrder.vendor_province, purchaseOrder.vendor_country, purchaseOrder.vendor_postal_code].filter(Boolean).join(', '),
      purchaseOrder.vendor_email,
      purchaseOrder.vendor_phone
    ].filter(line => line && line.trim() !== '').join('\n');
    doc.text(vendorInfoLines, 320, y, { width: 230 });
    // Calculate the max height used by either block
    const companyInfoHeight = doc.heightOfString(companyInfoLines, { width: 250 });
    const vendorInfoHeight = doc.heightOfString(vendorInfoLines, { width: 230 });
    y += Math.max(companyInfoHeight, vendorInfoHeight) + 4;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Purchase Order Details ---
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('PURCHASE ORDER', 50, y);
    y += 22;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Purchase Order #:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(purchaseOrder.purchase_number, 170, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Order Date:', 320, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      purchaseOrder.purchase_date ? new Date(purchaseOrder.purchase_date).toLocaleDateString() : '',
      400, y
    );
    y += 24;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 14;

    // --- Line Item Table ---
    const tableHeaders = ['SN', 'Item Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'];
    const colWidths = [30, 70, 140, 40, 40, 80, 80];
    let currentX = 50;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
    tableHeaders.forEach((header, i) => {
      doc.text(header, currentX, y, { width: colWidths[i], align: 'left' });
      currentX += colWidths[i];
    });
    y += 16;
    doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#888888').stroke();
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    let sn = 1;
    purchaseOrder.lineItems.forEach((item: any) => {
      currentX = 50;
      let rowY = y;
      
      // Calculate required height for this row based on text content
      const snHeight = doc.heightOfString(sn.toString(), { width: colWidths[0] });
      const partNumberHeight = doc.heightOfString(item.part_number || '', { width: colWidths[1] });
      const partDescHeight = doc.heightOfString(item.part_description || '', { width: colWidths[2] });
      const qtyHeight = doc.heightOfString(parseFloat(item.quantity).toString(), { width: colWidths[3] });
      const unitHeight = doc.heightOfString(item.unit || '', { width: colWidths[4] });
      const unitCostHeight = doc.heightOfString(formatUnitCost(item.unit_cost), { width: colWidths[5] });
      const lineTotalHeight = doc.heightOfString(parseFloat(item.line_total).toFixed(2), { width: colWidths[6] });
      
      const maxTextHeight = Math.max(snHeight, partNumberHeight, partDescHeight, qtyHeight, unitHeight, unitCostHeight, lineTotalHeight);
      const rowHeight = Math.max(maxTextHeight + 6, 16); // Add padding, minimum 16px
      
      // Check if we need a new page
      if (y + rowHeight > doc.page.height - 100) {
        doc.addPage();
        y = 50;
        rowY = y;
      }
      
      // SN
      doc.text(sn.toString(), currentX, rowY, { 
        width: colWidths[0], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[0];
      
      // Part Number
      doc.text(item.part_number || '', currentX, rowY, { 
        width: colWidths[1], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[1];
      
      // Part Description
      doc.text(item.part_description || '', currentX, rowY, { 
        width: colWidths[2], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[2];
      
      // Quantity
      doc.text(parseFloat(item.quantity).toString(), currentX, rowY, { 
        width: colWidths[3], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[3];
      
      // Unit
      doc.text(item.unit || '', currentX, rowY, { 
        width: colWidths[4], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[4];
      
      // Unit Cost
      doc.text(formatUnitCost(item.unit_cost), currentX, rowY, { 
        width: colWidths[5], 
        align: 'right',
        height: rowHeight
      });
      currentX += colWidths[5];
      
      // Line Total
      doc.text(parseFloat(item.line_total).toFixed(2), currentX, rowY, { 
        width: colWidths[6], 
        align: 'right',
        height: rowHeight
      });
      
      // Move y to the next row position
      y += rowHeight + 8;
      
      // Draw row line
      doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#eeeeee').stroke();
      sn++;
    });
    y += 10;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').stroke();
    y += 10;

    // --- Totals Section ---
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sub Total:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(purchaseOrder.subtotal).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Total GST:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(purchaseOrder.total_gst_amount).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Total:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(parseFloat(purchaseOrder.total_amount).toFixed(2), 480, y, { align: 'right', width: 70 });

    doc.end();
  } catch (err) {
    console.error(`Error generating PDF for purchase order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

// QBO account mapping endpoints
router.get('/qbo-account-mapping/:companyId', adminOnly, async (req, res) => {
  const { companyId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [companyId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No mapping found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching QBO account mapping:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/qbo-account-mapping/:companyId', adminOnly, async (req, res) => {
  const { companyId } = req.params;
  const { qbo_inventory_account_id, qbo_gst_account_id, qbo_ap_account_id, qbo_supply_expense_account_id } = req.body;
  try {
    // Upsert mapping
    const result = await pool.query(
      `INSERT INTO qbo_account_mapping (company_id, qbo_inventory_account_id, qbo_gst_account_id, qbo_ap_account_id, qbo_supply_expense_account_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id) DO UPDATE SET
         qbo_inventory_account_id = EXCLUDED.qbo_inventory_account_id,
         qbo_gst_account_id = EXCLUDED.qbo_gst_account_id,
         qbo_ap_account_id = EXCLUDED.qbo_ap_account_id,
         qbo_supply_expense_account_id = EXCLUDED.qbo_supply_expense_account_id,
         updated_at = NOW()
       RETURNING *`,
      [companyId, qbo_inventory_account_id, qbo_gst_account_id, qbo_ap_account_id, qbo_supply_expense_account_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving QBO account mapping:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
