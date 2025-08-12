import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

// Helper function to normalize logo URL
const normalizeLogoUrl = (logoUrl: string | null): string | null => {
  if (!logoUrl) return null;
  
  // If it's already a relative path starting with /uploads/, return as is
  if (logoUrl.startsWith('/uploads/')) {
    return logoUrl;
  }
  
  // If it's a Windows path, extract the filename and convert to relative path
  if (logoUrl.includes('\\') || logoUrl.includes(':/') || logoUrl.includes(':\\')) {
    const filename = logoUrl.split(/[\\\/]/).pop();
    return filename ? `/uploads/${filename}` : null;
  }
  
  // If it's just a filename, add the /uploads/ prefix
  if (!logoUrl.startsWith('/') && !logoUrl.startsWith('http')) {
    return `/uploads/${logoUrl}`;
  }
  
  // If it's a full URL, return as is
  return logoUrl;
};

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads');
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
    }
  }
});

// Get business profile
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business profile not found' });
    }
    
    // Normalize the logo URL before returning
    const profile = result.rows[0];
    profile.logo_url = normalizeLogoUrl(profile.logo_url);
    
    res.json(profile);
  } catch (error: any) {
    console.error('Error fetching business profile:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete logo endpoint
router.delete('/logo', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get current profile
    const result = await client.query('SELECT logo_url FROM business_profile ORDER BY id DESC LIMIT 1');
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business profile not found' });
    }

    const logoUrl = result.rows[0].logo_url;
    
    if (logoUrl) {
      // Delete the file from filesystem
      const logoPath = path.join(__dirname, '../../', logoUrl);
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
      }

      // Update database to remove logo_url
      await client.query(
        'UPDATE business_profile SET logo_url = NULL WHERE id = $1',
        [result.rows[0].id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Logo deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Create or update business profile
router.post('/', authMiddleware, upload.single('logo'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const {
      business_name,
      street_address,
      city,
      province,
      country,
      postal_code,
      telephone_number,
      email,
      business_number,
      website
    } = req.body;

    // Check if profile exists
    const existingProfile = await client.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    
    let logoUrl = existingProfile.rows[0]?.logo_url;
    
    // If a new logo is uploaded, delete the old one
    if (req.file && existingProfile.rows[0]?.logo_url) {
      const oldLogoPath = path.join(__dirname, '../../', existingProfile.rows[0].logo_url);
      if (fs.existsSync(oldLogoPath)) {
        fs.unlinkSync(oldLogoPath);
      }
      logoUrl = normalizeLogoUrl(`/uploads/${req.file.filename}`);
    } else if (req.file) {
      logoUrl = normalizeLogoUrl(`/uploads/${req.file.filename}`);
    } else if (existingProfile.rows[0]?.logo_url) {
      // Normalize existing logo URL
      logoUrl = normalizeLogoUrl(existingProfile.rows[0].logo_url);
    }

    if (existingProfile.rows.length === 0) {
      // Create new profile
      const result = await client.query(
        `INSERT INTO business_profile (
          business_name, street_address, city, province, country, postal_code,
          telephone_number, email, business_number, website, logo_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          business_name,
          street_address,
          city,
          province,
          country,
          postal_code,
          telephone_number,
          email,
          business_number,
          website,
          logoUrl
        ]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } else {
      // Update existing profile
      const result = await client.query(
        `UPDATE business_profile SET
          business_name = $1,
          street_address = $2,
          city = $3,
          province = $4,
          country = $5,
          postal_code = $6,
          telephone_number = $7,
          email = $8,
          business_number = $9,
          website = $10,
          logo_url = $11
        WHERE id = $12 RETURNING *`,
        [
          business_name,
          street_address,
          city,
          province,
          country,
          postal_code,
          telephone_number,
          email,
          business_number,
          website,
          logoUrl,
          existingProfile.rows[0].id
        ]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    }
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating business profile:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Database check endpoint for debugging
router.get('/db-check', async (req, res) => {
  try {
    // Check if business_profile table exists and has postal_code column
    const tableCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'business_profile' 
      ORDER BY ordinal_position
    `);
    
    res.json({
      tableExists: tableCheck.rows.length > 0,
      columns: tableCheck.rows,
      hasPostalCode: tableCheck.rows.some(col => col.column_name === 'postal_code')
    });
  } catch (error: any) {
    console.error('Database check error:', error);
    res.status(500).json({ 
      error: 'Database check failed',
      details: error.message
    });
  }
});

export default router; 