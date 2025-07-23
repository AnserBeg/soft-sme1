import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from 'cookie-parser';
import authRouter from './routes/authRoutes';
import { authMiddleware } from './middleware/authMiddleware';
import businessProfileRouter from './routes/businessProfile';
import customerRouter from './routes/customerRoutes';
import productRouter from './routes/productRoutes';
import purchaseHistoryRouter from './routes/purchaseHistoryRoutes';
import vendorRouter from './routes/vendorRoutes';
import inventoryRouter from './routes/inventoryRoutes';
import quoteRouter from './routes/quoteRoutes';
import salesOrderRouter from './routes/salesOrderRoutes';
import purchaseOrderRouter from './routes/purchaseOrderRoutes';
import employeeRouter from './routes/employeeRoutes';
import marginScheduleRouter from './routes/marginScheduleRoutes';
import timeTrackingRouter from './routes/timeTrackingRoutes';
import globalSettingsRouter from './routes/globalSettingsRoutes';
import attendanceRouter from './routes/attendanceRoutes';

// Load environment variables
dotenv.config();

const app = express();

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000', // local dev
  'http://localhost:5173', // Vite dev server
  'http://localhost:8080', // allow dev server
  process.env.CORS_ORIGIN, // production frontend
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

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

app.use('/api/attendance', authMiddleware, attendanceRouter);
console.log('Registered attendance routes');

app.use('/api/settings', authMiddleware, globalSettingsRouter);
console.log('Registered global settings routes');

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