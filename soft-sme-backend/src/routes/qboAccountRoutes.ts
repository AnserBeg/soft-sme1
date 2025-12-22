import express from 'express';
import { qboHttp } from '../utils/qboHttp';
import { pool } from '../db';

const router = express.Router();

// Get QBO accounts for mapping
router.get('/accounts', async (req, res) => {
  try {
    // For now, use company_id = 9 (your actual company ID)
    // TODO: Get this from the user session
    const companyId = 9;
    
    console.log('Fetching QBO accounts for company_id:', companyId);
    
    // Get QBO connection
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      console.log('No QBO connection found for company_id:', companyId);
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    const qboConnection = qboResult.rows[0];
    
    // Check if token is expired and refresh if needed
    if (new Date(qboConnection.expires_at) < new Date()) {
      try {
        const refreshResponse = await qboHttp.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
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
        console.error('Error refreshing QBO token:', refreshError instanceof Error ? refreshError.message : String(refreshError));
        return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
      }
    }

    // Fetch real accounts from QBO using correct v3 API endpoint
    console.log('Fetching real QBO accounts using v3 API...');
    const accountsResponse = await qboHttp.get(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/query`,
      {
        headers: {
          'Authorization': `Bearer ${qboConnection.access_token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: 'SELECT * FROM Account WHERE Active = true ORDER BY Name',
          minorversion: '75'
        }
      }
    );

    const accountCount = accountsResponse.data?.QueryResponse?.Account?.length || 0;
    console.log('QBO API Response:', accountsResponse.status, `accounts=${accountCount}`);
    const accounts = accountsResponse.data.QueryResponse?.Account || accountsResponse.data.Account || accountsResponse.data || [];
    
    if (accounts.length === 0) {
      console.log('No accounts found in QBO response');
      return res.status(404).json({ error: 'No accounts found in QuickBooks. Please ensure you have accounts set up in your QuickBooks company.' });
    }
    
    // Filter accounts by type for better organization
    const accountTypes = {
      'Asset': accounts.filter((acc: any) => acc.Classification === 'Asset'),
      'Liability': accounts.filter((acc: any) => acc.Classification === 'Liability'),
      'Equity': accounts.filter((acc: any) => acc.Classification === 'Equity'),
      'Revenue': accounts.filter((acc: any) => acc.Classification === 'Revenue'),
      'Expense': accounts.filter((acc: any) => acc.Classification === 'Expense')
    };

    res.json({
      accounts,
      accountTypes,
      totalCount: accounts.length
    });

  } catch (error) {
    console.error('Error fetching QBO accounts:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to fetch QuickBooks accounts' });
  }
});

// Get current account mapping
router.get('/mapping', async (req, res) => {
  try {
    // For now, use company_id = 9 (your actual company ID)
    // TODO: Get this from the user session
    const companyId = 9;
    console.log(`Fetching account mapping for company_id: ${companyId}`);
    
    const result = await pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [companyId]);
    console.log(`Found ${result.rows.length} mapping records for company_id ${companyId}`);
    
    if (result.rows.length === 0) {
      console.log('No mapping found, returning null');
      return res.json({ mapping: null });
    }
    
    console.log('Returning account mapping');
    res.json({ mapping: result.rows[0] });
  } catch (error) {
    console.error('Error fetching account mapping:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to fetch account mapping' });
  }
});

// Save account mapping
router.post('/mapping', async (req, res) => {
          const {
          qbo_inventory_account_id,
          qbo_gst_account_id,
          qbo_ap_account_id,
          qbo_supply_expense_account_id,
          qbo_sales_account_id,
          qbo_labour_sales_account_id,
          qbo_ar_account_id,
          qbo_cogs_account_id,
          qbo_cost_of_labour_account_id,
          qbo_cost_of_materials_account_id,
          qbo_labour_expense_reduction_account_id,
          qbo_overhead_cogs_account_id
        } = req.body;
  
  try {
    console.log('Saving account mapping for company');
    // Validate required fields
    if (!qbo_inventory_account_id || !qbo_gst_account_id || !qbo_ap_account_id) {
      return res.status(400).json({ error: 'Inventory, GST, and AP account mappings are required' });
    }

    // For now, use company_id = 9 (your actual company ID)
    // TODO: Get this from the user session
    const companyId = 9;
    console.log(`Using company_id: ${companyId}`);
    
    // Upsert mapping
    const result = await pool.query(
      `INSERT INTO qbo_account_mapping (
        company_id, 
        qbo_inventory_account_id, 
        qbo_gst_account_id, 
        qbo_ap_account_id, 
        qbo_supply_expense_account_id,
        qbo_sales_account_id,
        qbo_labour_sales_account_id,
        qbo_ar_account_id,
        qbo_cogs_account_id,
        qbo_cost_of_labour_account_id,
        qbo_cost_of_materials_account_id,
        qbo_labour_expense_reduction_account_id,
        qbo_overhead_cogs_account_id
      )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (company_id) DO UPDATE SET
        qbo_inventory_account_id = EXCLUDED.qbo_inventory_account_id,
        qbo_gst_account_id = EXCLUDED.qbo_gst_account_id,
        qbo_ap_account_id = EXCLUDED.qbo_ap_account_id,
        qbo_supply_expense_account_id = EXCLUDED.qbo_supply_expense_account_id,
        qbo_sales_account_id = EXCLUDED.qbo_sales_account_id,
        qbo_labour_sales_account_id = EXCLUDED.qbo_labour_sales_account_id,
        qbo_ar_account_id = EXCLUDED.qbo_ar_account_id,
        qbo_cogs_account_id = EXCLUDED.qbo_cogs_account_id,
        qbo_cost_of_labour_account_id = EXCLUDED.qbo_cost_of_labour_account_id,
        qbo_cost_of_materials_account_id = EXCLUDED.qbo_cost_of_materials_account_id,
        qbo_labour_expense_reduction_account_id = EXCLUDED.qbo_labour_expense_reduction_account_id,
        qbo_overhead_cogs_account_id = EXCLUDED.qbo_overhead_cogs_account_id,
        updated_at = NOW()
        RETURNING *`,
        [companyId, qbo_inventory_account_id, qbo_gst_account_id, qbo_ap_account_id, qbo_supply_expense_account_id, qbo_sales_account_id, qbo_labour_sales_account_id, qbo_ar_account_id, qbo_cogs_account_id, qbo_cost_of_labour_account_id, qbo_cost_of_materials_account_id, qbo_labour_expense_reduction_account_id, qbo_overhead_cogs_account_id]
    );

    console.log('Account mapping saved successfully');

    res.json({ 
      success: true, 
      mapping: result.rows[0],
      message: 'Account mapping saved successfully'
    });
  } catch (error) {
    console.error('Error saving account mapping:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to save account mapping' });
  }
});

// Test QBO connection
router.get('/test-connection', async (req, res) => {
  try {
    // For now, use company_id = 9 (your actual company ID)
    // TODO: Get this from the user session
    const companyId = 9;
    
    console.log('Testing QBO connection for company_id:', companyId);
    
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      console.log('No QBO connection found for company_id:', companyId);
      return res.json({ connected: false, message: 'No QuickBooks connection found' });
    }

    const qboConnection = qboResult.rows[0];
    const isExpired = new Date(qboConnection.expires_at) < new Date();

    if (isExpired) {
      return res.json({ 
        connected: false, 
        message: 'QuickBooks token has expired. Please reconnect your account.' 
      });
    }

    // Since OAuth flow is working and we have valid tokens, consider it connected
    console.log('QBO connection validated - tokens are valid');
    res.json({ 
      connected: true, 
      message: 'QuickBooks connection is working',
      realmId: qboConnection.realm_id,
      expiresAt: qboConnection.expires_at
    });

  } catch (error) {
    console.error('Error testing QBO connection:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to test QuickBooks connection' });
  }
});

export default router; 
