import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

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
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching business profile:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      telephone_number,
      email,
      business_number
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
      logoUrl = `/uploads/${req.file.filename}`;
    } else if (req.file) {
      logoUrl = `/uploads/${req.file.filename}`;
    }

    if (existingProfile.rows.length === 0) {
      // Create new profile
      const result = await client.query(
        `INSERT INTO business_profile (
          business_name, street_address, city, province, country,
          telephone_number, email, business_number, logo_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          business_name,
          street_address,
          city,
          province,
          country,
          telephone_number,
          email,
          business_number,
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
          telephone_number = $6,
          email = $7,
          business_number = $8,
          logo_url = $9
        WHERE id = $10 RETURNING *`,
        [
          business_name,
          street_address,
          city,
          province,
          country,
          telephone_number,
          email,
          business_number,
          logoUrl,
          existingProfile.rows[0].id
        ]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating business profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router; 