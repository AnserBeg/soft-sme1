import express from 'express';
import axios from 'axios';
import { pool } from '../db';

const router = express.Router();

// QuickBooks OAuth2 URLs
const AUTHORIZATION_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// Step 1: Redirect to QBO OAuth2 authorization URL
router.get('/auth', (req, res) => {
  // Debug logging
  console.log('Environment variables:', {
    QBO_CLIENT_ID: process.env.QBO_CLIENT_ID,
    QBO_REDIRECT_URI: process.env.QBO_REDIRECT_URI,
    AUTHORIZATION_URL: AUTHORIZATION_URL
  });

  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI || '';
  const scope = 'com.intuit.quickbooks.accounting';
  const state = 'secureRandomState'; // Replace with a real random state in production

  const url = `${AUTHORIZATION_URL}?client_id=${clientId}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}`;

  console.log('Generated OAuth URL:', url);
  res.redirect(url);
});

// Step 2: Handle OAuth2 callback and token exchange
router.get('/callback', async (req, res) => {
  const { code, realmId, state } = req.query;
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI || '';

  if (!code || !realmId) {
    // Redirect to frontend with error
    return res.redirect(`http://localhost:3000/business-profile?qbo_status=error&qbo_message=Missing+authorization+code+or+realm+ID`);
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }, {
      auth: {
        username: clientId!,
        password: clientSecret!
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // For now, use company_id = 9 (your actual company ID)
    // TODO: Get this from the user session or pass it in the state parameter
    const companyId = 9;
    
    console.log('Storing QBO tokens for company_id:', companyId);
    console.log('Realm ID:', realmId);
    console.log('Access token length:', access_token?.length || 0);

    // Store tokens in database
    await pool.query(
      `INSERT INTO qbo_connection (company_id, realm_id, access_token, refresh_token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         realm_id = EXCLUDED.realm_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [companyId, realmId, access_token, refresh_token, new Date(Date.now() + expires_in * 1000)]
    );

    // Redirect to frontend with success
    res.redirect(`http://localhost:3000/business-profile?qbo_status=success&qbo_message=Successfully+connected+to+QuickBooks+Online`);
  } catch (error) {
    console.error('Error exchanging authorization code for tokens:', error);
    // Redirect to frontend with error
    res.redirect(`http://localhost:3000/business-profile?qbo_status=error&qbo_message=Failed+to+complete+QuickBooks+connection`);
  }
});

// Check connection status
router.get('/status', async (req, res) => {
  try {
    // For now, use company_id = 9 (your actual company ID)
    // TODO: Get this from the user session
    const companyId = 9;
    
    console.log('Checking QBO connection status for company_id:', companyId);
    
    const result = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
    console.log('QBO connection query result:', result.rows.length, 'rows found');
    
    if (result.rows.length === 0) {
      console.log('No QBO connection found for company_id:', companyId);
      return res.json({ connected: false });
    }
    
    const connection = result.rows[0];
    const isExpired = new Date(connection.expires_at) < new Date();
    
    console.log('QBO connection found:', {
      companyId: connection.company_id,
      realmId: connection.realm_id,
      isExpired,
      expiresAt: connection.expires_at
    });
    
    res.json({
      connected: true,
      realmId: connection.realm_id,
      expiresAt: connection.expires_at,
      isExpired
    });
  } catch (error) {
    console.error('Error checking QBO connection status:', error);
    res.status(500).json({ error: 'Failed to check connection status' });
  }
});

export default router; 