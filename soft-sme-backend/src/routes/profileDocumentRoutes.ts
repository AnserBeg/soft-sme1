import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { authMiddleware, adminAuth } from '../middleware/authMiddleware';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/profile-documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random string
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `doc-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document and image types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, images, and text files are allowed.'));
    }
  }
});

// Get all profiles (admin view)
router.get('/profiles', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await pool.query(`
      SELECT id, name, email, created_at
      FROM profiles
      ORDER BY name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching profiles:', error);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// Get all documents (admin view)
router.get('/all', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const result = await pool.query(`
      SELECT 
        pd.id,
        pd.filename,
        pd.original_filename,
        pd.file_size,
        pd.mime_type,
        pd.uploaded_by,
        pd.created_at,
        u.username as uploaded_by_name,
        COALESCE(dpv.profile_id, pd.profile_id) as profile_id,
        p.name as profile_name,
        CASE WHEN pdr.id IS NOT NULL THEN true ELSE false END as has_read,
        pdr.read_at
      FROM profile_documents pd
      LEFT JOIN document_profile_visibility dpv ON pd.id = dpv.document_id
      LEFT JOIN profiles p ON COALESCE(dpv.profile_id, pd.profile_id) = p.id
      LEFT JOIN users u ON pd.uploaded_by = u.id
      LEFT JOIN profile_document_reads pdr ON pd.id = pdr.document_id AND pdr.profile_id = COALESCE(dpv.profile_id, pd.profile_id)
      WHERE p.id IS NOT NULL
      ORDER BY pd.created_at DESC, p.name
    `);
    
    console.log(`Admin fetching all documents: ${result.rows.length} document-profile combinations found`);
    console.log('Admin view document IDs:', [...new Set(result.rows.map(r => r.id))]);
    
    // Debug: Log the structure of the first few rows
    if (result.rows.length > 0) {
      console.log('Sample document-profile combinations:', JSON.stringify(result.rows.slice(0, 3), null, 2));
    }
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all documents:', error);
    res.status(500).json({ error: 'Failed to fetch all documents' });
  }
});

// Get documents for a specific profile (admin view)
router.get('/profile/:profileId', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { profileId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        pd.id,
        pd.filename,
        pd.original_filename,
        pd.file_size,
        pd.mime_type,
        pd.uploaded_by,
        pd.created_at,
        u.username as uploaded_by_name,
        ARRAY_AGG(DISTINCT dpv.profile_id ORDER BY dpv.profile_id) as visible_to_profiles,
        json_object_agg(
          dpv.profile_id, 
          CASE WHEN pdr.id IS NOT NULL THEN true ELSE false END
        ) as profile_read_status
      FROM profile_documents pd
      JOIN document_profile_visibility dpv ON pd.id = dpv.document_id
      LEFT JOIN users u ON pd.uploaded_by = u.id
      LEFT JOIN profile_document_reads pdr ON pd.id = pdr.document_id AND pdr.profile_id = dpv.profile_id
      WHERE dpv.profile_id = $1
      GROUP BY pd.id, pd.filename, pd.original_filename, pd.file_size, pd.mime_type, pd.uploaded_by, pd.created_at, u.username
      ORDER BY pd.created_at DESC
    `, [profileId]);
    
    console.log(`Admin fetching documents for profile ${profileId}: ${result.rows.length} documents found`);
    console.log('Admin view document IDs:', result.rows.map(r => r.id));
    
    // Debug: Log the structure of the first document
    if (result.rows.length > 0) {
      console.log('Profile view sample document structure:', JSON.stringify(result.rows[0], null, 2));
    }
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching profile documents:', error);
    res.status(500).json({ error: 'Failed to fetch profile documents' });
  }
});

// Get documents for current user's accessible profiles (user view)
router.get('/user-documents', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    console.log(`Fetching documents for user ID: ${userId}`);
    
    // Add cache-busting headers for mobile apps
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // First check what profiles this user has access to
    const accessResult = await pool.query(`
      SELECT upa.profile_id, p.name as profile_name, upa.is_active
      FROM user_profile_access upa
      JOIN profiles p ON upa.profile_id = p.id
      WHERE upa.user_id = $1
    `, [userId]);
    
    console.log(`User ${userId} has access to ${accessResult.rows.length} profiles:`, accessResult.rows.map(r => `${r.profile_name} (ID: ${r.profile_id}, Active: ${r.is_active})`));
    
    // Get all documents visible to profiles this user has access to
    const result = await pool.query(`
      SELECT DISTINCT
        pd.id,
        pd.original_filename,
        pd.file_size,
        pd.mime_type,
        pd.created_at,
        p.name as profile_name,
        p.id as profile_id,
        CASE WHEN pdr.id IS NOT NULL THEN true ELSE false END as is_read,
        pdr.read_at
      FROM profile_documents pd
      JOIN document_profile_visibility dpv ON pd.id = dpv.document_id
      JOIN profiles p ON dpv.profile_id = p.id
      JOIN user_profile_access upa ON p.id = upa.profile_id
      LEFT JOIN profile_document_reads pdr ON pd.id = pdr.document_id AND pdr.profile_id = p.id
      WHERE upa.user_id = $1 AND upa.is_active = true
      ORDER BY pd.created_at DESC
    `, [userId]);
    
    console.log(`User ${userId} documents query returned ${result.rows.length} documents`);
    console.log('Document IDs:', result.rows.map(r => r.id));
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user documents:', error);
    res.status(500).json({ error: 'Failed to fetch user documents' });
  }
});

// Upload document for multiple profiles (admin only)
router.post('/upload', upload.single('document'), async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { customName, visibleToProfiles } = req.body;
    const userId = req.user?.id;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    let profileIds: number[];
    try {
      profileIds = JSON.parse(visibleToProfiles);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid profile IDs format' });
    }
    
    if (!profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
      return res.status(400).json({ error: 'At least one profile must be selected' });
    }
    
    // Verify all profiles exist
    const profileResult = await pool.query(`
      SELECT id, name FROM profiles WHERE id = ANY($1)
    `, [profileIds]);
    
    if (profileResult.rows.length !== profileIds.length) {
      return res.status(404).json({ error: 'One or more profiles not found' });
    }
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Insert document (use first profile as primary profile for backward compatibility)
      const documentResult = await client.query(`
        INSERT INTO profile_documents (
          profile_id, filename, original_filename, file_path, file_size, mime_type, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, original_filename, file_size, mime_type, created_at
      `, [
        profileIds[0], // Primary profile
        req.file.filename,
        customName || req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        userId
      ]);
      
      const documentId = documentResult.rows[0].id;
      
      // Insert visibility records for all selected profiles
      for (const profileId of profileIds) {
        await client.query(`
          INSERT INTO document_profile_visibility (document_id, profile_id)
          VALUES ($1, $2)
          ON CONFLICT (document_id, profile_id) DO NOTHING
        `, [documentId, profileId]);
      }
      
      await client.query('COMMIT');
      
      console.log(`Document uploaded successfully: ID ${documentId}, Profiles: ${profileIds.join(', ')}, Filename: ${documentResult.rows[0].original_filename}`);
      
      res.json({
        success: true,
        document: documentResult.rows[0],
        visibleToProfiles: profileIds,
        message: 'Document uploaded successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Mark document as read
router.post('/:documentId/mark-read', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    const userId = req.user?.id;
    
    // Check if document exists and user has access to it through any profile
    const documentResult = await pool.query(`
      SELECT DISTINCT pd.id, dpv.profile_id, p.name as profile_name
      FROM profile_documents pd
      JOIN document_profile_visibility dpv ON pd.id = dpv.document_id
      JOIN profiles p ON dpv.profile_id = p.id
      JOIN user_profile_access upa ON p.id = upa.profile_id
      WHERE pd.id = $1 AND upa.user_id = $2 AND upa.is_active = true
    `, [documentId, userId]);
    
    if (documentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }
    
    // Mark as read for all profiles the user has access to
    for (const row of documentResult.rows) {
      await pool.query(`
        INSERT INTO profile_document_reads (profile_id, document_id)
        VALUES ($1, $2)
        ON CONFLICT (profile_id, document_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP
      `, [row.profile_id, documentId]);
    }
    
    res.json({ success: true, message: 'Document marked as read' });
    
  } catch (error) {
    console.error('Error marking document as read:', error);
    res.status(500).json({ error: 'Failed to mark document as read' });
  }
});

// Serve document file
router.get('/file/:documentId', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    const userId = req.user?.id;
    
    console.log(`File download request - Document ID: ${documentId}, User ID: ${userId}`);
    
    // Get document info and check access through visibility table (with fallback for old documents)
    const documentResult = await pool.query(`
      SELECT DISTINCT pd.filename, pd.original_filename, pd.file_path, pd.mime_type, COALESCE(dpv.profile_id, pd.profile_id) as profile_id, p.name as profile_name
      FROM profile_documents pd
      LEFT JOIN document_profile_visibility dpv ON pd.id = dpv.document_id
      LEFT JOIN profiles p ON COALESCE(dpv.profile_id, pd.profile_id) = p.id
      LEFT JOIN user_profile_access upa ON p.id = upa.profile_id
      WHERE pd.id = $1 AND upa.user_id = $2 AND upa.is_active = true
    `, [documentId, userId]);
    
    console.log(`Document query result: ${documentResult.rows.length} rows found`);
    if (documentResult.rows.length > 0) {
      console.log('Document details:', documentResult.rows[0]);
    }
    
    if (documentResult.rows.length === 0) {
      console.log(`No access found for document ${documentId} and user ${userId}`);
      return res.status(404).json({ error: 'Document not found or access denied' });
    }
    
    const document = documentResult.rows[0];
    const filePath = document.file_path;
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }
    
    // Set appropriate headers
    console.log(`Serving document ${documentId}: ${document.original_filename}`);
    console.log(`MIME type: ${document.mime_type}`);
    console.log(`File path: ${filePath}`);
    
    res.setHeader('Content-Type', document.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${document.original_filename}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Error serving document:', error);
    res.status(500).json({ error: 'Failed to serve document' });
  }
});

// Delete document (admin only)
router.delete('/:documentId', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { documentId } = req.params;
    console.log(`Attempting to delete document ID: ${documentId}`);
    
    // Get document info
    const documentResult = await pool.query(`
      SELECT file_path, original_filename FROM profile_documents WHERE id = $1
    `, [documentId]);
    
    console.log(`Document lookup result: ${documentResult.rows.length} rows found for ID ${documentId}`);
    
    if (documentResult.rows.length === 0) {
      console.log(`Document ID ${documentId} not found in database`);
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const filePath = documentResult.rows[0].file_path;
    
    // Delete from database
    const deleteResult = await pool.query(`
      DELETE FROM profile_documents WHERE id = $1
    `, [documentId]);
    
    console.log(`Document deletion result: ${deleteResult.rowCount} rows affected for document ID ${documentId}`);
    
    // Delete file from filesystem
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`File deleted from filesystem: ${filePath}`);
    } else {
      console.log(`File not found on filesystem: ${filePath}`);
    }
    
    res.json({ success: true, message: 'Document deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Get read statistics for a document (admin only)
router.get('/:documentId/stats', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { documentId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        p.id as profile_id,
        p.name as profile_name,
        p.email as profile_email,
        pdr.read_at,
        CASE WHEN pdr.id IS NOT NULL THEN true ELSE false END as has_read
      FROM document_profile_visibility dpv
      JOIN profiles p ON dpv.profile_id = p.id
      LEFT JOIN profile_document_reads pdr ON dpv.document_id = pdr.document_id AND dpv.profile_id = pdr.profile_id
      WHERE dpv.document_id = $1
      ORDER BY p.name
    `, [documentId]);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching document statistics:', error);
    res.status(500).json({ error: 'Failed to fetch document statistics' });
  }
});

// Debug endpoint to check database state (admin only)
router.get('/debug/state', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    // Get all documents
    const documentsResult = await pool.query(`
      SELECT pd.id, pd.original_filename, pd.profile_id, p.name as profile_name, pd.created_at
      FROM profile_documents pd
      JOIN profiles p ON pd.profile_id = p.id
      ORDER BY pd.created_at DESC
    `);
    
    // Get all user profile access
    const accessResult = await pool.query(`
      SELECT upa.user_id, upa.profile_id, p.name as profile_name, upa.is_active, u.username
      FROM user_profile_access upa
      JOIN profiles p ON upa.profile_id = p.id
      JOIN users u ON upa.user_id = u.id
      ORDER BY upa.user_id, upa.profile_id
    `);
    
    res.json({
      documents: documentsResult.rows,
      userProfileAccess: accessResult.rows,
      summary: {
        totalDocuments: documentsResult.rows.length,
        totalUserAccess: accessResult.rows.length
      }
    });
    
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({ error: 'Failed to get debug info' });
  }
});

export default router;