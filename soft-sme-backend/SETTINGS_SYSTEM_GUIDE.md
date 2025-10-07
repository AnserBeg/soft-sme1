# NEURATASK Settings System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [Business Profile Settings](#business-profile-settings)
3. [Accounting & QuickBooks Integration](#accounting--quickbooks-integration)
4. [Global Variables & System Settings](#global-variables--system-settings)
5. [Backup Management](#backup-management)
6. [Session Management](#session-management)
7. [Database Structure](#database-structure)
8. [API Endpoints](#api-endpoints)
9. [Integration Points](#integration-points)
10. [Troubleshooting Common Issues](#troubleshooting-common-issues)
11. [Security Considerations](#security-considerations)

## Overview

The NEURATASK Settings system provides comprehensive configuration management for the entire application. It includes business profile management, QuickBooks Online integration, global system variables, backup management, and session control. These settings influence how the application behaves across all modules and ensure proper business operations.

## Business Profile Settings

### Overview
The Business Profile settings manage the core company information that appears on all documents, invoices, and reports. This is the primary company identity used throughout the application.

### Profile Fields

**Required Fields:**
- **Business Name**: Primary company name (required)
- **Street Address**: Company address (required)
- **City**: City name (required)
- **Province**: State/province (required)
- **Country**: Country name (required)
- **Telephone Number**: Contact phone (required)
- **Email**: Contact email (required)
- **Business Number**: Tax/Business ID (required)

**Optional Fields:**
- **Postal Code**: ZIP/postal code
- **Website**: Company website URL
- **Logo**: Company logo image

### Logo Management

**Upload Process:**
1. **File Selection**: Choose image file (JPEG, PNG, GIF)
2. **File Validation**: Max 5MB, image types only
3. **Storage**: Saved to `soft-sme-backend/uploads/` directory
4. **Naming**: `logo-{timestamp}-{random}.{extension}`
5. **Database**: Logo URL stored in `business_profile.logo_url`

**Logo Operations:**
- **Upload**: Replace existing logo with new image
- **Delete**: Remove logo and revert to default
- **Preview**: Real-time preview before saving
- **Display**: Used on all documents and reports

**Logo Integration:**
```typescript
// Logo URL generation
const getLogoUrl = (logoUrl: string) => {
  if (!logoUrl) return defaultLogo;
  return `${BACKEND_URL}/uploads/${logoUrl}`;
};
```

### Business Profile API

**Endpoints:**
- **GET** `/api/business-profile` - Retrieve current profile
- **POST** `/api/business-profile` - Create/update profile
- **DELETE** `/api/business-profile/logo` - Delete logo

**Profile Creation:**
```typescript
// Create new business profile
const formData = new FormData();
Object.entries(profile).forEach(([key, value]) => {
  formData.append(key, value);
});
if (logoFile) {
  formData.append('logo', logoFile);
}

await api.post('/api/business-profile', formData);
```

### Business Profile Integration

**Document Generation:**
- **Quotes**: Business name, address, contact info
- **Sales Orders**: Company details in header
- **Purchase Orders**: Vendor information
- **Invoices**: Billing information
- **Reports**: Company branding

**Auto-fill Functionality:**
- **Customer Creation**: Pre-fills with business profile data
- **Vendor Creation**: Uses business profile as template
- **Form Defaults**: Address formats, contact patterns

## Accounting & QuickBooks Integration

### Overview
The QuickBooks Online (QBO) integration allows seamless export of sales orders, purchase orders, and financial data to QuickBooks for accounting purposes. This ensures accurate financial tracking and eliminates double data entry.

### QBO Connection Process

**OAuth2 Authentication:**
1. **Authorization Request**: User clicks "Connect to QuickBooks"
2. **OAuth Redirect**: Redirected to Intuit authorization page
3. **Permission Grant**: User grants access to QuickBooks company
4. **Token Exchange**: Authorization code exchanged for access/refresh tokens
5. **Connection Storage**: Tokens stored in `qbo_connection` table

**Connection Flow:**
```typescript
// Step 1: Redirect to QBO OAuth
const url = `${AUTHORIZATION_URL}?client_id=${clientId}` +
  `&scope=${encodeURIComponent(scope)}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}` +
  `&response_type=code` +
  `&state=${state}`;

// Step 2: Handle callback and token exchange
const tokenResponse = await axios.post(TOKEN_URL, {
  grant_type: 'authorization_code',
  code,
  redirect_uri: redirectUri
}, {
  auth: { username: clientId, password: clientSecret }
});
```

### QBO Account Mapping

**Account Types:**
- **Sales Account**: Revenue account for sales
- **Accounts Receivable**: Customer payment tracking
- **GST Account**: Tax collection account
- **Cost of Goods Sold**: Product cost tracking
- **Inventory Account**: Stock asset account
- **Labour Expense**: Employee cost tracking
- **Overhead Account**: Operating expense tracking

**Mapping Configuration:**
```sql
CREATE TABLE qbo_account_mapping (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  qbo_sales_account_id VARCHAR(255),
  qbo_ar_account_id VARCHAR(255),
  qbo_gst_account_id VARCHAR(255),
  qbo_cogs_account_id VARCHAR(255),
  qbo_inventory_account_id VARCHAR(255),
  qbo_cost_of_labour_account_id VARCHAR(255),
  qbo_overhead_cogs_account_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### QBO Export Process

**Sales Order Export:**
1. **Validation**: Check if sales order is closed
2. **Customer Check**: Verify customer exists in QBO
3. **Item Creation**: Create or find QBO items for products
4. **Invoice Creation**: Generate QBO invoice with line items
5. **Cost Tracking**: Create COGS entries for labour/overhead
6. **Status Update**: Mark as exported in NEURATASK

**Export Logic:**
```typescript
// Check customer exists in QBO
const customerQuery = `SELECT Id FROM Customer WHERE DisplayName = '${customerName}'`;
const customerResponse = await axios.get(
  `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query`,
  { params: { query: customerQuery } }
);

// Create invoice in QBO
const invoiceData = {
  Line: [
    {
      Amount: productAmount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: productItemId },
        Qty: quantity
      }
    },
    {
      Amount: gstAmount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: gstItemId }
      }
    }
  ],
  CustomerRef: { value: qboCustomerId },
  DocNumber: salesOrderNumber
};
```

### QBO API Endpoints

**Authentication:**
- **GET** `/api/qbo/auth` - Start OAuth process
- **GET** `/api/qbo/callback` - Handle OAuth callback
- **GET** `/api/qbo/status` - Check connection status

**Account Management:**
- **GET** `/api/qbo-accounts/accounts` - Fetch QBO accounts
- **POST** `/api/qbo-accounts/mapping` - Save account mapping
- **GET** `/api/qbo-accounts/mapping` - Get current mapping

**Export Operations:**
- **POST** `/api/qbo-export/sales-order/:id` - Export sales order
- **POST** `/api/qbo-export/purchase-order/:id` - Export purchase order

### QBO Integration Features

**Automatic Token Refresh:**
- **Expiry Check**: Monitor token expiration
- **Refresh Process**: Use refresh token to get new access token
- **Database Update**: Store new tokens automatically
- **Error Handling**: Prompt reconnection if refresh fails

**Data Synchronization:**
- **Customer Sync**: Check/create customers in QBO
- **Item Sync**: Create QBO items for products
- **Account Sync**: Map NEURATASK accounts to QBO accounts
- **Transaction Sync**: Export completed transactions

## Global Variables & System Settings

### Overview
Global variables control system-wide behavior and calculations. These settings affect time tracking, cost calculations, and business logic across all modules.

### Global Settings Table

**Table Structure:**
```sql
CREATE TABLE global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Default Values:**
```sql
INSERT INTO global_settings (key, value) VALUES 
  ('labour_rate', '120.00'),
  ('overhead_rate', '50.00')
ON CONFLICT (key) DO NOTHING;
```

### Labour Rate Setting

**Purpose:** Default hourly rate for labour time tracking

**Default Value:** $120.00 per hour

**Usage:**
- Applied to new time entries when clocking in
- Used as fallback when sales order doesn't have custom rate
- Can be overridden by sales order-specific rates

**API Endpoints:**
- **GET** `/api/settings/labour-rate` - Retrieve current rate
- **PUT** `/api/settings/labour-rate` - Update rate

**Validation:**
```typescript
if (typeof labour_rate !== 'number' || isNaN(labour_rate) || labour_rate < 0) {
  return res.status(400).json({ error: 'Invalid labour rate' });
}
```

### Overhead Rate Setting

**Purpose:** Hourly rate for overhead calculations

**Default Value:** $50.00 per hour

**Usage:**
- Applied to overhead line item calculations
- Multiplied by total labour hours to calculate overhead cost
- Used for all sales orders (no per-sales-order override)

**API Endpoints:**
- **GET** `/api/settings/overhead-rate` - Retrieve current rate
- **PUT** `/api/settings/overhead-rate` - Update rate

### Rate Priority Logic

**Clock In Rate Selection:**
1. **Sales Order Rate**: If `default_hourly_rate` > 0, use that
2. **Global Labour Rate**: Otherwise, use global labour rate
3. **Fallback**: If neither exists, use 0

**Rate Application:**
```sql
-- Get sales order rate first
SELECT default_hourly_rate FROM salesorderhistory WHERE sales_order_id = $1

-- If sales order rate is 0 or null, use global rate
IF sales_order_rate > 0 THEN
  unit_price = sales_order_rate;
ELSE
  -- Get global labour rate
  SELECT value FROM global_settings WHERE key = 'labour_rate';
  unit_price = global_rate;
END IF
```

### Global Settings Integration

**Time Tracking:**
- Labour rate applied to new time entries
- Overhead rate used for overhead calculations
- Real-time rate updates affect new entries only

**Sales Orders:**
- Labour and overhead costs calculated using global rates
- Sales order-specific rates can override global rates
- Historical data preserved when rates change

**Purchase Orders:**
- Cost calculations use global rates as defaults
- Vendor-specific rates can be configured

## Backup Management

### Overview
The backup system provides comprehensive data protection by creating complete backups of the database, uploaded files, and configuration. This ensures business continuity and data recovery capabilities.

### Backup Components

**Database Backup:**
- **Format**: SQL dump file
- **Tool**: `pg_dump`
- **Content**: Complete database schema and data
- **File**: `database_backup_YYYY-MM-DDTHH-MM-SS-sssZ.sql`

**Uploads Backup:**
- **Format**: ZIP archive
- **Content**: All files in the `uploads/` directory
- **File**: `uploads_backup_YYYY-MM-DDTHH-MM-SS-sssZ.zip`

**Configuration Backup:**
- **Format**: ZIP archive
- **Content**: Environment files, package files, migrations
- **File**: `config_backup_YYYY-MM-DDTHH-MM-SS-sssZ.zip`

**Backup Manifest:**
- **Format**: JSON file
- **Content**: Metadata about the backup
- **File**: `backup_manifest_YYYY-MM-DDTHH-MM-SS-sssZ.json`

### Backup Process

**Creation Process:**
1. **Database Dump**: Export complete database using pg_dump
2. **File Archive**: Compress uploads directory
3. **Config Archive**: Package configuration files
4. **Manifest Creation**: Generate backup metadata
5. **Storage**: Save all components to backups directory

**Backup Logic:**
```javascript
// Create database backup
const dbBackup = await exec(`pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_DATABASE} > ${dbBackupPath}`);

// Create uploads backup
const uploadsBackup = await archiver('zip');
uploadsBackup.directory('uploads/', false);
uploadsBackup.pipe(fs.createWriteStream(uploadsBackupPath));

// Create manifest
const manifest = {
  timestamp: new Date().toISOString(),
  components: {
    database: dbBackupPath,
    uploads: uploadsBackupPath,
    config: configBackupPath
  },
  system_info: {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch
  }
};
```

### Backup Management API

**Endpoints:**
- **GET** `/api/backup/list` - List all backups
- **GET** `/api/backup/stats` - Get backup statistics
- **POST** `/api/backup/create` - Create new backup
- **GET** `/api/backup/download/:filename` - Download backup file
- **DELETE** `/api/backup/delete/:manifest` - Delete backup
- **POST** `/api/backup/restore/:manifest` - Restore from backup

### Restore Process

**Restore Steps:**
1. **Validation**: Verify backup manifest and components
2. **Database Restore**: Restore database using psql
3. **File Restore**: Extract uploads and configuration
4. **Verification**: Check restore integrity
5. **Cleanup**: Remove temporary files

**Restore Logic:**
```javascript
// Restore database
await exec(`psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_DATABASE} < ${dbBackupPath}`);

// Restore uploads
const uploadsExtract = await extract(uploadsBackupPath);
uploadsExtract.extractAllTo('uploads/', true);

// Restore configuration
const configExtract = await extract(configBackupPath);
configExtract.extractAllTo('.', true);
```

### Backup Scheduling

**Recommended Schedule:**
- **Daily**: Database backup (if high activity)
- **Weekly**: Complete backup (database + uploads + config)
- **Monthly**: Archive backups to external storage

**Automated Backups:**
```bash
# Windows Task Scheduler
# Daily backup at 2 AM
schtasks /create /tn "SOFT_SME_Backup" /tr "C:\path\to\backup.bat" /sc daily /st 02:00

# Cron Job (Linux/Mac)
# Daily backup at 2 AM
0 2 * * * cd /path/to/soft-sme-backend && node backup-system.js backup
```

## Session Management

### Overview
Session management controls user authentication, device access, and security settings. It ensures secure access to the application while providing flexibility for multi-device usage.

### Session Settings

**Configuration Options:**
- **Max Concurrent Sessions**: Maximum active sessions per user (default: 5)
- **Session Timeout**: Hours before session expires (default: 24)
- **Refresh Token Days**: Days before refresh token expires (default: 30)
- **Allow Multiple Devices**: Enable multi-device access (default: true)

**Settings Structure:**
```typescript
interface SessionSettings {
  max_concurrent_sessions: number;
  session_timeout_hours: number;
  refresh_token_days: number;
  allow_multiple_devices: boolean;
}
```

### Session Lifecycle

**Login Process:**
1. **Authentication**: Username/password validation
2. **Session Creation**: Generate session and refresh tokens
3. **Device Tracking**: Record device information
4. **Access Control**: Apply session limits and permissions

**Session Validation:**
```typescript
// Check session limits
const activeSessions = await pool.query(
  'SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND is_active = true',
  [userId]
);

if (activeSessions.rows[0].count >= maxConcurrentSessions) {
  // Force logout oldest session or deny access
}
```

### Device Management

**Device Information:**
- **Device Type**: Computer, phone, tablet
- **Location**: IP address and geographic data
- **User Agent**: Browser and operating system
- **Last Used**: Timestamp of last activity

**Device Tracking:**
```sql
CREATE TABLE user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_token VARCHAR(255) NOT NULL UNIQUE,
  refresh_token VARCHAR(255) NOT NULL UNIQUE,
  device_info JSONB,
  ip_address INET,
  user_agent TEXT,
  location_info JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  refresh_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Session Management API

**Endpoints:**
- **GET** `/api/auth/company-session-settings` - Get session settings
- **PUT** `/api/auth/company-session-settings` - Update session settings
- **GET** `/api/auth/company-sessions` - List active sessions
- **DELETE** `/api/auth/company-sessions/:userId` - Force logout user

### Security Features

**Token Management:**
- **Access Tokens**: Short-lived (24 hours)
- **Refresh Tokens**: Long-lived (30 days)
- **Automatic Refresh**: Transparent token renewal
- **Secure Storage**: Encrypted token storage

**Access Control:**
- **Session Limits**: Prevent session abuse
- **Device Tracking**: Monitor suspicious activity
- **Force Logout**: Administrative session termination
- **Geographic Restrictions**: Optional location-based access

## Database Structure

### Settings Tables

**business_profile Table:**
```sql
CREATE TABLE business_profile (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  street_address VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  province VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20),
  telephone_number VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  business_number VARCHAR(50) NOT NULL,
  website VARCHAR(255),
  logo_url VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**global_settings Table:**
```sql
CREATE TABLE global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**qbo_connection Table:**
```sql
CREATE TABLE qbo_connection (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  realm_id VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**qbo_account_mapping Table:**
```sql
CREATE TABLE qbo_account_mapping (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  qbo_sales_account_id VARCHAR(255),
  qbo_ar_account_id VARCHAR(255),
  qbo_gst_account_id VARCHAR(255),
  qbo_cogs_account_id VARCHAR(255),
  qbo_inventory_account_id VARCHAR(255),
  qbo_cost_of_labour_account_id VARCHAR(255),
  qbo_overhead_cogs_account_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**companies Table (Session Settings):**
```sql
CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL UNIQUE,
  max_concurrent_sessions INTEGER DEFAULT 5,
  session_timeout_hours INTEGER DEFAULT 24,
  refresh_token_days INTEGER DEFAULT 30,
  allow_multiple_devices BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Database Relationships

**Company to Settings:**
- `companies.id` → `qbo_connection.company_id`
- `companies.id` → `qbo_account_mapping.company_id`
- `companies.id` → `user_sessions.user_id` (via users table)

**Business Profile:**
- Standalone table with single record
- Referenced by all document generation

**Global Settings:**
- Key-value pairs for system configuration
- No foreign key relationships

## API Endpoints

### Business Profile API

**GET** `/api/business-profile`
- **Purpose**: Retrieve current business profile
- **Response**: Business profile object
- **Auth**: Required

**POST** `/api/business-profile`
- **Purpose**: Create or update business profile
- **Body**: FormData with profile fields and optional logo
- **Response**: Updated business profile
- **Auth**: Required

**DELETE** `/api/business-profile/logo`
- **Purpose**: Delete business logo
- **Response**: Success confirmation
- **Auth**: Required

### QBO Integration API

**GET** `/api/qbo/auth`
- **Purpose**: Start QBO OAuth process
- **Response**: Redirect to Intuit authorization
- **Auth**: Not required

**GET** `/api/qbo/callback`
- **Purpose**: Handle OAuth callback
- **Response**: Redirect to frontend with status
- **Auth**: Not required

**GET** `/api/qbo/status`
- **Purpose**: Check QBO connection status
- **Response**: Connection status object
- **Auth**: Required

**GET** `/api/qbo-accounts/accounts`
- **Purpose**: Fetch QBO accounts for mapping
- **Response**: QBO accounts list
- **Auth**: Required

**POST** `/api/qbo-accounts/mapping`
- **Purpose**: Save account mapping
- **Body**: Account mapping object
- **Response**: Success confirmation
- **Auth**: Required

### Global Settings API

**GET** `/api/settings/labour-rate`
- **Purpose**: Get current labour rate
- **Response**: Labour rate value
- **Auth**: Required

**PUT** `/api/settings/labour-rate`
- **Purpose**: Update labour rate
- **Body**: `{ labour_rate: number }`
- **Response**: Success confirmation
- **Auth**: Required

**GET** `/api/settings/overhead-rate`
- **Purpose**: Get current overhead rate
- **Response**: Overhead rate value
- **Auth**: Required

**PUT** `/api/settings/overhead-rate`
- **Purpose**: Update overhead rate
- **Body**: `{ overhead_rate: number }`
- **Response**: Success confirmation
- **Auth**: Required

### Backup Management API

**GET** `/api/backup/list`
- **Purpose**: List all backups
- **Response**: Backup list with metadata
- **Auth**: Required

**GET** `/api/backup/stats`
- **Purpose**: Get backup statistics
- **Response**: Backup statistics object
- **Auth**: Required

**POST** `/api/backup/create`
- **Purpose**: Create new backup
- **Response**: Backup creation status
- **Auth**: Required

**GET** `/api/backup/download/:filename`
- **Purpose**: Download backup file
- **Response**: File download
- **Auth**: Required

**DELETE** `/api/backup/delete/:manifest`
- **Purpose**: Delete backup
- **Response**: Success confirmation
- **Auth**: Required

**POST** `/api/backup/restore/:manifest`
- **Purpose**: Restore from backup
- **Response**: Restore status
- **Auth**: Required

### Session Management API

**GET** `/api/auth/company-session-settings`
- **Purpose**: Get session settings
- **Response**: Session settings object
- **Auth**: Required

**PUT** `/api/auth/company-session-settings`
- **Purpose**: Update session settings
- **Body**: Session settings object
- **Response**: Updated settings
- **Auth**: Required

**GET** `/api/auth/company-sessions`
- **Purpose**: List active sessions
- **Response**: Active sessions list
- **Auth**: Required

**DELETE** `/api/auth/company-sessions/:userId`
- **Purpose**: Force logout user
- **Response**: Success confirmation
- **Auth**: Required

## Integration Points

### Document Generation Integration

**Business Profile Usage:**
- **Quote Generation**: Company details in header
- **Sales Order Creation**: Business information
- **Purchase Order Forms**: Company contact details
- **Invoice Generation**: Billing information
- **Report Headers**: Company branding

**Logo Integration:**
```typescript
// Logo display in documents
const logoElement = profile.logo_url ? 
  `<img src="${getLogoUrl(profile.logo_url)}" alt="Company Logo" />` : 
  '';
```

### Time Tracking Integration

**Global Rate Application:**
- **Clock In**: Apply global labour rate to new time entries
- **Rate Override**: Sales order rates can override global rates
- **Overhead Calculation**: Use global overhead rate for calculations

**Rate Priority Logic:**
```typescript
// Rate selection for time tracking
const getTimeTrackingRate = (salesOrderRate: number, globalRate: number) => {
  return salesOrderRate > 0 ? salesOrderRate : globalRate;
};
```

### QBO Export Integration

**Sales Order Export:**
- **Customer Sync**: Check/create customers in QBO
- **Item Creation**: Generate QBO items for products
- **Invoice Generation**: Create QBO invoices
- **Cost Tracking**: Export labour and overhead costs

**Purchase Order Export:**
- **Vendor Sync**: Check/create vendors in QBO
- **Bill Creation**: Generate QBO bills
- **Expense Tracking**: Export purchase costs

### Backup Integration

**Data Protection:**
- **Automatic Backups**: Scheduled backup creation
- **Manual Backups**: On-demand backup generation
- **Restore Capability**: Complete system restoration
- **External Storage**: Cloud backup integration

**Backup Triggers:**
- **Scheduled**: Daily/weekly automated backups
- **Manual**: User-initiated backup creation
- **System Events**: Backup before major updates
- **Error Recovery**: Backup after system issues

## Troubleshooting Common Issues

### Business Profile Issues

**Issue: Cannot Save Business Profile**
- **Cause**: Missing required fields or validation errors
- **Solution**: Ensure all required fields are filled
- **Prevention**: Client-side validation before submission

**Issue: Logo Not Displaying**
- **Cause**: File path issues or missing uploads directory
- **Solution**: Check file permissions and directory structure
- **Prevention**: Proper file upload handling and error checking

**Issue: Profile Data Not Loading**
- **Cause**: Database connection issues or missing profile
- **Solution**: Check database connectivity and profile existence
- **Prevention**: Proper error handling and fallback values

### QBO Integration Issues

**Issue: QBO Connection Fails**
- **Cause**: Invalid OAuth credentials or expired tokens
- **Solution**: Reconnect QBO account and refresh tokens
- **Prevention**: Regular token refresh and error monitoring

**Issue: Account Mapping Not Working**
- **Cause**: Missing or incorrect account mappings
- **Solution**: Configure all required account mappings
- **Prevention**: Validation of account mapping completeness

**Issue: Export to QBO Fails**
- **Cause**: Customer/item not found in QBO
- **Solution**: Create missing customers/items in QBO first
- **Prevention**: Pre-export validation and error handling

**Issue: Token Refresh Fails**
- **Cause**: Invalid refresh token or API changes
- **Solution**: Re-authenticate with QBO
- **Prevention**: Proper token management and error handling

### Global Settings Issues

**Issue: Global Rates Not Applied**
- **Cause**: Settings not saved or cache issues
- **Solution**: Verify settings are saved and refresh cache
- **Prevention**: Proper settings validation and persistence

**Issue: Rate Changes Not Taking Effect**
- **Cause**: Existing time entries using old rates
- **Solution**: New time entries will use updated rates
- **Prevention**: Clear communication about rate change effects

**Issue: Settings API Errors**
- **Cause**: Database connection or validation issues
- **Solution**: Check database connectivity and input validation
- **Prevention**: Proper error handling and validation

### Backup Issues

**Issue: Backup Creation Fails**
- **Cause**: Insufficient disk space or database connection
- **Solution**: Free up disk space and check database
- **Prevention**: Regular disk space monitoring

**Issue: Backup Restore Fails**
- **Cause**: Corrupted backup or incompatible data
- **Solution**: Use different backup or check data compatibility
- **Prevention**: Regular backup testing and validation

**Issue: Backup Download Fails**
- **Cause**: File not found or permission issues
- **Solution**: Check file existence and permissions
- **Prevention**: Proper file management and error handling

### Session Management Issues

**Issue: Users Cannot Log In**
- **Cause**: Session limits exceeded or token issues
- **Solution**: Force logout old sessions or check tokens
- **Prevention**: Proper session management and limits

**Issue: Sessions Expire Too Quickly**
- **Cause**: Incorrect timeout settings
- **Solution**: Adjust session timeout settings
- **Prevention**: Proper timeout configuration

**Issue: Multiple Device Access Not Working**
- **Cause**: Multiple device setting disabled
- **Solution**: Enable multiple device access in settings
- **Prevention**: Clear settings documentation

## Security Considerations

### Data Protection

**Business Profile Security:**
- **Sensitive Data**: Business numbers and contact information
- **Access Control**: Admin-only profile editing
- **Data Encryption**: Encrypt sensitive fields in database
- **Audit Logging**: Track profile changes

**QBO Integration Security:**
- **Token Security**: Secure storage of OAuth tokens
- **API Security**: HTTPS communication with QBO
- **Access Control**: Limited QBO API access
- **Token Refresh**: Automatic token renewal

### Backup Security

**Backup File Security:**
- **File Encryption**: Encrypt backup files
- **Access Control**: Restrict backup file access
- **Secure Storage**: Store backups in secure location
- **Audit Trail**: Track backup creation and access

**Restore Security:**
- **Authentication**: Require authentication for restore
- **Validation**: Validate backup integrity before restore
- **Rollback Plan**: Maintain ability to rollback changes
- **Testing**: Regular restore testing

### Session Security

**Token Security:**
- **Secure Storage**: Encrypt session tokens
- **Token Rotation**: Regular token refresh
- **Access Control**: Limit session access
- **Monitoring**: Monitor for suspicious activity

**Device Security:**
- **Device Tracking**: Monitor device access
- **Geographic Restrictions**: Optional location-based access
- **Force Logout**: Ability to terminate sessions
- **Audit Logging**: Track session activity

This comprehensive guide covers all aspects of the NEURATASK Settings system, from basic business profile management to advanced QBO integration and security considerations. The system is designed to provide flexible configuration while maintaining data integrity and security. 