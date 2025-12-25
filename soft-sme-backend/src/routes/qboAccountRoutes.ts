import express from 'express';
import { qboHttp } from '../utils/qboHttp';
import { pool } from '../db';
import { decryptQboValue } from '../utils/qboCrypto';
import { getCompanyIdFromRequest, resolveTenantCompanyIdFromRequest } from '../utils/companyContext';
import { resolveTenantCompanyId } from '../utils/tenantCompany';
import { ensureFreshQboAccess, revokeQboRefreshToken } from '../utils/qboTokens';
import { getQboApiBaseUrl } from '../utils/qboBaseUrl';

const router = express.Router();

const getCompanyIdOverrideFromQuery = (req: express.Request): number | null => {
  const raw =
    req.query?.company_id ??
    req.query?.companyId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const resolveQboCompanyId = async (
  req: express.Request
): Promise<number | null> => {
  const overrideCompanyId = getCompanyIdOverrideFromQuery(req);
  const requestedCompanyId = overrideCompanyId ?? getCompanyIdFromRequest(req);
  if (!requestedCompanyId) {
    return null;
  }

  const tenantCompanyId = await resolveTenantCompanyId(pool, String(requestedCompanyId));
  const normalized = Number(tenantCompanyId);
  if (!Number.isInteger(normalized)) {
    return null;
  }

  if (normalized !== requestedCompanyId) {
    try {
      const exists = await pool.query(
        'SELECT 1 FROM qbo_connection WHERE company_id = $1 LIMIT 1',
        [requestedCompanyId]
      );
      if (exists.rows.length > 0) {
        return requestedCompanyId;
      }
    } catch {
      /* best-effort */
    }
  }

  return normalized;
};

// Get QBO accounts for mapping
router.get('/accounts', async (req, res) => {
  try {
    const companyId = await resolveQboCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    console.log('Fetching QBO accounts for company_id:', companyId);
    
    // Get QBO connection
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      console.log('No QBO connection found for company_id:', companyId);
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    let accessContext;
    try {
      accessContext = await ensureFreshQboAccess(pool, qboResult.rows[0], companyId);
    } catch (refreshError) {
      console.error('Error refreshing QBO token:', refreshError instanceof Error ? refreshError.message : String(refreshError));
      return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
    }

    // Fetch real accounts from QBO using correct v3 API endpoint
    console.log('Fetching real QBO accounts using v3 API...');
    const accountsResponse = await qboHttp.get(
      `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessContext.accessToken}`,
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

// Get QBO tax codes for mapping
router.get('/tax-codes', async (req, res) => {
  try {
    const companyId = await resolveQboCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    console.log('Fetching QBO tax codes for company_id:', companyId);

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

    const taxCodesResponse = await qboHttp.get(
      `${getQboApiBaseUrl()}/v3/company/${accessContext.realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessContext.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: 'SELECT Id, Name, Active, SalesTaxRateList, PurchaseTaxRateList FROM TaxCode WHERE Active = true ORDER BY Name',
          minorversion: '75'
        }
      }
    );

    const taxCodes = taxCodesResponse.data?.QueryResponse?.TaxCode || [];
    res.json({ taxCodes });
  } catch (error) {
    console.error('Error fetching QBO tax codes:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to fetch QuickBooks tax codes' });
  }
});

// Get current account mapping
router.get('/mapping', async (req, res) => {
  try {
    const companyId = await resolveQboCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
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
          qbo_ap_account_id,
          qbo_supply_expense_account_id,
          qbo_sales_account_id,
          qbo_labour_sales_account_id,
          qbo_ar_account_id,
          qbo_cogs_account_id,
          qbo_cost_of_labour_account_id,
          qbo_cost_of_materials_account_id,
          qbo_labour_expense_reduction_account_id,
          qbo_overhead_cogs_account_id,
          qbo_purchase_tax_code_id
        } = req.body;
  
  try {
    console.log('Saving account mapping for company');
    // Validate required fields
    if (!qbo_inventory_account_id || !qbo_ap_account_id) {
      return res.status(400).json({ error: 'Inventory and AP account mappings are required' });
    }

    const companyId = await resolveQboCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    console.log(`Using company_id: ${companyId}`);
    
    // Upsert mapping
    const result = await pool.query(
      `INSERT INTO qbo_account_mapping (
        company_id, 
        qbo_inventory_account_id, 
        qbo_ap_account_id, 
        qbo_supply_expense_account_id,
        qbo_sales_account_id,
        qbo_labour_sales_account_id,
        qbo_ar_account_id,
        qbo_cogs_account_id,
        qbo_cost_of_labour_account_id,
        qbo_cost_of_materials_account_id,
        qbo_labour_expense_reduction_account_id,
        qbo_overhead_cogs_account_id,
        qbo_purchase_tax_code_id
      )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (company_id) DO UPDATE SET
        qbo_inventory_account_id = EXCLUDED.qbo_inventory_account_id,
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
        qbo_purchase_tax_code_id = EXCLUDED.qbo_purchase_tax_code_id,
        updated_at = NOW()
        RETURNING *`,
        [companyId, qbo_inventory_account_id, qbo_ap_account_id, qbo_supply_expense_account_id, qbo_sales_account_id, qbo_labour_sales_account_id, qbo_ar_account_id, qbo_cogs_account_id, qbo_cost_of_labour_account_id, qbo_cost_of_materials_account_id, qbo_labour_expense_reduction_account_id, qbo_overhead_cogs_account_id, qbo_purchase_tax_code_id]
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
    const companyId = await resolveQboCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    console.log('Testing QBO connection for company_id:', companyId);
    
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      console.log('No QBO connection found for company_id:', companyId);
      return res.json({ connected: false, message: 'No QuickBooks connection found' });
    }

    let accessContext;
    try {
      accessContext = await ensureFreshQboAccess(pool, qboResult.rows[0], companyId);
    } catch (refreshError) {
      console.error('Error refreshing QBO token:', refreshError instanceof Error ? refreshError.message : String(refreshError));
      return res.json({
        connected: false,
        message: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.'
      });
    }

    if (accessContext.expiresAt < new Date()) {
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
      expiresAt: accessContext.expiresAt
    });

  } catch (error) {
    console.error('Error testing QBO connection:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to test QuickBooks connection' });
  }
});

// Disconnect QBO and revoke refresh token
router.post('/disconnect', async (req, res) => {
  try {
    const companyId = await resolveQboCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    if (qboResult.rows.length === 0) {
      return res.json({ success: true, message: 'QuickBooks connection already removed' });
    }

    let refreshToken = await decryptQboValue(qboResult.rows[0].refresh_token);
    try {
      await revokeQboRefreshToken(refreshToken);
    } catch (revokeError) {
      console.error('Error revoking QBO token:', revokeError instanceof Error ? revokeError.message : String(revokeError));
    } finally {
      refreshToken = '';
    }

    await pool.query('DELETE FROM qbo_connection WHERE company_id = $1', [companyId]);

    res.json({ success: true, message: 'QuickBooks disconnected' });
  } catch (error) {
    console.error('Error disconnecting QuickBooks:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to disconnect QuickBooks' });
  }
});

export default router; 
