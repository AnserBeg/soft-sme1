import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { pool } from './db';
import { authMiddleware } from './middleware/authMiddleware';

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

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
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

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    process.exit(1);
  }
  console.log('Database connected successfully');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 