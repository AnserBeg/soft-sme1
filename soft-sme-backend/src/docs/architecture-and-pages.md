## Purchase Order System

### Overview
The Purchase Order (PO) system manages parts and materials procurement from vendors. It includes comprehensive pickup management for drivers.

### Key Features
- **Vendor Management**: Track vendor information, contact details, and payment terms
- **Line Items**: Manage individual parts with quantities, costs, and descriptions
- **Pickup Management**: Comprehensive pickup details for drivers including:
  - **Pickup Time**: When to pick up the order (e.g., "tomorrow at 2 PM", "Friday morning")
  - **Pickup Location**: Where to pick up the order (address, building, etc.)
  - **Contact Person**: Name of person to contact at pickup location
  - **Contact Phone**: Phone number for pickup contact person
  - **Pickup Instructions**: Special instructions (parking, loading dock, etc.)
  - **Pickup Notes**: General notes about pickup for drivers
- **Status Tracking**: Open, In Progress, Completed, Cancelled
- **Cost Calculations**: Subtotal, GST, total amounts with automatic calculations
- **PDF Generation**: Professional PO documents for vendors
- **Email Integration**: Send POs directly to vendors
- **AI Agent Integration**: AI can create, update, and manage pickup details

### Database Schema
The system uses the `purchasehistory` table as the main PO table with the following pickup-related fields:

```sql
-- Pickup Management Fields
pickup_notes TEXT,                    -- General pickup notes for drivers
pickup_time VARCHAR(100),             -- When to pick up
pickup_location VARCHAR(255),         -- Where to pick up
pickup_contact_person VARCHAR(100),   -- Contact person name
pickup_phone VARCHAR(50),             -- Contact phone number
pickup_instructions TEXT              -- Special pickup instructions
```

### AI Agent Capabilities
The AI agent can:
- **Update Pickup Details**: Set pickup time, location, contact info, and instructions
- **Get Pickup Information**: Retrieve current pickup details for any PO
- **Create POs with Pickup Info**: Include pickup details when creating new purchase orders
- **Modify Existing POs**: Update pickup information on existing orders

### Voice Agent Integration
The voice calling agent can capture pickup details during vendor calls:
- Ask for pickup time and location
- Get contact person information
- Record special instructions
- Update the PO automatically with captured information

### Frontend Integration
Pickup fields are displayed in:
- PO creation/editing forms
- PO detail views
- PO lists with pickup information
- Driver pickup sheets

### Business Workflow
1. **PO Creation**: User or AI creates PO with vendor and line items
2. **Pickup Planning**: Set pickup time, location, and contact details
3. **Vendor Communication**: AI agent calls vendor to confirm pickup details
4. **Driver Assignment**: Drivers can view pickup information on PO documents
5. **Pickup Execution**: Drivers follow pickup instructions and contact specified person
6. **Completion**: PO status updated when parts are picked up

### Common Use Cases
- **Regular Pickups**: Scheduled pickups with consistent vendors
- **Emergency Orders**: Quick pickup arrangements for urgent parts
- **Special Instructions**: Loading dock access, parking arrangements, after-hours pickup
- **Contact Coordination**: Ensuring drivers know who to contact at pickup location
