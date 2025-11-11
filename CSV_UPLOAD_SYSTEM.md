# CSV Upload System for Inventory Management

## Overview
The CSV upload system allows users to bulk upload supply and stock parts using CSV files. The system includes comprehensive validation, duplicate handling, and error reporting.

## Features

### 1. Mandatory Fields
- **part_number**: Unique identifier for the part (required)
- **part_description**: Description of the part (required)
- All other fields are optional

### 2. Optional Fields
- **unit**: Unit of measure (defaults to "Each"). Available options: Each, cm, ft, ft^2, kg, pcs, hr, L
- **quantity**: Quantity on hand (defaults to 0)
- **last_unit_cost**: Unit cost (defaults to 0)
- **reorder_point**: Reorder threshold (defaults to 0)
- **part_type**: Either "stock" or "supply" (defaults to "stock")

### 3. Duplicate Handling
- **Within CSV**: If the same part_number appears multiple times in the CSV:
  - Quantities are added together
  - Higher last_unit_cost is retained
  - Higher reorder_point is retained
  - Warning is generated

- **Database Conflicts**: If part_number already exists in database:
  - Quantities are added together
  - CSV last_unit_cost replaces database value (if > 0)
  - Higher reorder_point is retained
  - Part description is updated from CSV

### 4. Validation Rules
- **Required Fields**: part_number and part_description must be present
- **Part Type**: Must be either "stock" or "supply"
- **Numeric Values**: quantity, last_unit_cost, reorder_point must be non-negative
- **Unit Consistency**: Duplicate parts must have the same unit of measure
- **File Size**: Maximum 5MB
- **File Type**: Only CSV files allowed

### 5. Error Handling
- **Unit Mismatch**: Error if duplicate part has different units
- **Invalid Part Type**: Error for invalid part_type values
- **Negative Values**: Error for negative numeric fields
- **Missing Fields**: Error for missing required fields
- **Database Errors**: Detailed error messages for database operations

## API Endpoints

### 1. Upload CSV
```
POST /api/inventory/upload-csv
Content-Type: multipart/form-data
Body: csvFile (file)
```

**Response:**
```json
{
  "message": "CSV upload completed",
  "summary": {
    "totalProcessed": 10,
    "newItems": 5,
    "updatedItems": 3,
    "errors": 0,
    "warnings": 2
  },
  "errors": ["Error messages if any"],
  "warnings": ["Warning messages if any"]
}
```

### 2. Download Template
```
GET /api/inventory/csv-template
```

Returns a CSV template file with sample data.

## Frontend Features

### 1. Upload Interface
- **Upload CSV Button**: Triggers file selection
- **Download Template Button**: Downloads CSV template
- **Progress Bar**: Shows upload progress
- **File Validation**: Client-side file type and size validation

### 2. Result Display
- **Success/Error Alerts**: Clear status indication
- **Summary Cards**: Shows processed, new, updated, and error counts
- **Error List**: Detailed list of validation errors
- **Warning List**: List of warnings (duplicates, etc.)

### 3. Integration
- **Auto-refresh**: Inventory table refreshes after successful upload
- **Error Handling**: User-friendly error messages
- **File Cleanup**: Automatic file input clearing

## CSV Format

### Required Columns
```csv
part_number,part_description,unit,quantity,last_unit_cost,reorder_point,part_type
```

### Sample Data
```csv
part_number,part_description,unit,quantity,last_unit_cost,reorder_point,part_type
ABC123,Sample Part Description,Each,10,25.50,5,stock
XYZ789,Another Part,cm,5,15.75,2,supply
DEF456,Test Component,ft,20,8.25,10,stock
LIQ001,Liquid Product,L,20,12.00,5,stock
```

## Business Logic

### 1. Duplicate Processing
1. Check for duplicates within CSV file
2. Merge quantities and take higher values for costs
3. Check for unit consistency
4. Generate warnings for merged items

### 2. Database Operations
1. Check if part exists in database
2. If exists: update quantities and costs
3. If new: insert new record
4. Handle unit mismatches as errors

### 3. Data Validation
1. Validate required fields
2. Check numeric field ranges
3. Validate part_type values
4. Ensure unit consistency

## Security Considerations

### 1. File Upload Security
- File type validation (CSV only)
- File size limits (5MB)
- Temporary file cleanup
- Input sanitization

### 2. Data Validation
- Server-side validation for all inputs
- SQL injection prevention
- XSS protection through proper escaping

## Usage Instructions

### 1. Prepare CSV File
1. Download template using "Download Template" button
2. Fill in required fields (part_number, part_description)
3. Add optional fields as needed
4. Save as CSV format

### 2. Upload Process
1. Click "Upload CSV" button
2. Select prepared CSV file
3. Wait for upload to complete
4. Review results in popup dialog
5. Check inventory table for updates

### 3. Error Resolution
1. Review error messages in upload result
2. Fix issues in CSV file
3. Re-upload corrected file
4. Check warnings for merged items

## Constraints and Limitations

### 1. Technical Constraints
- Maximum file size: 5MB
- Supported format: CSV only
- Maximum concurrent uploads: 1 per user

### 2. Business Constraints
- Part numbers must be unique
- Units must be consistent for same parts
- Part types limited to "stock" or "supply"
- Non-negative numeric values only

### 3. Performance Considerations
- Large files may take time to process
- Progress indicator shows upload status
- Automatic inventory refresh after upload

## Testing

### Test Scenarios
1. **Valid Upload**: Normal CSV with valid data
2. **Duplicate Handling**: CSV with duplicate part numbers
3. **Unit Mismatch**: Duplicate parts with different units
4. **Missing Fields**: CSV missing required fields
5. **Invalid Data**: Negative values, invalid part types
6. **Large File**: Files approaching size limit
7. **Database Conflicts**: Parts that already exist

### Sample Test Files
- `test_inventory_upload.csv`: Contains various test scenarios
- Template file: Basic structure for new uploads

## Future Enhancements

### Potential Improvements
1. **Batch Processing**: Support for multiple file uploads
2. **Advanced Validation**: Custom validation rules
3. **Import History**: Track upload history and results
4. **Rollback Feature**: Ability to undo uploads
5. **Advanced Duplicate Handling**: More sophisticated merge strategies
6. **Real-time Validation**: Client-side validation before upload 
