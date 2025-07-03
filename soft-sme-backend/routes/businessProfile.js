const express = require('express');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');

const router = express.Router();

// Create a new pool instance
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
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
router.get('/', async (req, res) => {
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

// Create or update business profile
router.post('/', upload.single('logo'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const {
      businessName,
      streetAddress,
      city,
      province,
      country,
      telephoneNumber,
      email,
      businessNumber,
      postalCode
    } = req.body;

    // Check if profile exists
    const existingProfile = await client.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    
    let logoUrl = existingProfile.rows[0]?.logo_url;
    if (req.file) {
      logoUrl = `/uploads/${req.file.filename}`;
    }

    if (existingProfile.rows.length === 0) {
      // Create new profile
      const result = await client.query(
        `INSERT INTO business_profile (
          business_name, street_address, city, province, country,
          telephone_number, email, business_number, logo_url, postal_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          businessName,
          streetAddress,
          city,
          province,
          country,
          telephoneNumber,
          email,
          businessNumber,
          logoUrl,
          postalCode
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
          logo_url = COALESCE($9, logo_url),
          postal_code = COALESCE($10, postal_code)
        WHERE id = $11 RETURNING *`,
        [
          businessName,
          streetAddress,
          city,
          province,
          country,
          telephoneNumber,
          email,
          businessNumber,
          logoUrl,
          postalCode,
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

module.exports = router; 