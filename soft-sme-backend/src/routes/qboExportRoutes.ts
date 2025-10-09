import express from 'express';
import axios from 'axios';
import { pool } from '../db';

const router = express.Router();

// Export closed Purchase Order to QuickBooks as a Bill
router.post('/export-purchase-order/:poId', async (req, res) => {
  try {
    const { poId } = req.params;
    const companyId = 9; // TODO: Get from user session

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
      console.log('Found mapping:', mappingResult.rows[0]);
    }

    if (qboResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    if (mappingResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks account mapping not configured. Please set up account mapping in QBO Settings first.' });
    }

    const qboConnection = qboResult.rows[0];
    const accountMapping = mappingResult.rows[0];

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

    // 4. Check if token is expired and refresh if needed
    if (new Date(qboConnection.expires_at) < new Date()) {
      try {
        const refreshResponse = await axios.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
          grant_type: 'refresh_token',
          refresh_token: qboConnection.refresh_token
        }, {
          auth: {
            username: process.env.QBO_CLIENT_ID!,
            password: process.env.QBO_CLIENT_SECRET!
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const { access_token, refresh_token, expires_in } = refreshResponse.data;
        
        // Update tokens in database
        await pool.query(
          `UPDATE qbo_connection SET 
           access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW() 
           WHERE company_id = $4`,
          [access_token, refresh_token, new Date(Date.now() + expires_in * 1000), companyId]
        );

        qboConnection.access_token = access_token;
      } catch (refreshError) {
        console.error('Error refreshing QBO token:', refreshError);
        return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
      }
    }

    // 5. Check if vendor exists in QuickBooks, create if not
    let qboVendorId = null;
    try {
      // Search for existing vendor
      const vendorSearchResponse = await axios.get(
        `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/query`,
        {
          headers: {
            'Authorization': `Bearer ${qboConnection.access_token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          params: {
            query: `SELECT * FROM Vendor WHERE DisplayName = '${purchaseOrder.vendor_name}'`,
            minorversion: '75'
          }
        }
      );

      const vendors = vendorSearchResponse.data.QueryResponse?.Vendor || [];
      if (vendors.length > 0) {
        qboVendorId = vendors[0].Id;
        console.log(`Found existing QBO vendor: ${purchaseOrder.vendor_name} (ID: ${qboVendorId})`);
      } else {
        // Create new vendor
        console.log(`Creating new QBO vendor: ${purchaseOrder.vendor_name}`);
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

        const vendorCreateResponse = await axios.post(
          `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/vendor`,
          newVendorData,
          {
            headers: {
              'Authorization': `Bearer ${qboConnection.access_token}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            params: { minorversion: '75' }
          }
        );

        qboVendorId = vendorCreateResponse.data.Vendor.Id;
        console.log(`Created new QBO vendor with ID: ${qboVendorId}`);
      }
    } catch (vendorError) {
      console.error('Error handling vendor:', vendorError);
      return res.status(500).json({ error: 'Failed to handle vendor in QuickBooks' });
    }

    // Create line items for the bill
    const billLineItems = [];

    // Add stock items to inventory account
    const stockItems = lineItems.filter(item => item.part_type === 'stock');
    stockItems.forEach(item => {
      billLineItems.push({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: parseFloat(item.unit_cost) * parseFloat(item.quantity),
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_inventory_account_id
          },
          BillableStatus: 'NotBillable'
        }
      });
    });

    // Add supply items to expense account (if supply expense account is configured)
    const supplyItems = lineItems.filter(item => item.part_type === 'supply');
    if (accountMapping.qbo_supply_expense_account_id && supplyItems.length > 0) {
      supplyItems.forEach(item => {
        billLineItems.push({
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: parseFloat(item.unit_cost) * parseFloat(item.quantity),
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: accountMapping.qbo_supply_expense_account_id
            },
            BillableStatus: 'NotBillable'
          }
        });
      });
    }

    // Add GST line item if there's GST
    if (purchaseOrder.total_gst_amount && purchaseOrder.total_gst_amount > 0) {
      billLineItems.push({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: parseFloat(purchaseOrder.total_gst_amount),
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: accountMapping.qbo_gst_account_id
          },
          BillableStatus: 'NotBillable'
        }
      });
    }

    const billData = {
      VendorRef: {
        value: qboVendorId
      },
      Line: billLineItems,
      APAccountRef: {
        value: accountMapping.qbo_ap_account_id
      },
      DocNumber: `PO-${purchaseOrder.purchase_id}`,
      TxnDate: purchaseOrder.purchase_date,
      DueDate: purchaseOrder.purchase_date,
      PrivateNote: `Exported from Aiven Purchase Order #${purchaseOrder.purchase_id}`
    };

    console.log('Creating Bill in QuickBooks with data:', JSON.stringify(billData, null, 2));

    const billResponse = await axios.post(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/bill`,
      billData,
      {
        headers: {
          'Authorization': `Bearer ${qboConnection.access_token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    const qboBillId = billResponse.data.Bill.Id;
    console.log(`Successfully created QBO Bill with ID: ${qboBillId}`);

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
    console.error('Error exporting PO to QuickBooks:', error);
    res.status(500).json({ error: 'Failed to export Purchase Order to QuickBooks' });
  }
});

// Get export status for a PO
router.get('/export-status/:poId', async (req, res) => {
  try {
    const { poId } = req.params;
    const companyId = 9; // TODO: Get from user session

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
    console.error('Error getting export status:', error);
    res.status(500).json({ error: 'Failed to get export status' });
  }
});

export default router; 