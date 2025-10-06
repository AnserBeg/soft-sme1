import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import authRouter from './routes/authRoutes';
import { authMiddleware } from './middleware/authMiddleware';
import businessProfileRouter from './routes/businessProfile';
import customerRouter from './routes/customerRoutes';
import productRouter from './routes/productRoutes';
import purchaseHistoryRouter from './routes/purchaseHistoryRoutes';
import vendorRouter from './routes/vendorRoutes';
import inventoryRouter from './routes/inventoryRoutes';
import categoryRouter from './routes/categoryRoutes';
import quoteRouter from './routes/quoteRoutes';
import salesOrderRouter from './routes/salesOrderRoutes';
import purchaseOrderRouter from './routes/purchaseOrderRoutes';
import employeeRouter from './routes/employeeRoutes';
import marginScheduleRouter from './routes/marginScheduleRoutes';
import timeTrackingRouter from './routes/timeTrackingRoutes';
import leaveManagementRouter from './routes/leaveManagementRoutes';
import globalSettingsRouter from './routes/globalSettingsRoutes';
import attendanceRouter from './routes/attendanceRoutes';
import aiAssistantRouter from './routes/aiAssistantRoutes';
import emailRouter from './routes/emailRoutes';
import profileDocumentRouter from './routes/profileDocumentRoutes';
import taskRouter from './routes/taskRoutes';
import messagingRouter from './routes/messagingRoutes';

import chatRouter from './routes/chatRoutes';

// Load environment variables from backend-local .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Enable compression for better performance
app.use(compression());

// Set keep-alive headers for better connection reuse
app.use((req, res, next) => {
  res.set('Connection', 'keep-alive');
  res.set('Keep-Alive', 'timeout=5, max=1000');
  next();
});

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000', // local dev
  'http://localhost:5173', // Vite dev server
  'http://localhost:8080', // allow dev server
  'https://mobile.phoenixtrailers.ca', // mobile app tunnel
  'https://clockwise-mobile.phoenixtrailers.ca', // alternative mobile tunnel
  process.env.CORS_ORIGIN, // production frontend (e.g., https://softsme.phoenixtrailers.ca)
].filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    console.log('CORS check for origin:', origin);
    
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) {
      console.log('No origin - allowing request');
      return callback(null, true);
    }

    // Allow any Cloudflare temporary tunnel domain
    if (origin.includes('trycloudflare.com')) {
      console.log('Cloudflare tunnel domain - allowing request');
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      console.log('Origin in allowed list - allowing request');
      return callback(null, true);
    }
    
    console.log('Origin not allowed - blocking request');
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'x-device-id',
    'x-timezone',
    'X-Timezone',
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Explicitly handle preflight for all routes
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Health check endpoint for connection warmup
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Health check endpoint for AWS deployment
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Add detailed request logging middleware (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log('=== Incoming Request ===');
    console.log(`Method: ${req.method}`);
    console.log(`Path: ${req.path}`);
    console.log(`Headers:`, req.headers);
    console.log('======================');
    next();
  });
}

// Serve uploads directory as static files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Routes
app.use('/api/auth', authRouter);
console.log('Registered auth routes at /api/auth');

// Protected routes
// Business profile API is available at /api/business-profile
app.use('/api/business-profile', authMiddleware, businessProfileRouter);
console.log('Registered business profile routes');

app.use('/api/customers', authMiddleware, customerRouter);
console.log('Registered customer routes');

app.use('/api/products', authMiddleware, productRouter);
console.log('Registered product routes');

app.use('/api/purchase-history', authMiddleware, purchaseHistoryRouter);
console.log('Registered purchase history routes');

app.use('/api/margin-schedule', authMiddleware, marginScheduleRouter);
console.log('Registered margin schedule routes');

app.use('/api/vendors', authMiddleware, vendorRouter);
console.log('Registered vendor routes');

app.use('/api/inventory', authMiddleware, inventoryRouter);
console.log('Registered inventory routes at /api/inventory');

app.use('/api/categories', authMiddleware, categoryRouter);
console.log('Registered category routes at /api/categories');

app.use('/api/quotes', authMiddleware, quoteRouter);
console.log('Registered quote routes');

app.use('/api/sales-orders', authMiddleware, salesOrderRouter);
console.log('Registered sales order routes');

app.use('/api/purchase-orders', authMiddleware, purchaseOrderRouter);
console.log('Registered purchase order routes');

app.use('/api/employees', authMiddleware, employeeRouter);
console.log('Registered employee routes');

app.use('/api/time-tracking', authMiddleware, timeTrackingRouter);
console.log('Registered time tracking routes');

app.use('/api/leave-management', authMiddleware, leaveManagementRouter);
console.log('Registered leave management routes');

app.use('/api/attendance', authMiddleware, attendanceRouter);
console.log('Registered attendance routes');

app.use('/api/profile-documents', profileDocumentRouter);
console.log('Registered profile document routes');

app.use('/api/messaging', authMiddleware, messagingRouter);
console.log('Registered messaging routes');

app.use('/api/settings', authMiddleware, globalSettingsRouter);
console.log('Registered global settings routes');

app.use('/api/chat', authMiddleware, chatRouter);
console.log('Registered chat routes');

app.use('/api/ai-assistant', aiAssistantRouter);
console.log('Registered AI assistant routes');

app.use('/api/email', authMiddleware, emailRouter);
console.log('Registered email routes');

app.use('/api/tasks', authMiddleware, taskRouter);
console.log('Registered task routes');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error handling middleware:', err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

export default app; 