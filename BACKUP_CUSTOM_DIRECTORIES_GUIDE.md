# Backup Custom Directories Guide

## Overview

The backup system now supports custom directories for storing and retrieving backups, allowing users to specify their own backup locations on their devices.

## Features

### 1. Custom Backup Directory
- **Purpose**: Set a custom directory where backups will be stored
- **Usage**: Navigate to Backup Management → Backup Settings
- **Benefits**: 
  - Store backups in your preferred location (e.g., external drive, cloud sync folder)
  - Organize backups by project or date
  - Keep backups separate from application files

### 2. Custom Restore Directory
- **Purpose**: Set a directory to look for backup files when restoring
- **Usage**: Navigate to Backup Management → Backup Settings
- **Benefits**:
  - Restore from backups stored in external locations
  - Import backups from other devices or sources
  - Maintain backup archives in separate locations

### 3. File Upload for Restoration
- **Purpose**: Upload backup files directly from your device
- **Usage**: Navigate to Backup Management → Backup Settings → Upload External Backup
- **Supported Formats**: `.zip`, `.sql`, `.json`
- **File Size Limit**: 100MB

## How to Use

### Setting Custom Directories

1. **Open Backup Settings**:
   - Go to Backup Management page
   - Click "Backup Settings" button

2. **Configure Backup Directory**:
   - Enter the full path to your desired backup directory
   - Examples:
     - Windows: `C:\MyBackups\NeuraTask`
     - macOS: `/Users/username/Documents/Backups`
     - Linux: `/home/username/backups`

3. **Configure Restore Directory**:
   - Enter the full path to your restore directory
   - This is where the system will look for backup files

4. **Save Settings**:
   - Click "Save Settings" to apply changes

### Directory Browser (Desktop App Only)

In the desktop application, you can use the folder browser:
- Click the folder icon next to the directory input fields
- Select your desired directory from the file browser
- The path will be automatically filled in

### Uploading External Backups

1. **Select File**:
   - Click "Select Backup File" in the Backup Settings
   - Choose a backup file from your device

2. **Upload and Restore**:
   - Click "Upload & Restore" to process the file
   - The system will upload the file and make it available for restoration

## Technical Details

### Directory Structure
```
Custom Backup Directory/
├── backup_manifest_2024-01-15T10-30-00-000Z.json
├── database_backup_2024-01-15T10-30-00-000Z.sql
├── uploads_backup_2024-01-15T10-30-00-000Z.zip
└── config_backup_2024-01-15T10-30-00-000Z.zip
```

### Settings Storage
- Settings are stored in `backup-settings.json` in the backend directory
- Format:
```json
{
  "customBackupDir": "/path/to/backup/directory",
  "customRestoreDir": "/path/to/restore/directory"
}
```

### Fallback Behavior
- If custom directories are not set or don't exist, the system falls back to the default `backups` directory
- If directory browsing is not available (web version), users can manually enter paths

## Security Considerations

### File Permissions
- Ensure the application has read/write permissions to custom directories
- On Windows, run the application as administrator if needed
- On macOS/Linux, ensure proper file ownership and permissions

### Path Validation
- The system validates that directories exist before using them
- Invalid paths will fall back to default locations
- Error messages are shown for permission issues

## Troubleshooting

### Common Issues

1. **"Directory not found" error**:
   - Verify the directory path is correct
   - Ensure the directory exists
   - Check file permissions

2. **"Permission denied" error**:
   - Run the application with appropriate permissions
   - Check folder permissions on your system
   - Try creating the directory manually first

3. **Upload fails**:
   - Check file size (100MB limit)
   - Verify file format (.zip, .sql, .json)
   - Ensure stable internet connection

### Setup Commands

Run these commands in the backend directory to create required directories:

```bash
# Create temp uploads directory
mkdir -p temp-uploads

# Create default backups directory
mkdir -p backups

# Set proper permissions (Linux/macOS)
chmod 755 temp-uploads backups
```

## Best Practices

### Directory Organization
- Use descriptive directory names
- Organize by date or project
- Keep backups separate from application files

### Regular Maintenance
- Monitor disk space in custom directories
- Clean up old backups periodically
- Test restore functionality regularly

### Backup Strategy
- Use external drives for important backups
- Consider cloud storage for off-site backups
- Maintain multiple backup copies

## API Endpoints

### Settings Management
- `GET /api/backup/settings` - Get current settings
- `POST /api/backup/settings` - Save settings

### File Upload
- `POST /api/backup/upload` - Upload backup file

### Directory Browsing (Desktop)
- `POST /api/backup/browse-dir` - Browse directory (desktop only)

## Migration from Default Backups

If you have existing backups in the default location:

1. **Copy existing backups** to your new custom directory
2. **Update settings** to point to the new location
3. **Verify functionality** by creating a test backup
4. **Remove old backups** from default location (optional)

## Support

For issues with custom backup directories:
1. Check the application logs for error messages
2. Verify directory paths and permissions
3. Test with default directories first
4. Contact support with specific error details 