# SOFT SME Time Tracking System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [Time Tracking Logic](#time-tracking-logic)
3. [Clock In/Out Process](#clock-inout-process)
4. [Automatic Sales Order Integration](#automatic-sales-order-integration)
5. [Global Variables and Settings](#global-variables-and-settings)
6. [Time Entry Editing](#time-entry-editing)
7. [Profile Management](#profile-management)
8. [Sales Order Rate Management](#sales-order-rate-management)
9. [Database Structure](#database-structure)
10. [Calculations and Formulas](#calculations-and-formulas)
11. [Business Rules and Validation](#business-rules-and-validation)
12. [Troubleshooting Common Issues](#troubleshooting-common-issues)
13. [Integration Features](#integration-features)

## Overview

The SOFT SME Time Tracking system is a comprehensive solution for tracking employee time spent on sales orders. The system automatically integrates with sales orders to create LABOUR and OVERHEAD line items, ensuring accurate cost tracking and billing. The system uses global settings for labour and overhead rates, and provides real-time duration updates for active time entries.

## Time Tracking Logic

### Core Concepts

**Time Entry Lifecycle:**
1. **Clock In**: Employee starts tracking time for a specific sales order
2. **Active Tracking**: Real-time duration updates every second
3. **Clock Out**: Employee stops tracking time, duration is calculated
4. **Sales Order Integration**: LABOUR and OVERHEAD line items are automatically created/updated

### Business Logic

**Key Rules:**
1. **One Active Entry Per Sales Order**: A profile can only be clocked in to one sales order at a time
2. **Real-time Updates**: Active time entries show live duration updates
3. **Automatic Line Item Creation**: Clock out automatically creates/updates LABOUR and OVERHEAD items
4. **Global Rate Application**: Uses global labour and overhead rates for calculations
5. **Duration Calculation**: Time is calculated in hours with 2 decimal precision

### Time Entry States

**Active State:**
- **Clock In**: Present, **Clock Out**: Null
- **Duration**: Updates in real-time
- **Status**: Currently tracking time

**Completed State:**
- **Clock In**: Present, **Clock Out**: Present
- **Duration**: Final calculated value
- **Status**: Time tracking completed

## Clock In/Out Process

### Clock In Process

**Prerequisites:**
- Profile must be selected
- Sales order must be selected
- Profile must not be already clocked in to the same sales order

**Clock In Steps:**
1. **Validation**: Check if profile is already clocked in to the selected sales order
2. **Global Rate Retrieval**: Get current labour rate from global settings
3. **Time Entry Creation**: Create new time entry with:
   - Profile ID
   - Sales Order ID
   - Clock In: Current timestamp
   - Unit Price: Global labour rate
4. **Real-time Updates**: Start real-time duration updates

**Clock In Validation:**
```javascript
// Check if profile is already clocked in for this SO
const existingEntry = timeEntries.find(
  entry => entry.sales_order_id === selectedSO && !entry.clock_out
);

if (existingEntry) {
  setError('You are already clocked in for this sales order');
  return;
}
```

### Clock Out Process

**Clock Out Steps:**
1. **Duration Calculation**: Calculate final duration in hours
2. **Time Entry Update**: Update time entry with clock out time and duration
3. **Sales Order Integration**: Automatically create/update LABOUR and OVERHEAD line items
4. **Real-time Updates**: Stop real-time duration updates

**Duration Calculation:**
```sql
UPDATE time_entries 
SET clock_out = NOW(), 
    duration = ROUND((EXTRACT(EPOCH FROM (NOW() - clock_in)) / 3600)::numeric, 2) 
WHERE id = $1 AND clock_out IS NULL
```

### Real-time Duration Updates

**Update Frequency:** Every second for active time entries

**Calculation Logic:**
```javascript
useEffect(() => {
  const interval = setInterval(() => {
    setTimeEntries(prevEntries => 
      prevEntries.map(entry => {
        if (!entry.clock_out) {
          const now = new Date();
          const clockIn = new Date(entry.clock_in);
          const duration = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60); // in hours
          return { ...entry, duration };
        }
        return entry;
      })
    );
  }, 1000); // Update every second

  return () => clearInterval(interval);
}, []);
```

## Automatic Sales Order Integration

### LABOUR Line Item Creation

**When Clock Out Occurs:**
1. **Calculate Total Hours**: Sum all completed time entries for the sales order
2. **Calculate Average Rate**: Average unit price from all time entries
3. **Calculate Total Cost**: Total hours × Average rate
4. **Upsert LABOUR Item**: Create or update LABOUR line item

**LABOUR Line Item Details:**
- **Part Number**: "LABOUR"
- **Part Description**: "Labour Hours"
- **Quantity**: Total hours from all time entries
- **Unit**: "hr"
- **Unit Price**: Average labour rate from time entries
- **Line Amount**: Total labour cost

**LABOUR Calculation Logic:**
```sql
-- Sum all durations and costs for this sales order
SELECT SUM(duration) as total_hours, 
       AVG(unit_price) as avg_rate, 
       SUM(duration * unit_price) as total_cost
FROM time_entries 
WHERE sales_order_id = $1 AND clock_out IS NOT NULL
```

### OVERHEAD Line Item Creation

**When Clock Out Occurs:**
1. **Get Global Overhead Rate**: Retrieve overhead rate from global settings
2. **Calculate Overhead Hours**: Same as total labour hours
3. **Calculate Overhead Cost**: Total hours × Global overhead rate
4. **Upsert OVERHEAD Item**: Create or update OVERHEAD line item

**OVERHEAD Line Item Details:**
- **Part Number**: "OVERHEAD"
- **Part Description**: "Overhead Hours"
- **Quantity**: Total hours from all time entries
- **Unit**: "hr"
- **Unit Price**: Global overhead rate
- **Line Amount**: Total overhead cost

**OVERHEAD Calculation Logic:**
```sql
-- Get global overhead rate
SELECT value FROM global_settings WHERE key = 'overhead_rate'
-- Calculate overhead cost
const totalOverheadCost = totalHours * overheadRate;
```

### Upsert Logic

**For Both LABOUR and OVERHEAD:**
1. **Check Existing**: Query for existing line item with same part number
2. **Update if Exists**: Update quantity, unit price, and line amount
3. **Insert if Not Exists**: Create new line item with calculated values

**Upsert Implementation:**
```sql
-- Check if LABOUR line item exists
SELECT sales_order_line_item_id 
FROM salesorderlineitems 
WHERE sales_order_id = $1 AND part_number = 'LABOUR'

-- Update existing or insert new
IF exists THEN
  UPDATE salesorderlineitems 
  SET part_description = $1, quantity_sold = $2, unit = $3, 
      unit_price = $4, line_amount = $5 
  WHERE sales_order_id = $6 AND part_number = 'LABOUR'
ELSE
  INSERT INTO salesorderlineitems 
  (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
  VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)
END IF
```

## Global Variables and Settings

### Global Settings Table

**Table Structure:**
```sql
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

**Default Values:**
```sql
INSERT INTO global_settings (key, value) VALUES ('labour_rate', '120.00') ON CONFLICT (key) DO NOTHING;
INSERT INTO global_settings (key, value) VALUES ('overhead_rate', '50.00') ON CONFLICT (key) DO NOTHING;
```

### Labour Rate

**Purpose:** Default hourly rate for labour time tracking

**Default Value:** $120.00 per hour

**Usage:**
- Applied to new time entries when clocking in
- Used as fallback when sales order doesn't have a custom rate
- Can be overridden by sales order-specific rates

**API Endpoints:**
- **GET** `/api/settings/labour-rate` - Retrieve current labour rate
- **PUT** `/api/settings/labour-rate` - Update labour rate

**Validation:**
```javascript
if (typeof labour_rate !== 'number' || isNaN(labour_rate) || labour_rate < 0) {
  return res.status(400).json({ error: 'Invalid labour rate' });
}
```

### Overhead Rate

**Purpose:** Hourly rate for overhead calculations

**Default Value:** $50.00 per hour

**Usage:**
- Applied to overhead line item calculations
- Multiplied by total labour hours to calculate overhead cost
- Used for all sales orders (no per-sales-order override)

**API Endpoints:**
- **GET** `/api/settings/overhead-rate` - Retrieve current overhead rate
- **PUT** `/api/settings/overhead-rate` - Update overhead rate

**Validation:**
```javascript
if (typeof overhead_rate !== 'number' || isNaN(overhead_rate) || overhead_rate < 0) {
  return res.status(400).json({ error: 'Invalid overhead rate' });
}
```

### Rate Priority Logic

**Clock In Rate Selection:**
1. **Sales Order Rate**: If sales order has `default_hourly_rate` > 0, use that
2. **Global Labour Rate**: Otherwise, use global labour rate
3. **Fallback**: If neither exists, use 0

**Rate Application:**
```sql
-- Get global labour rate for new time entry
const rateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
const unit_price = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].value) : 0;
```

## Time Entry Editing

### Edit Time Entry

**Editable Fields:**
- **Clock In Time**: Start time of the time entry
- **Clock Out Time**: End time of the time entry
- **Duration**: Auto-calculated when both times are provided

**Edit Process:**
1. **Time Validation**: Ensure clock out is after clock in
2. **Duration Recalculation**: Calculate new duration based on edited times
3. **Sales Order Update**: Trigger LABOUR and OVERHEAD recalculation

**Edit API Endpoint:**
```typescript
router.put('/time-entries/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { clock_in, clock_out } = req.body;
  
  // Convert empty strings to null
  if (!clock_in || clock_in === '') clock_in = null;
  if (!clock_out || clock_out === '') clock_out = null;

  const result = await pool.query(
    `UPDATE time_entries
     SET clock_in = $1::timestamptz,
         clock_out = $2::timestamptz,
         duration = CASE
           WHEN $1 IS NOT NULL AND $2 IS NOT NULL 
           THEN ROUND((EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 3600)::numeric, 2)
           ELSE duration
         END
     WHERE id = $3
     RETURNING *`,
    [clock_in, clock_out, id]
  );
});
```

### Duration Calculation

**Formula:**
```sql
duration = ROUND((EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600)::numeric, 2)
```

**Explanation:**
- **EXTRACT(EPOCH FROM ...)**: Get time difference in seconds
- **/ 3600**: Convert seconds to hours
- **ROUND(..., 2)**: Round to 2 decimal places

### Edit Validation

**Business Rules:**
1. **Clock Out After Clock In**: Clock out time must be after clock in time
2. **Valid Timestamps**: Both times must be valid ISO timestamps
3. **Existing Entry**: Time entry must exist and be editable

**Validation Logic:**
```javascript
// Convert empty strings to null
if (!clock_in || clock_in === '') clock_in = null;
if (!clock_out || clock_out === '') clock_out = null;

// Duration is auto-calculated when both times are provided
duration = CASE
  WHEN $1 IS NOT NULL AND $2 IS NOT NULL 
  THEN ROUND((EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 3600)::numeric, 2)
  ELSE duration
END
```

## Profile Management

### Profile Structure

**Profile Table:**
```sql
CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Profile Access Control

**Role-based Access:**
- **Admin and Time Tracking Users**: Can see all profiles
- **Mobile Users**: Can only see profiles they have access to via `user_profile_access` table

**Access Logic:**
```sql
-- Admin and Time Tracking users can see all profiles
IF userRole === 'Admin' || userRole === 'Time Tracking' THEN
  query = 'SELECT id, name, email FROM profiles ORDER BY name';
ELSE
  -- Mobile users can only see profiles they have access to
  query = `
    SELECT DISTINCT p.id, p.name, p.email 
    FROM profiles p
    INNER JOIN user_profile_access upa ON p.id = upa.profile_id
    WHERE upa.user_id = $1 AND upa.is_active = true
    ORDER BY p.name
  `;
END IF
```

### Profile Selection

**Selection Process:**
1. **Load Profiles**: Fetch available profiles based on user role
2. **Filter by Access**: Mobile users see only accessible profiles
3. **Display Options**: Show profile name and email in dropdown
4. **Selection**: Store selected profile ID for time tracking

## Sales Order Rate Management

### Sales Order Rate Override

**Sales Order Table Field:**
```sql
default_hourly_rate DECIMAL(10,2) DEFAULT 0.00
```

**Rate Priority:**
1. **Sales Order Rate**: If `default_hourly_rate` > 0, use this rate
2. **Global Labour Rate**: Otherwise, use global labour rate
3. **Fallback**: If neither exists, use 0

### Rate Update Process

**Update Steps:**
1. **Validation**: Ensure rate is a valid positive number
2. **Database Update**: Update sales order's `default_hourly_rate`
3. **Future Time Entries**: New time entries will use the updated rate
4. **Existing Time Entries**: Unchanged (historical data preserved)

**Rate Update API:**
```typescript
router.patch('/sales-orders/:id', async (req: Request, res: Response) => {
  const { default_hourly_rate } = req.body;
  
  if (typeof default_hourly_rate !== 'number' || default_hourly_rate < 0) {
    return res.status(400).json({ error: 'Invalid hourly rate' });
  }
  
  await pool.query(
    'UPDATE salesorderhistory SET default_hourly_rate = $1 WHERE sales_order_id = $2',
    [default_hourly_rate, id]
  );
});
```

### Rate Application Logic

**Clock In Rate Selection:**
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

## Database Structure

### Time Tracking Tables

**time_entries Table:**
```sql
CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id),
  sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id),
  clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
  clock_out TIMESTAMP WITH TIME ZONE,
  duration DECIMAL(10,2),
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**profiles Table:**
```sql
CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**global_settings Table:**
```sql
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

**salesorderhistory Table (Relevant Fields):**
```sql
CREATE TABLE IF NOT EXISTS salesorderhistory (
  sales_order_id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(255) UNIQUE NOT NULL,
  default_hourly_rate DECIMAL(10,2) DEFAULT 0.00,
  -- ... other fields
);
```

**salesorderlineitems Table (LABOUR/OVERHEAD Items):**
```sql
CREATE TABLE IF NOT EXISTS salesorderlineitems (
  sales_order_line_item_id SERIAL PRIMARY KEY,
  sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id),
  part_number VARCHAR(255) NOT NULL, -- 'LABOUR' or 'OVERHEAD'
  part_description TEXT,
  quantity_sold DECIMAL(10,2) NOT NULL, -- Total hours
  unit VARCHAR(50), -- 'hr'
  unit_price DECIMAL(10,2), -- Rate per hour
  line_amount DECIMAL(10,2), -- Total cost
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Database Relationships

**Time Entry to Profile:**
- `time_entries.profile_id` → `profiles.id`
- Foreign key relationship
- One profile can have many time entries

**Time Entry to Sales Order:**
- `time_entries.sales_order_id` → `salesorderhistory.sales_order_id`
- Foreign key relationship
- One sales order can have many time entries

**Sales Order Line Items:**
- `salesorderlineitems.sales_order_id` → `salesorderhistory.sales_order_id`
- Foreign key relationship
- LABOUR and OVERHEAD items are automatically created

### Database Indexes

**Performance Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_time_entries_profile_id ON time_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_sales_order_id ON time_entries(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in ON time_entries(clock_in);
CREATE INDEX IF NOT EXISTS idx_salesorderlineitems_sales_order_id ON salesorderlineitems(sales_order_id);
```

## Calculations and Formulas

### Duration Calculation

**Real-time Duration (Active Entries):**
```javascript
const duration = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60); // in hours
```

**Final Duration (Completed Entries):**
```sql
duration = ROUND((EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600)::numeric, 2)
```

### Labour Cost Calculation

**Total Hours:**
```sql
SELECT SUM(duration) as total_hours
FROM time_entries 
WHERE sales_order_id = $1 AND clock_out IS NOT NULL
```

**Average Rate:**
```sql
SELECT AVG(unit_price) as avg_rate
FROM time_entries 
WHERE sales_order_id = $1 AND clock_out IS NOT NULL
```

**Total Labour Cost:**
```sql
SELECT SUM(duration * unit_price) as total_cost
FROM time_entries 
WHERE sales_order_id = $1 AND clock_out IS NOT NULL
```

### Overhead Cost Calculation

**Overhead Hours:** Same as total labour hours

**Overhead Cost:**
```javascript
const totalOverheadCost = totalHours * overheadRate;
```

### Line Amount Calculation

**Labour Line Amount:**
```javascript
const labourLineAmount = totalHours * avgRate;
```

**Overhead Line Amount:**
```javascript
const overheadLineAmount = totalHours * overheadRate;
```

### Rounding

All monetary and duration calculations are rounded to 2 decimal places:
```sql
ROUND(value::numeric, 2)
```

## Business Rules and Validation

### Clock In Validation

**Required Fields:**
- Profile ID must be provided
- Sales Order ID must be provided

**Business Rules:**
1. **No Duplicate Active Entries**: Profile cannot be clocked in to the same sales order twice
2. **Valid Profile**: Profile must exist in database
3. **Valid Sales Order**: Sales order must exist and be accessible
4. **Rate Application**: Unit price must be set from global or sales order rate

**Validation Logic:**
```javascript
if (!profile_id || !so_id) {
  return res.status(400).json({ error: 'Profile ID and Sales Order ID are required' });
}

// Check for existing active entry
const existingEntry = timeEntries.find(
  entry => entry.sales_order_id === selectedSO && !entry.clock_out
);

if (existingEntry) {
  setError('You are already clocked in for this sales order');
  return;
}
```

### Clock Out Validation

**Business Rules:**
1. **Active Entry Exists**: Time entry must exist and be active (no clock out)
2. **Valid Duration**: Calculated duration must be positive
3. **Sales Order Integration**: LABOUR and OVERHEAD items must be created/updated

**Validation Logic:**
```sql
-- Check if entry exists and is active
SELECT * FROM time_entries WHERE id = $1 AND clock_out IS NULL

-- Calculate duration
duration = ROUND((EXTRACT(EPOCH FROM (NOW() - clock_in)) / 3600)::numeric, 2)

-- Ensure positive duration
IF duration <= 0 THEN
  -- Handle error
END IF
```

### Time Entry Edit Validation

**Business Rules:**
1. **Valid Timestamps**: Both clock in and clock out must be valid timestamps
2. **Logical Order**: Clock out must be after clock in
3. **Positive Duration**: Calculated duration must be positive
4. **Existing Entry**: Time entry must exist in database

**Validation Logic:**
```javascript
// Convert empty strings to null
if (!clock_in || clock_in === '') clock_in = null;
if (!clock_out || clock_out === '') clock_out = null;

// Validate timestamps
if (clock_in && clock_out && new Date(clock_out) <= new Date(clock_in)) {
  return res.status(400).json({ error: 'Clock out must be after clock in' });
}
```

### Rate Validation

**Global Rate Validation:**
```javascript
if (typeof labour_rate !== 'number' || isNaN(labour_rate) || labour_rate < 0) {
  return res.status(400).json({ error: 'Invalid labour rate' });
}

if (typeof overhead_rate !== 'number' || isNaN(overhead_rate) || overhead_rate < 0) {
  return res.status(400).json({ error: 'Invalid overhead rate' });
}
```

**Sales Order Rate Validation:**
```javascript
if (typeof default_hourly_rate !== 'number' || default_hourly_rate < 0) {
  return res.status(400).json({ error: 'Invalid hourly rate' });
}
```

## Troubleshooting Common Issues

### Issue: Cannot Clock In

**Possible Causes:**
1. **Already Clocked In**: Profile is already clocked in to the same sales order
2. **Missing Selection**: Profile or sales order not selected
3. **Invalid Data**: Profile or sales order doesn't exist
4. **Permission Issues**: User doesn't have access to selected profile

**Solutions:**
1. Clock out from existing entry first
2. Select both profile and sales order
3. Verify profile and sales order exist
4. Check user permissions and profile access

### Issue: Cannot Clock Out

**Possible Causes:**
1. **No Active Entry**: No active time entry found for the ID
2. **Already Clocked Out**: Time entry was already completed
3. **Database Error**: Connection or constraint issues
4. **Invalid ID**: Time entry ID doesn't exist

**Solutions:**
1. Verify time entry exists and is active
2. Check if entry was already clocked out
3. Check database connection and logs
4. Verify time entry ID is correct

### Issue: LABOUR/OVERHEAD Not Created

**Possible Causes:**
1. **Clock Out Failed**: Clock out process didn't complete
2. **Database Error**: Insert/update failed for line items
3. **Rate Issues**: Global rates not configured
4. **Sales Order Issues**: Sales order doesn't exist or is invalid

**Solutions:**
1. Check clock out process completed successfully
2. Verify database constraints and permissions
3. Configure global labour and overhead rates
4. Verify sales order exists and is valid

### Issue: Incorrect Duration Calculation

**Possible Causes:**
1. **Timezone Issues**: Clock in/out times in different timezones
2. **Data Type Issues**: Timestamps stored incorrectly
3. **Calculation Errors**: Formula or rounding issues
4. **Edit Conflicts**: Manual edits causing inconsistencies

**Solutions:**
1. Ensure consistent timezone handling
2. Verify timestamp data types and formats
3. Check duration calculation formula
4. Review manual time entry edits

### Issue: Real-time Updates Not Working

**Possible Causes:**
1. **JavaScript Errors**: Errors in real-time update logic
2. **Component Unmount**: Component unmounted while interval active
3. **State Issues**: React state not updating properly
4. **Performance Issues**: Too many updates causing lag

**Solutions:**
1. Check browser console for JavaScript errors
2. Ensure proper cleanup of intervals
3. Verify React state management
4. Optimize update frequency if needed

### Issue: Global Rates Not Applied

**Possible Causes:**
1. **Global Settings Empty**: No rates configured in global_settings
2. **API Errors**: Failed to fetch global rates
3. **Cache Issues**: Frontend using cached old rates
4. **Database Issues**: Global settings table issues

**Solutions:**
1. Configure default labour and overhead rates
2. Check API endpoints and network connectivity
3. Clear frontend cache and refresh
4. Verify global_settings table structure and data

### Issue: Sales Order Rate Override Not Working

**Possible Causes:**
1. **Rate Not Set**: Sales order default_hourly_rate is 0 or null
2. **Update Failed**: Rate update didn't save to database
3. **Cache Issues**: Frontend using old rate data
4. **Priority Logic**: Global rate taking precedence incorrectly

**Solutions:**
1. Set sales order default_hourly_rate to desired value
2. Verify rate update API call succeeded
3. Refresh sales order data
4. Check rate priority logic implementation

## Integration Features

### Sales Order Integration

**Automatic Line Item Creation:**
- LABOUR line items created/updated on clock out
- OVERHEAD line items created/updated on clock out
- Real-time cost calculations
- Automatic sales order total updates

**Integration Points:**
- Time entries trigger sales order line item updates
- Labour and overhead costs affect sales order totals
- Sales order rates override global rates for time tracking

### Profile Access Control

**Role-based Access:**
- Admin users: Full access to all profiles
- Time Tracking users: Full access to all profiles
- Mobile users: Access only to assigned profiles

**Access Management:**
- User-profile relationships managed via `user_profile_access` table
- Active/inactive status tracking
- Granular permission control

### Global Settings Integration

**Rate Management:**
- Centralized labour and overhead rate configuration
- Real-time rate application to new time entries
- Rate validation and error handling
- API endpoints for rate management

**Settings Persistence:**
- Global settings stored in database
- Default values provided on system initialization
- Conflict resolution for duplicate keys

### Reporting Integration

**Time Entry Reports:**
- Date range filtering
- Profile and sales order filtering
- Export to CSV and PDF
- Duration and cost summaries

**Sales Order Reports:**
- Labour and overhead cost tracking
- Time-based cost analysis
- Integration with sales order totals
- Historical time tracking data

This comprehensive guide covers all aspects of the SOFT SME Time Tracking system, from basic clock in/out functionality to advanced integration with sales orders and global settings management. The system is designed to provide accurate time tracking while automatically maintaining cost calculations and sales order integration. 