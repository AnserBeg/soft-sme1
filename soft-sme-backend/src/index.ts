import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { pool } from './db';
import { authMiddleware } from './middleware/authMiddleware';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/authRoutes';
import businessProfileRoutes from './routes/businessProfile';
import customerRoutes from './routes/customerRoutes';
import productRoutes from './routes/productRoutes';
import purchaseHistoryRoutes from './routes/purchaseHistoryRoutes';
import marginScheduleRoutes from './routes/marginScheduleRoutes';
import vendorRoutes from './routes/vendorRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import quoteRoutes from './routes/quoteRoutes';
import salesOrderRoutes from './routes/salesOrderRoutes';
import purchaseOrderRoutes from './routes/purchaseOrderRoutes';
import employeeRoutes from './routes/employeeRoutes';
import timeTrackingRoutes from './routes/timeTrackingRoutes';
import globalSettingsRouter from './routes/globalSettingsRoutes';
import backupRoutes from './routes/backupRoutes';
import attendanceRouter from './routes/attendanceRoutes';
import qboAuthRoutes from './routes/qboAuthRoutes';
import qboAccountRoutes from './routes/qboAccountRoutes';
import qboExportRoutes from './routes/qboExportRoutes';
import overheadRoutes from './routes/overheadRoutes';
import aiAssistantRoutes from './routes/aiAssistantRoutes';
import emailRoutes from './routes/emailRoutes';
import aiAssistantService from './services/aiAssistantService';

// Add error handling around chatRouter import
let chatRouter: any;
try {
  console.log('[Index] Attempting to import chatRouter...');
  const chatModule = require('./routes/chatRoutes');
  chatRouter = chatModule.default;
  console.log('[Index] chatRouter imported successfully');
} catch (error) {
  console.error('[Index] Error importing chatRouter:', error);
  throw error;
}

// Subagent analytics removed - simplified AI implementation

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000', // local dev
  'http://localhost:5173', // Vite dev server
  'http://localhost:8080', // allow dev server
  process.env.CORS_ORIGIN, // production frontend
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-device-id'],
}));
app.use(bodyParser.json());
app.use('/uploads', express.static('uploads'));

// Public routes
app.use('/api/auth', authRoutes);
console.log('Registered auth routes at /api/auth');

// Protected routes
app.use('/api/business-profile', businessProfileRoutes);
console.log('Registered business profile routes');

app.use('/api/customers', authMiddleware, customerRoutes);
console.log('Registered customer routes');

app.use('/api/products', authMiddleware, productRoutes);
console.log('Registered product routes');

app.use('/api/purchase-history', authMiddleware, purchaseHistoryRoutes);
console.log('Registered purchase history routes');

app.use('/api/margin-schedule', authMiddleware, marginScheduleRoutes);
console.log('Registered margin schedule routes');

app.use('/api/vendors', authMiddleware, vendorRoutes);
console.log('Registered vendor routes');

app.use('/api/inventory', authMiddleware, inventoryRoutes);
console.log('Registered inventory routes');

app.use('/api/quotes', authMiddleware, quoteRoutes);
console.log('Registered quote routes');

app.use('/api/sales-orders', authMiddleware, salesOrderRoutes);
console.log('Registered sales order routes');

app.use('/api/purchase-orders', authMiddleware, purchaseOrderRoutes);
console.log('Registered purchase order routes');

app.use('/api/employees', authMiddleware, employeeRoutes);
console.log('Registered employee routes');

app.use('/api/time-tracking', authMiddleware, timeTrackingRoutes);
console.log('Registered time tracking routes');

app.use('/api/attendance', authMiddleware, attendanceRouter);
console.log('Registered attendance routes');

app.use('/api/settings', authMiddleware, globalSettingsRouter);
console.log('Registered global settings routes');

app.use('/api/backup', authMiddleware, backupRoutes);
console.log('Registered backup routes');

app.use('/api/qbo', qboAuthRoutes);
console.log('Registered QBO auth routes');

app.use('/api/qbo-accounts', authMiddleware, qboAccountRoutes);
console.log('Registered QBO account routes');

app.use('/api/qbo-export', authMiddleware, qboExportRoutes);
console.log('Registered QBO export routes');

app.use('/api/overhead', authMiddleware, overheadRoutes);
console.log('Registered overhead routes');

// AI Assistant routes
app.use('/api/ai-assistant', aiAssistantRoutes);
console.log('Registered AI assistant routes');

// Email routes
app.use('/api/email', authMiddleware, emailRoutes);
console.log('Registered email routes');

// Chat routes with error handling
try {
  console.log('Attempting to register chat routes...');
  app.use('/api/chat', authMiddleware, chatRouter);
  console.log('Registered chat routes');
} catch (error) {
  console.error('Error registering chat routes:', error);
}

// Subagent analytics routes removed - simplified AI implementation

// Database check endpoint
app.get('/api/db-check', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    res.json({
      success: true,
      tables: result.rows.map(row => row.table_name),
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
console.log('Registered database check route at /api/db-check');

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    process.exit(1);
  }
  console.log('Database connected successfully');
});

app.get('/ping', (req, res) => res.send('pong'));

const server = app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Start AI agent automatically
  try {
    console.log('Starting AI Assistant...');
    await aiAssistantService.startAIAgent();
    console.log('AI Assistant started successfully');
  } catch (error) {
    console.error('Failed to start AI Assistant:', error);
    console.log('Server will continue without AI Assistant');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await aiAssistantService.stopAIAgent();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await aiAssistantService.stopAIAgent();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 