import express from 'express';
import { qboHttp } from '../utils/qboHttp';
import { pool } from '../db';
import { resolveTenantCompanyIdFromRequest } from '../utils/companyContext';
import { ensureFreshQboAccess } from '../utils/qboTokens';
import { getQboApiBaseUrl } from '../utils/qboBaseUrl';
import { fetchQboTaxCodeById, resolvePurchaseTaxableQboTaxCodeId } from '../utils/qboTaxCodes';

const router = express.Router();
const escapeQboQueryValue = (value: string): string => value.replace(/'/g, "''");

// Export closed Purchase Order to QuickBooks as a Bill
router.post('/export-purchase-order/:poId', async (req, res) => {
  try {
    const { poId } = req.params;
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    console.log(`Exporting PO ${poId} to QuickBooks for company_id: ${companyId}`);

    // 1. Get QBO connection and account mapping
    console.log(`Checking QBO connection and mapping for company_id: ${companyId}`);
    
    const [qboResult, mappingResult] = await Promise.all([
      pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]),
      pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [companyId])
    ]);

    console.log(`QBO connection result: ${qboResult.rows.length} rows found`);
    console.log(`Account mapping result: ${mappingResult.rows.length} rows found`);
    
    if (mappingResult.rows.length > 0) {
      console.log('QBO account mapping found');
    }

    if (qboResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    if (mappingResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks account mapping not configured. Please set up account mapping in QBO Settings first.' });
    }

    let accessContext;
    try {
      accessContext = await ensureFreshQboAccess(pool, qboResult.rows[0], companyId);
    } catch (refreshError) {
      console.error('Error refreshing QBO token:', refreshError instanceof Error ? refreshError.message : String(refreshError));
      return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
    }
    const accountMapping = mappingResult.rows[0];

    const mappedTaxCodeId = (accountMapping.qbo_purchase_tax_code_id || '').trim();
    const mappedTaxCode = mappedTaxCodeId
      ? await fetchQboTaxCodeById(accessContext.accessToken, accessContext.realmId, mappedTaxCodeId)
      : null;
    if (mappedTaxCodeId && mappedTaxCode) {
      const purchaseRates = mappedTaxCode?.PurchaseTaxRateList?.TaxRateDetail || [];
      console.log('Mapped QBO purchase tax code details:', {
        id: mappedTaxCode.Id,
        name: mappedTaxCode.Name,
        purchaseRateCount: Array.isArray(purchaseRates) ? purchaseRates.length : 0
      });
      if (!Array.isArray(purchaseRates) || purchaseRates.length === 0) {
        return res.status(400).json({
          error: 'QBO_PURCHASE_TAX_CODE_INVALID',
          message: 'Selected QBO purchase tax code has no purchase tax rates. Choose a tax code with GST/HST purchase rates.'
        });
      }
    }
    const taxableTaxCodeId = mappedTaxCodeId || await resolvePurchaseTaxableQboTaxCodeId(
      accessContext.accessToken,
      accessContext.realmId
    );
    if (!taxableTaxCodeId) {
      console.warn('No taxable QBO purchase tax code found; bill lines may be treated as out-of-scope.');
    } else if (mappedTaxCodeId) {
      console.log('Using mapped QBO purchase tax code for bill lines:', taxableTaxCodeId);
    } else {
      console.log('Using resolved QBO purchase tax code for bill lines:', taxableTaxCodeId);
    }

    // 2. Get the Purchase Order details
    const poResult = await pool.query(`
      SELECT 
        po.*,
        v.vendor_name,
        v.email as vendor_email,
        v.phone as vendor_phone,
        v.address as vendor_address,
        v.city as vendor_city,
        v.state as vendor_state,
        v.postal_code as vendor_postal_code
      FROM purchasehistory po
      LEFT JOIN vendormaster v ON po.vendor_id = v.vendor_id
      WHERE po.purchase_id = $1
    `, [poId]);

    if (poResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    const purchaseOrder = poResult.rows[0];

    // 3. Get PO line items
    const lineItemsResult = await pool.query(`
      SELECT 
        poli.*,
        i.part_type
      FROM purchaselineitems poli
      LEFT JOIN inventory i ON poli.part_number = i.part_number
      WHERE poli.purchase_id = $1
    `, [poId]);

    const lineItems = lineItemsResult.rows;

    // 4. Check if vendor exists in QuickBooks, create if not
    let qboVendorId = null;
    try {
      // Search for existing vendor
      const vendorSearchResponse = await qboHttp.get(
        `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/query`,
        {
          headers: {
            'Authorization': `Bearer ${accessContext.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          params: {
            query: `SELECT * FROM Vendor WHERE DisplayName = '${escapeQboQueryValue(purchaseOrder.vendor_name)}'`,
            minorversion: '75'
          }
        }
      );

      const vendors = vendorSearchResponse.data.QueryResponse?.Vendor || [];
      if (vendors.length > 0) {
        qboVendorId = vendors[0].Id;
        console.log('Found existing QBO vendor');
      } else {
        // Create new vendor
        console.log('Creating new QBO vendor');
        const newVendorData = {
          DisplayName: purchaseOrder.vendor_name,
          PrimaryEmailAddr: purchaseOrder.vendor_email ? { Address: purchaseOrder.vendor_email } : undefined,
          PrimaryPhone: purchaseOrder.vendor_phone ? { FreeFormNumber: purchaseOrder.vendor_phone } : undefined,
          BillAddr: {
            Line1: purchaseOrder.vendor_address,
            City: purchaseOrder.vendor_city,
            CountrySubDivisionCode: purchaseOrder.vendor_state,
            PostalCode: purchaseOrder.vendor_postal_code
          }
        };

        const vendorCreateResponse = await qboHttp.post(
          `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/vendor`,
          newVendorData,
          {
            headers: {
              'Authorization': `Bearer ${accessContext.accessToken}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            params: { minorversion: '75' }
          }
        );

        qboVendorId = vendorCreateResponse.data.Vendor.Id;
        console.log('Created new QBO vendor');
      }
    } catch (vendorError) {
      console.error('Error handling vendor:', vendorError instanceof Error ? vendorError.message : String(vendorError));
      return res.status(500).json({ error: 'Failed to handle vendor in QuickBooks' });
    }

    // Create line items for the bill
    const billLineItems = [];

    // Add stock items to inventory account
    const stockItems = lineItems.filter(item => item.part_type === 'stock');
    stockItems.forEach(item => {
      const taxCodeRef = taxableTaxCodeId ? { TaxCodeRef: { value: taxableTaxCodeId } } : {};
      billLineItems.push({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: parseFloat(item.unit_cost) * parseFloat(item.quantity),
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_inventory_account_id
          },
          BillableStatus: 'NotBillable',
          ...taxCodeRef
        }
      });
    });

    // Add supply items to expense account (if supply expense account is configured)
    const supplyItems = lineItems.filter(item => item.part_type === 'supply');
    if (accountMapping.qbo_supply_expense_account_id && supplyItems.length > 0) {
      supplyItems.forEach(item => {
        const taxCodeRef = taxableTaxCodeId ? { TaxCodeRef: { value: taxableTaxCodeId } } : {};
        billLineItems.push({
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: parseFloat(item.unit_cost) * parseFloat(item.quantity),
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_supply_expense_account_id
          },
          BillableStatus: 'NotBillable',
          ...taxCodeRef
        }
      });
    });
  }

    const exportDate = purchaseOrder.purchase_date
      ? new Date(purchaseOrder.purchase_date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const billDocNumber = (purchaseOrder.bill_number || '').trim() || purchaseOrder.purchase_number || `PO-${purchaseOrder.purchase_id}`;
    const billData = {
      VendorRef: {
        value: qboVendorId
      },
      Line: billLineItems,
      APAccountRef: {
        value: accountMapping.qbo_ap_account_id
      },
      GlobalTaxCalculation: 'TaxExcluded',
      DocNumber: billDocNumber,
      TxnDate: exportDate,
      DueDate: purchaseOrder.purchase_date,
      PrivateNote: `Exported from Aiven Purchase Order #${purchaseOrder.purchase_id}`
    };

    console.log(`Creating Bill in QuickBooks: lineCount=${billData.Line?.length || 0}`);

    const billResponse = await qboHttp.post(
      `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/bill`,
      billData,
      {
        headers: {
          'Authorization': `Bearer ${accessContext.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    const qboBillId = billResponse.data.Bill.Id;
    console.log('Successfully created QBO Bill');

    // 7. Update PO with QBO export info
    await pool.query(
      `UPDATE purchasehistory SET 
       qbo_bill_id = $1, 
       qbo_export_date = NOW(),
       qbo_export_status = 'exported'
       WHERE purchase_id = $2`,
      [qboBillId, poId]
    );

    res.json({
      success: true,
      message: 'Purchase Order exported to QuickBooks successfully',
      qboBillId: qboBillId,
      exportedItems: {
        stock: stockItems.length,
        supply: supplyItems.length,
        total: stockItems.length + supplyItems.length
      },
      gstExported: purchaseOrder.total_gst_amount > 0
    });

  } catch (error) {
    const response = (error as any)?.response;
    const fault = response?.data?.Fault;
    const firstError = Array.isArray(fault?.Error) ? fault.Error[0] : null;
    if (firstError) {
      console.error('QBO validation fault:', {
        code: firstError.code,
        message: firstError.Message,
        detail: firstError.Detail,
        element: firstError.element
      });
    }
    console.error('Error exporting PO to QuickBooks:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to export Purchase Order to QuickBooks' });
  }
});

// Get export status for a PO
router.get('/export-status/:poId', async (req, res) => {
  try {
    const { poId } = req.params;

    const result = await pool.query(
      'SELECT qbo_bill_id, qbo_export_date, qbo_export_status FROM purchasehistory WHERE purchase_id = $1',
      [poId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    res.json({
      exported: result.rows[0].qbo_export_status === 'exported',
      qboBillId: result.rows[0].qbo_bill_id,
      exportDate: result.rows[0].qbo_export_date
    });

  } catch (error) {
    console.error('Error getting export status:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to get export status' });
  }
});

export default router; 
