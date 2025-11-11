# Aiven - Complete Application Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Technology Stack](#technology-stack)
4. [Core Modules](#core-modules)
5. [Database Schema](#database-schema)
6. [API Documentation](#api-documentation)
7. [Frontend Components](#frontend-components)
8. [Backend Services](#backend-services)
9. [Authentication & Security](#authentication--security)
10. [Deployment](#deployment)
11. [Mobile App](#mobile-app)
12. [Desktop App](#desktop-app)
13. [Integration Features](#integration-features)
14. [Business Logic](#business-logic)
15. [Configuration](#configuration)

## System Overview

Aiven is a comprehensive business management system designed for small and medium enterprises (SMEs). It provides integrated solutions for sales, purchasing, inventory management, time tracking, and financial operations.

### Key Features
- **Multi-platform Support**: Web, Desktop (Electron), and Mobile (Capacitor)
- **Real-time Inventory Management**: Stock and supply tracking with automated reorder points
- **Sales & Purchase Management**: Complete quote-to-cash and procure-to-pay workflows
- **Time Tracking**: Employee attendance and project time tracking
- **QuickBooks Integration**: Seamless financial data synchronization
- **Multi-company Support**: Multi-tenant architecture for different business entities
- **Role-based Access Control**: Different permission levels for various user roles

### Business Modules
1. **Sales Management**: Quotes, Sales Orders, Customer Management
2. **Purchase Management**: Purchase Orders, Vendor Management, Supply Tracking
3. **Inventory Management**: Stock tracking, Parts management, Reorder automation
4. **Employee Management**: Staff records, Attendance tracking, Time sheets
5. **Financial Management**: Margin scheduling, Labour rates, Overhead management
6. **Reporting**: Time tracking reports, Sales analytics, Inventory reports

## Architecture

### System Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Desktop App   │    │   Mobile App    │    │   Web App       │
│   (Electron)    │    │   (Capacitor)   │    │   (React)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Backend API   │
                    │   (Node.js)     │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │   Database      │
                    └─────────────────┘
```

### Component Architecture
- **Frontend**: React with TypeScript, Material-UI, Vite
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Desktop**: Electron wrapper around web app
- **Mobile**: Capacitor with React Native components
- **Authentication**: JWT-based with role-based access control

## Technology Stack

### Frontend Technologies
- **React 18.2.0**: Main UI framework
- **TypeScript 5.2.2**: Type-safe development
- **Material-UI 5.15.10**: Component library
- **Vite 7.0.0**: Build tool and dev server
- **React Router 6.30.1**: Client-side routing
- **Axios 1.6.7**: HTTP client
- **React Hook Form**: Form management
- **Day.js**: Date manipulation
- **React Toastify**: Notifications

### Backend Technologies
- **Node.js**: Runtime environment
- **Express 4.18.2**: Web framework
- **TypeScript 5.3.3**: Type-safe development
- **PostgreSQL**: Primary database
- **Prisma**: Database ORM
- **JWT**: Authentication tokens
- **Multer**: File upload handling
- **PDFKit**: PDF generation
- **PapaParse**: CSV processing

### Desktop Technologies
- **Electron 36.4.0**: Desktop app framework
- **Electron Builder**: App packaging and distribution

### Mobile Technologies
- **Capacitor 7.4.2**: Mobile app framework
- **React Native components**: Mobile UI
- **Tailwind CSS**: Styling
- **Radix UI**: Component primitives

## Core Modules

### 1. Authentication & User Management
**Purpose**: Secure access control and user session management

**Key Features**:
- JWT-based authentication
- Role-based access control (Admin, Sales and Purchase, etc.)
- Multi-company support
- Session management
- Password encryption with bcrypt

**Components**:
- Login/Registration system
- User profile management
- Company registration
- Session persistence

### 2. Business Profile Management
**Purpose**: Centralized business information and settings

**Features**:
- Company details management
- Logo upload and management
- Business address and contact information
- Tax information (GST rates)
- Default settings configuration

### 3. Customer Management
**Purpose**: Complete customer relationship management

**Features**:
- Customer database with detailed profiles
- Contact information management
- Address tracking
- Customer history and analytics
- QuickBooks customer synchronization

**Data Structure**:
```typescript
interface Customer {
  customer_id: number;
  customer_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postal_code: string;
  created_at: Date;
  updated_at: Date;
}
```

### 4. Vendor Management
**Purpose**: Supplier and vendor relationship management

**Features**:
- Vendor database with contact information
- Purchase history tracking
- Vendor performance analytics
- Address and contact management
- QuickBooks vendor synchronization

### 5. Product Management
**Purpose**: Product catalog and configuration management

**Features**:
- Product database with descriptions
- Product categorization
- Pricing management
- Product specifications
- Integration with inventory system

**Products Page**:
- Dedicated page for managing product definitions
- Add new products with names and descriptions
- View all products in a searchable grid
- Export products to PDF
- Delete products
- Products serve as the foundation for inventory items

### 6. Inventory Management
**Purpose**: Comprehensive stock and supply tracking

**Features**:
- **Stock Items**: Parts and components for production
- **Supply Items**: Consumables and materials
- Real-time quantity tracking
- Automated reorder point notifications
- Cost tracking and margin calculations
- Inventory audit logging

**Adding New Parts**:
There are **multiple ways** to add new parts to the system:

1. **Through Products Page**:
   - Go to "Products" page → Click "NEW PRODUCT" button
   - Add product name and description
   - This creates the product definition

2. **Through Inventory Management Pages**:
   - **Stock Items**: Go to "Inventory" page → Click "Add New Part" → Select "stock" type
   - **Supply Items**: Go to "Supply" page → Click "Add New Part" → Select "supply" type
   - Fill in: Part Number, Description, Unit, Cost, Quantity, Reorder Point

3. **Through Purchase Order Line Items**:
   - When creating/editing a purchase order
   - Enter a part number that doesn't exist
   - System will prompt to add the new part
   - Specify part type (stock/supply) and details

4. **Through Sales Order Line Items**:
   - When creating/editing a sales order
   - Enter a part number that doesn't exist
   - System will prompt to add the new part
   - Specify part type (stock/supply) and details

**Key Concepts**:
- **Part Types**: 'stock' vs 'supply' classification
- **Quantity on Hand**: Current available inventory
- **Reorder Point**: Minimum stock level for reordering
- **Last Unit Cost**: Most recent purchase price
- **Margin Factor**: Pricing multiplier based on cost

**Data Structure**:
```typescript
interface InventoryItem {
  part_number: string;           // Primary key
  part_description: string;
  unit: string;                  // Each, cm, ft, ft^2, kg, pcs, hr, L
  last_unit_cost: number;
  quantity_on_hand: number;
  reorder_point: number;
  part_type: 'stock' | 'supply';
  created_at: Date;
  updated_at: Date;
}
```

### 7. Sales Management
**Purpose**: Complete sales process from quote to order fulfillment

#### 7.1 Quote Management
**Features**:
- Quote creation and management
- Line item configuration
- Pricing calculations with margins
- Quote status tracking
- PDF generation and export
- Quote history and analytics

#### 7.2 Sales Order Management
**Features**:
- Sales order creation from quotes
- Line item management with inventory integration
- Real-time inventory validation
- Status tracking (Open, Closed)
- PDF generation
- QuickBooks export functionality
- Parts to order tracking

**Key Workflows**:
1. **Quote Creation**: Create quote with line items and pricing
2. **Quote to Order**: Convert quote to sales order
3. **Order Processing**: Manage order fulfillment
4. **Inventory Updates**: Automatic stock reduction
5. **Parts to Order**: Track items needing procurement
6. **Order Closure**: Complete order processing

**Data Structure**:
```typescript
interface SalesOrder {
  sales_order_id: number;
  sales_order_number: string;
  customer_id: number;
  customer_name: string;
  sales_date: string;
  product_name: string;
  product_description: string;
  terms: string;
  estimated_cost: number;
  subtotal: number;
  gst_amount: number;
  total_amount: number;
  status: 'Open' | 'Closed';
  line_items: SalesOrderLineItem[];
  exported_to_qbo?: boolean;
  qbo_invoice_id?: string;
  qbo_export_date?: string;
}

interface SalesOrderLineItem {
  line_item_id?: number;
  part_number: string;
  part_description: string;
  quantity: string;
  unit: string;
  unit_price: number;
  gst: number;
  line_amount: number;
}
```

### 8. Purchase Management
**Purpose**: Complete procurement and purchasing workflow

#### 8.1 Purchase Order Management
**Features**:
- Purchase order creation and management
- Vendor selection and management
- Line item configuration
- Cost tracking and analysis
- Order status tracking
- PDF generation
- QuickBooks integration

#### 8.2 Purchase History
**Features**:
- Historical purchase tracking
- Cost analysis and reporting
- Vendor performance metrics
- Inventory cost updates
- Financial reporting integration

### 9. Margin & Pricing Management
**Purpose**: Automated pricing and margin calculations

**Features**:
- **Margin Schedule**: Cost-based pricing tiers
- **Labour Rate Management**: Global labour rate settings
- **Overhead Management**: Overhead rate configuration
- **Automatic Pricing**: Cost-based price calculations
- **Margin Analysis**: Profitability tracking

**Margin Schedule Logic**:
```typescript
interface MarginSchedule {
  cost_lower_bound: number;
  cost_upper_bound: number;
  margin_factor: number;
}

// Pricing calculation
const findMarginFactor = (cost: number): number => {
  const sortedSchedule = marginSchedule.sort((a, b) => a.cost_lower_bound - b.cost_lower_bound);
  
  for (const entry of sortedSchedule) {
    if (cost >= entry.cost_lower_bound && (cost < entry.cost_upper_bound || entry.cost_upper_bound === null)) {
      return entry.margin_factor;
    }
  }
  return 1.0; // Default margin factor
};

const calculatedUnitPrice = lastUnitCost * marginFactor;
```

### 10. Time Tracking & Attendance
**Purpose**: Employee time management and project tracking

**Features**:
- Employee attendance tracking
- Project time tracking
- Time sheet management
- Reporting and analytics
- Labour cost calculations
- Shift management

### 11. Employee Management
**Purpose**: Staff records and management

**Features**:
- Employee database
- Role and permission management
- Contact information
- Employment history
- Performance tracking

### 12. Parts to Order Management
**Purpose**: Automated procurement planning

**Features**:
- Aggregated parts ordering across sales orders
- Automatic quantity calculations
- Vendor assignment
- Order tracking
- Cost analysis

## Database Schema

### Core Tables

#### 1. Users & Authentication
```sql
-- Users table
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  access_role VARCHAR(50) NOT NULL,
  company_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  session_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id),
  session_token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 2. Business Profile
```sql
CREATE TABLE business_profile (
  profile_id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  address TEXT,
  city VARCHAR(255),
  postal_code VARCHAR(20),
  phone VARCHAR(50),
  email VARCHAR(255),
  logo_path VARCHAR(500),
  gst_number VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 3. Customers
```sql
CREATE TABLE customermaster (
  customer_id SERIAL PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(255),
  postal_code VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 4. Vendors
```sql
CREATE TABLE vendormaster (
  vendor_id SERIAL PRIMARY KEY,
  vendor_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(255),
  postal_code VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 5. Products
```sql
CREATE TABLE products (
  product_id SERIAL PRIMARY KEY,
  product_name VARCHAR(255) NOT NULL,
  product_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 6. Inventory
```sql
CREATE TABLE inventory (
  part_number VARCHAR(255) PRIMARY KEY,
  part_description TEXT NOT NULL,
  unit VARCHAR(50),
  last_unit_cost DECIMAL(10,2) DEFAULT 0,
  quantity_on_hand INTEGER DEFAULT 0,
  reorder_point INTEGER DEFAULT 0,
  part_type VARCHAR(10) NOT NULL DEFAULT 'stock' CHECK (part_type IN ('stock', 'supply')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 7. Margin Schedule
```sql
CREATE TABLE marginschedule (
  margin_id SERIAL PRIMARY KEY,
  cost_lower_bound DECIMAL(10,2) NOT NULL,
  cost_upper_bound DECIMAL(10,2),
  margin_factor DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 8. Labour Rate
```sql
CREATE TABLE labourrate (
  rate_id SERIAL PRIMARY KEY,
  labour_rate DECIMAL(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 9. Quotes
```sql
CREATE TABLE quotes (
  quote_id SERIAL PRIMARY KEY,
  quote_number VARCHAR(255) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customermaster(customer_id),
  quote_date DATE NOT NULL,
  product_name VARCHAR(255),
  product_description TEXT,
  terms TEXT,
  estimated_cost DECIMAL(10,2),
  subtotal DECIMAL(10,2),
  total_gst_amount DECIMAL(10,2),
  total_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'Draft',
  sequence_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 10. Sales Orders
```sql
CREATE TABLE salesorderhistory (
  sales_order_id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(255) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customermaster(customer_id),
  sales_date DATE NOT NULL,
  product_name VARCHAR(255),
  product_description TEXT,
  terms TEXT,
  estimated_cost DECIMAL(10,2),
  subtotal DECIMAL(10,2),
  total_gst_amount DECIMAL(10,2),
  total_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'Open',
  sequence_number INTEGER,
  exported_to_qbo BOOLEAN DEFAULT FALSE,
  qbo_invoice_id VARCHAR(255),
  qbo_export_date TIMESTAMP WITH TIME ZONE,
  qbo_export_status VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 11. Sales Order Line Items
```sql
CREATE TABLE salesorderlineitems (
  line_item_id SERIAL PRIMARY KEY,
  sales_order_id INTEGER REFERENCES salesorderhistory(sales_order_id),
  part_number VARCHAR(255),
  part_description TEXT,
  quantity_sold INTEGER,
  unit VARCHAR(50),
  unit_price DECIMAL(10,2),
  line_amount DECIMAL(10,2),
  quantity_to_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 12. Purchase Orders
```sql
CREATE TABLE purchaseorders (
  purchase_order_id SERIAL PRIMARY KEY,
  purchase_order_number VARCHAR(255) UNIQUE NOT NULL,
  vendor_id INTEGER REFERENCES vendormaster(vendor_id),
  order_date DATE NOT NULL,
  expected_delivery_date DATE,
  status VARCHAR(50) DEFAULT 'Open',
  total_amount DECIMAL(10,2),
  exported_to_qbo BOOLEAN DEFAULT FALSE,
  qbo_bill_id VARCHAR(255),
  qbo_export_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 13. Parts to Order
```sql
CREATE TABLE aggregated_parts_to_order (
  id SERIAL PRIMARY KEY,
  part_number VARCHAR(255) NOT NULL,
  part_description TEXT,
  total_quantity_needed INTEGER NOT NULL,
  unit VARCHAR(50),
  unit_price DECIMAL(10,2),
  total_line_amount DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 14. Time Tracking
```sql
CREATE TABLE time_tracking (
  tracking_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id),
  project_name VARCHAR(255),
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 15. Attendance
```sql
CREATE TABLE attendance (
  attendance_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id),
  date DATE NOT NULL,
  clock_in TIMESTAMP WITH TIME ZONE,
  clock_out TIMESTAMP WITH TIME ZONE,
  total_hours DECIMAL(5,2),
  shift_type VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## API Documentation

### Authentication Endpoints

#### POST /api/auth/login
**Purpose**: User authentication
**Request Body**:
```json
{
  "username": "string",
  "password": "string"
}
```
**Response**:
```json
{
  "token": "jwt_token",
  "user": {
    "user_id": 1,
    "username": "string",
    "access_role": "string",
    "company_id": 1
  }
}
```

#### POST /api/auth/register-company
**Purpose**: Company and user registration
**Request Body**:
```json
{
  "company_name": "string",
  "username": "string",
  "password": "string",
  "email": "string"
}
```

### Customer Management

#### GET /api/customers
**Purpose**: Retrieve all customers
**Response**: Array of customer objects

#### POST /api/customers
**Purpose**: Create new customer
**Request Body**:
```json
{
  "customer_name": "string",
  "email": "string",
  "phone": "string",
  "address": "string",
  "city": "string",
  "postal_code": "string"
}
```

#### PUT /api/customers/:id
**Purpose**: Update customer
**Request Body**: Customer object

#### DELETE /api/customers/:id
**Purpose**: Delete customer

### Inventory Management

#### GET /api/inventory
**Purpose**: Retrieve inventory items
**Query Parameters**:
- `part_type`: Filter by 'stock' or 'supply'
- `search`: Search by part number or description

#### POST /api/inventory
**Purpose**: Create inventory item
**Request Body**:
```json
{
  "part_number": "string",
  "part_description": "string",
  "unit": "string",
  "last_unit_cost": 0,
  "quantity_on_hand": 0,
  "reorder_point": 0,
  "part_type": "stock"
}
```

#### PUT /api/inventory/:part_number
**Purpose**: Update inventory item

#### DELETE /api/inventory/:part_number
**Purpose**: Delete inventory item

### Sales Order Management

#### GET /api/sales-orders
**Purpose**: Retrieve sales orders
**Query Parameters**:
- `status`: Filter by status ('Open', 'Closed')
- `customer_id`: Filter by customer

#### GET /api/sales-orders/:id
**Purpose**: Retrieve specific sales order with line items

#### POST /api/sales-orders
**Purpose**: Create sales order
**Request Body**:
```json
{
  "customer_id": 1,
  "sales_date": "2024-01-01",
  "product_name": "string",
  "product_description": "string",
  "terms": "string",
  "estimated_cost": 0,
  "lineItems": [
    {
      "part_number": "string",
      "part_description": "string",
      "quantity": "1",
      "unit": "string",
      "unit_price": 0,
      "line_amount": 0
    }
  ]
}
```

#### PUT /api/sales-orders/:id
**Purpose**: Update sales order

#### POST /api/sales-orders/:id/export-to-qbo
**Purpose**: Export sales order to QuickBooks

#### GET /api/sales-orders/:id/pdf
**Purpose**: Generate PDF for sales order

### Purchase Order Management

#### GET /api/purchase-orders
**Purpose**: Retrieve purchase orders

#### POST /api/purchase-orders
**Purpose**: Create purchase order

#### PUT /api/purchase-orders/:id
**Purpose**: Update purchase order

### Time Tracking

#### GET /api/time-tracking
**Purpose**: Retrieve time tracking entries

#### POST /api/time-tracking
**Purpose**: Create time tracking entry

#### PUT /api/time-tracking/:id
**Purpose**: Update time tracking entry

### Settings Management

#### GET /api/settings/labour-rate
**Purpose**: Retrieve current labour rate

#### PUT /api/settings/labour-rate
**Purpose**: Update labour rate

#### GET /api/settings/overhead-rate
**Purpose**: Retrieve current overhead rate

#### PUT /api/settings/overhead-rate
**Purpose**: Update overhead rate

## Frontend Components

### Core Components

#### 1. Layout Component
**Purpose**: Main application layout with navigation
**Features**:
- Responsive sidebar navigation
- User authentication status
- Chat integration
- Mobile-responsive design

#### 2. Authentication Components
- **LoginPage**: User login interface
- **CompanyRegisterPage**: Company registration
- **AuthProvider**: Authentication context provider

#### 3. Data Management Components
- **UnifiedCustomerDialog**: Customer add/edit modal
- **UnifiedProductDialog**: Product add/edit modal
- **UnifiedVendorDialog**: Vendor add/edit modal
- **UnifiedPartDialog**: Inventory item add/edit modal

#### 4. Form Components
- **Form validation with React Hook Form**
- **Material-UI form components**
- **Custom form fields and validation**

### Page Components

#### 1. Dashboard/Landing Page
**Purpose**: Main application dashboard
**Features**:
- Quick access to all modules
- Recent activity overview
- Navigation shortcuts
- Role-based menu items

#### 2. Customer Management Pages
- **CustomerListPage**: Customer listing with search and filters
- **CustomerDetailPage**: Individual customer details and history

#### 3. Sales Management Pages
- **QuotePage**: Quote creation and management
- **QuoteHistoryPage**: Quote history and analytics
- **SalesOrderPage**: Sales order creation
- **OpenSalesOrdersPage**: Open orders management
- **SalesOrderDetailPage**: Individual sales order details
- **OpenSalesOrderDetailPage**: Open order editing interface

#### 4. Purchase Management Pages
- **PurchaseOrderPage**: Purchase order creation
- **OpenPurchaseOrdersPage**: Open purchase orders
- **PurchaseOrderDetailPage**: Purchase order details
- **OpenPurchaseOrderDetailPage**: Purchase order editing

#### 5. Inventory Management Pages
- **InventoryPage**: Stock items management
- **SupplyPage**: Supply items management
- **PartsToOrderPage**: Parts ordering interface

#### 6. Employee Management Pages
- **EmployeeManagementPage**: Employee records
- **TimeTrackingPage**: Time tracking interface
- **TimeTrackingReportsPage**: Time tracking reports
- **AttendancePage**: Attendance management

#### 7. Settings Pages
- **BusinessProfilePage**: Business profile management
- **MarginSchedulePage**: Margin schedule configuration
- **QBOAccountMappingPage**: QuickBooks account mapping

## Backend Services

### Core Services

#### 1. Authentication Service
**Purpose**: User authentication and session management
**Features**:
- JWT token generation and validation
- Password hashing with bcrypt
- Session management
- Role-based access control

#### 2. Database Service
**Purpose**: Database connection and query management
**Features**:
- PostgreSQL connection pooling
- Query optimization
- Transaction management
- Error handling

#### 3. File Service
**Purpose**: File upload and management
**Features**:
- File upload handling with Multer
- File storage management
- PDF generation with PDFKit
- File cleanup and maintenance

#### 4. Email Service
**Purpose**: Email notifications and communications
**Features**:
- Email template management
- SMTP configuration
- Notification sending
- Email tracking

### Business Logic Services

#### 1. Inventory Service
**Purpose**: Inventory management logic
**Features**:
- Stock level tracking
- Reorder point calculations
- Cost tracking
- Inventory validation

#### 2. Sales Service
**Purpose**: Sales process management
**Features**:
- Quote and order processing
- Pricing calculations
- Inventory integration
- Status management

#### 3. Purchase Service
**Purpose**: Purchase process management
**Features**:
- Purchase order processing
- Vendor management
- Cost tracking
- Order fulfillment

#### 4. Time Tracking Service
**Purpose**: Time and attendance management
**Features**:
- Time entry processing
- Duration calculations
- Report generation
- Labour cost calculations

#### 5. QuickBooks Integration Service
**Purpose**: QuickBooks Online integration
**Features**:
- Customer synchronization
- Invoice creation
- Bill management
- Account mapping

## Authentication & Security

### Security Features
1. **JWT Authentication**: Secure token-based authentication
2. **Password Hashing**: Bcrypt password encryption
3. **Role-based Access Control**: Different permission levels
4. **Session Management**: Secure session handling
5. **CORS Configuration**: Cross-origin request security
6. **Input Validation**: Server-side data validation
7. **SQL Injection Prevention**: Parameterized queries
8. **XSS Protection**: Input sanitization

### User Roles
1. **Admin**: Full system access
2. **Sales and Purchase**: Sales and purchasing operations
3. **Employee**: Time tracking and basic access
4. **Viewer**: Read-only access

### Authentication Flow
1. User submits login credentials
2. Server validates credentials against database
3. JWT token generated with user information
4. Token returned to client
5. Client stores token in secure storage
6. Token included in subsequent API requests
7. Server validates token on each request

## Deployment

### Development Environment
```bash
# Backend setup
cd soft-sme-backend
npm install
npm run dev

# Frontend setup
cd soft-sme-frontend
npm install
npm run dev

# Database setup
# Configure PostgreSQL connection
# Run migrations
```

### Production Deployment

#### Backend Deployment
1. **Environment Configuration**:
   ```bash
   # .env file
   DB_HOST=your_db_host
   DB_NAME=your_db_name
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   JWT_SECRET=your_jwt_secret
   PORT=5000
   ```

2. **Build Process**:
   ```bash
   npm run build
   npm start
   ```

#### Frontend Deployment
1. **Build for Production**:
   ```bash
   npm run build
   ```

2. **Serve Static Files**:
   - Nginx configuration
   - Apache configuration
   - CDN deployment

#### Desktop App Deployment
1. **Build Process**:
   ```bash
   npm run build:desktop:win
   npm run build:desktop:mac
   npm run build:desktop:linux
   ```

2. **Distribution**:
   - Windows: .exe installer
   - macOS: .dmg file
   - Linux: .AppImage or .deb

### Docker Deployment
```dockerfile
# Backend Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./soft-sme-backend
    ports:
      - "5000:5000"
    environment:
      - DB_HOST=postgres
      - DB_NAME=soft_sme_db
      - DB_USER=postgres
      - DB_PASSWORD=password
    depends_on:
      - postgres

  frontend:
    build: ./soft-sme-frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=soft_sme_db
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Mobile App

### Capacitor Mobile App
**Location**: `clockwise-mobile/`

### Features
1. **Cross-platform**: iOS and Android support
2. **Native functionality**: Camera, GPS, notifications
3. **Offline capability**: Local data storage
4. **Push notifications**: Real-time updates
5. **Touch-optimized**: Mobile-friendly interface

### Technology Stack
- **Capacitor 7.4.2**: Mobile app framework
- **React 18.3.1**: UI framework
- **Tailwind CSS**: Styling
- **Radix UI**: Component primitives
- **React Hook Form**: Form management
- **Zod**: Schema validation

### Key Components
1. **Time Tracking**: Mobile time entry
2. **Attendance**: Clock in/out functionality
3. **Inventory**: Stock checking and updates
4. **Sales**: Quote and order viewing
5. **Notifications**: Real-time alerts

### Build Process
```bash
# Install dependencies
npm install

# Build for development
npm run build:dev

# Build for production
npm run build

# Add platforms
npx cap add android
npx cap add ios

# Sync changes
npx cap sync

# Open in native IDE
npx cap open android
npx cap open ios
```

## Desktop App

### Electron Desktop App
**Location**: `soft-sme-frontend/`

### Features
1. **Cross-platform**: Windows, macOS, Linux
2. **Offline capability**: Local data storage
3. **Native integration**: File system access
4. **Auto-updates**: Automatic version updates
5. **System tray**: Background operation

### Technology Stack
- **Electron 36.4.0**: Desktop app framework
- **React**: UI framework
- **Material-UI**: Component library
- **Electron Builder**: App packaging

### Build Configuration
```json
{
  "build": {
    "appId": "com.soft-sme.app",
    "productName": "Aiven",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist-electron/**/*",
      "electron/**/*",
      "frontend-dist/**/*",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "../soft-sme-backend/dist",
        "to": "backend",
        "filter": ["**/*"]
      }
    ],
    "win": {
      "target": [
        {
          "target": "portable",
          "arch": ["x64"]
        }
      ],
      "icon": "build/icon.ico"
    }
  }
}
```

### Development Workflow
```bash
# Development mode
npm run electron:dev

# Build for production
npm run build:desktop:win
npm run build:desktop:mac
npm run build:desktop:linux

# Build portable version
npm run build:desktop:win:portable
```

## Integration Features

### QuickBooks Online Integration

#### Features
1. **Customer Synchronization**: Sync customers between systems
2. **Invoice Creation**: Create QBO invoices from sales orders
3. **Bill Management**: Create QBO bills from purchase orders
4. **Account Mapping**: Map accounts between systems
5. **Export Tracking**: Track export status and history

#### Configuration
```typescript
interface QBOConnection {
  connection_id: number;
  company_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  created_at: Date;
}

interface QBOAccountMapping {
  mapping_id: number;
  account_type: string;
  qbo_account_id: string;
  qbo_account_name: string;
  created_at: Date;
}
```

#### API Endpoints
- `POST /api/qbo/auth`: QBO authentication
- `POST /api/qbo/export-invoice`: Export sales order to QBO
- `POST /api/qbo/export-bill`: Export purchase order to QBO
- `GET /api/qbo/accounts`: Retrieve QBO accounts
- `POST /api/qbo/map-accounts`: Map accounts

### File Management Integration

#### Features
1. **PDF Generation**: Generate PDFs for quotes, orders, reports
2. **CSV Import/Export**: Bulk data import and export
3. **File Upload**: Logo and document uploads
4. **File Storage**: Secure file storage and retrieval

#### PDF Generation
```typescript
// PDF generation for sales orders
const generateSalesOrderPDF = (salesOrder: SalesOrder) => {
  const doc = new PDFDocument();
  // Add company header
  // Add customer information
  // Add line items table
  // Add totals and terms
  return doc;
};
```

## Business Logic

### Pricing Calculations

#### Margin-Based Pricing
```typescript
const calculateUnitPrice = (cost: number, marginSchedule: MarginSchedule[]): number => {
  const marginFactor = findMarginFactor(cost, marginSchedule);
  return cost * marginFactor;
};
```

#### GST Calculations
```typescript
const calculateGST = (subtotal: number, gstRate: number = 0.05): number => {
  return subtotal * gstRate;
};
```

#### Line Item Calculations
```typescript
const calculateLineAmount = (quantity: number, unitPrice: number): number => {
  return quantity * unitPrice;
};
```

### Inventory Management Logic

#### Stock Level Validation
```typescript
const validateInventoryLevel = (
  partNumber: string, 
  requestedQuantity: number, 
  currentStock: number
): boolean => {
  return currentStock >= requestedQuantity;
};
```

#### Reorder Point Logic
```typescript
const checkReorderPoint = (item: InventoryItem): boolean => {
  return item.quantity_on_hand <= item.reorder_point;
};
```

#### Cost Tracking
```typescript
const updateLastUnitCost = (partNumber: string, newCost: number): void => {
  // Update inventory item with new cost
  // Trigger margin recalculation if needed
};
```

### Sales Order Workflow

#### Order Creation Process
1. **Customer Selection**: Choose or create customer
2. **Product Configuration**: Select product and description
3. **Line Item Addition**: Add parts with quantities
4. **Pricing Calculation**: Automatic pricing with margins
5. **Inventory Validation**: Check stock availability
6. **Order Saving**: Save order to database

#### Order Processing
1. **Status Management**: Track order status
2. **Inventory Updates**: Reduce stock levels
3. **Parts to Order**: Track items needing procurement
4. **Order Fulfillment**: Complete order processing
5. **QuickBooks Export**: Export to accounting system

### Time Tracking Logic

#### Duration Calculations
```typescript
const calculateDuration = (startTime: Date, endTime: Date): number => {
  const durationMs = endTime.getTime() - startTime.getTime();
  return Math.round(durationMs / (1000 * 60)); // Convert to minutes
};
```

#### Labour Cost Calculations
```typescript
const calculateLabourCost = (durationMinutes: number, labourRate: number): number => {
  const hours = durationMinutes / 60;
  return hours * labourRate;
};
```

## Configuration

### Environment Variables

#### Backend Configuration
```bash
# Database
DB_HOST=localhost
DB_NAME=soft_sme_db
DB_USER=postgres
DB_PASSWORD=password
DB_PORT=5432

# Authentication
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h

# Server
PORT=5000
NODE_ENV=production

# File Storage
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760

# QuickBooks
QBO_CLIENT_ID=your_qbo_client_id
QBO_CLIENT_SECRET=your_qbo_client_secret
QBO_REDIRECT_URI=http://localhost:5000/api/qbo/callback
```

#### Frontend Configuration
```typescript
// src/config/api.ts
export const apiConfig = {
  development: {
    baseURL: 'http://localhost:5000',
    timeout: 10000,
  },
  production: {
    baseURL: 'https://your-backend-domain.com',
    timeout: 15000,
  },
};
```

### Database Configuration

#### PostgreSQL Setup
```sql
-- Create database
CREATE DATABASE soft_sme_db;

-- Create user
CREATE USER soft_sme_user WITH PASSWORD 'password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE soft_sme_db TO soft_sme_user;
```

#### Migration Management
```bash
# Run migrations
npm run migrate

# Create new migration
# Add SQL file to migrations directory

# Rollback migration
# Manual rollback process
```

### Build Configuration

#### Frontend Build
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

#### Backend Build
```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### Deployment Configuration

#### Production Checklist
1. **Environment Variables**: Configure all required environment variables
2. **Database**: Set up production database with proper security
3. **SSL Certificate**: Configure HTTPS for production
4. **Backup Strategy**: Implement database backup procedures
5. **Monitoring**: Set up application monitoring and logging
6. **Security**: Configure firewall and security measures
7. **Performance**: Optimize database queries and application performance

#### Scaling Considerations
1. **Database**: Consider read replicas for high traffic
2. **Caching**: Implement Redis for session and data caching
3. **Load Balancing**: Use load balancer for multiple server instances
4. **CDN**: Use CDN for static file delivery
5. **Monitoring**: Implement comprehensive monitoring and alerting

This documentation provides a comprehensive overview of the Aiven application, covering all aspects from architecture to deployment. It serves as a complete reference for understanding the system's functionality, implementation details, and operational procedures. 
