# SOFT SME Backup System

This document describes the comprehensive backup system for the SOFT SME application, which protects your data against loss, corruption, or system failures.

## Overview

The backup system creates complete backups of:
- **Database**: All PostgreSQL data (customers, orders, inventory, etc.)
- **Uploads**: All uploaded files (logos, documents, etc.)
- **Configuration**: Environment files, package.json, migrations, etc.

## Prerequisites

### Required Software
1. **Node.js** (v14 or higher)
2. **PostgreSQL** (pg_dump and psql commands must be available)
3. **Archiver package** (automatically installed if missing)

### Database Access
The backup system uses your existing database configuration from `.env`:
- `DB_HOST`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`

## Quick Start

### Creating a Backup

#### Option 1: Using the Batch File (Windows)
```bash
# Double-click or run:
backup.bat
```

#### Option 2: Using Node.js directly
```bash
# Create a complete backup
node backup-system.js backup

# List existing backups
node backup-system.js list

# Clean old backups (keep last 10 of each type)
node backup-system.js clean 10
```

### Restoring from Backup

#### Option 1: Using the Batch File (Windows)
```bash
# Double-click or run:
restore.bat
```

#### Option 2: Using Node.js directly
```bash
# List available backups
node restore-system.js list

# Restore from a specific backup
node restore-system.js restore backup_manifest_2024-01-15T10-30-00-000Z.json

# Interactive restore
node restore-system.js interactive
```

## Backup Components

### 1. Database Backup
- **Format**: SQL dump file
- **Tool**: `pg_dump`
- **Content**: Complete database schema and data
- **File**: `database_backup_YYYY-MM-DDTHH-MM-SS-sssZ.sql`

### 2. Uploads Backup
- **Format**: ZIP archive
- **Content**: All files in the `uploads/` directory
- **File**: `uploads_backup_YYYY-MM-DDTHH-MM-SS-sssZ.zip`

### 3. Configuration Backup
- **Format**: ZIP archive
- **Content**: 
  - Environment files (`.env`, `env.example`, `env.production`)
  - Package files (`package.json`, `package-lock.json`)
  - Configuration files (`tsconfig.json`, `render.yaml`)
  - Database migrations folder
- **File**: `config_backup_YYYY-MM-DDTHH-MM-SS-sssZ.zip`

### 4. Backup Manifest
- **Format**: JSON file
- **Content**: Metadata about the backup including timestamps, components, and system info
- **File**: `backup_manifest_YYYY-MM-DDTHH-MM-SS-sssZ.json`

## Backup Storage

### Local Storage
- **Location**: `soft-sme-backend/backups/`
- **Structure**:
  ```
  backups/
  ├── database_backup_2024-01-15T10-30-00-000Z.sql
  ├── uploads_backup_2024-01-15T10-30-00-000Z.zip
  ├── config_backup_2024-01-15T10-30-00-000Z.zip
  └── backup_manifest_2024-01-15T10-30-00-000Z.json
  ```

### Recommended External Storage
For maximum protection, copy backups to:
- **Cloud Storage**: Google Drive, Dropbox, OneDrive
- **External Hard Drive**: USB drive or network storage
- **Backup Service**: AWS S3, Google Cloud Storage

## Backup Schedule

### Recommended Schedule
- **Daily**: Database backup (if high activity)
- **Weekly**: Complete backup (database + uploads + config)
- **Monthly**: Archive backups to external storage

### Automated Backups
You can set up automated backups using:

#### Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (daily/weekly)
4. Action: Start a program
5. Program: `C:\path\to\soft-sme-backend\backup.bat`

#### Cron Job (Linux/Mac)
```bash
# Daily backup at 2 AM
0 2 * * * cd /path/to/soft-sme-backend && node backup-system.js backup

# Weekly cleanup (keep last 10 backups)
0 3 * * 0 cd /path/to/soft-sme-backend && node backup-system.js clean 10
```

## Restore Process

### Before Restoring
1. **Stop the application** to prevent data corruption
2. **Verify backup integrity** by checking manifest file
3. **Test restore** on a non-production environment first

### Restore Steps
1. **Database**: Restores all tables and data
2. **Uploads**: Extracts files to `uploads/` directory
3. **Configuration**: Extracts config files to project root
4. **Verification**: Check that all components restored correctly

### Post-Restore
1. **Restart the application**
2. **Verify data integrity**
3. **Test critical functionality**
4. **Update any environment-specific settings**

## Backup Management

### Listing Backups
```bash
node backup-system.js list
```

### Cleaning Old Backups
```bash
# Keep last 10 backups of each type
node backup-system.js clean 10

# Keep last 5 backups of each type
node backup-system.js clean 5
```

### Manual Backup Components
```javascript
const BackupSystem = require('./backup-system');

const backup = new BackupSystem();

// Backup only database
await backup.backupDatabase();

// Backup only uploads
await backup.backupUploads();

// Backup only configuration
await backup.backupConfig();
```

## Troubleshooting

### Common Issues

#### Database Connection Error
```
Error: Database backup failed
```
**Solution**: Check database credentials in `.env` file

#### Permission Denied
```
Error: EACCES: permission denied
```
**Solution**: Run as administrator or check file permissions

#### Insufficient Disk Space
```
Error: ENOSPC: no space left on device
```
**Solution**: Clean old backups or free up disk space

#### pg_dump Not Found
```
Error: 'pg_dump' is not recognized
```
**Solution**: Install PostgreSQL client tools or add to PATH

### Backup Verification

#### Check Backup Integrity
1. **Database**: Try to restore to a test database
2. **Uploads**: Extract ZIP file and verify contents
3. **Configuration**: Extract ZIP file and check files

#### Verify Manifest
```bash
# Check manifest file structure
cat backups/backup_manifest_*.json | jq .
```

## Security Considerations

### Backup Security
- **Encryption**: Consider encrypting sensitive backup files
- **Access Control**: Restrict access to backup directory
- **Network Security**: Use secure transfer for external storage

### Environment Variables
- **Sensitive Data**: Database passwords in backups
- **Protection**: Store backups in secure location
- **Rotation**: Regularly rotate database passwords

## Best Practices

### Backup Strategy
1. **3-2-1 Rule**: 3 copies, 2 different media, 1 off-site
2. **Regular Testing**: Test restore process monthly
3. **Documentation**: Keep backup procedures documented
4. **Monitoring**: Monitor backup success/failure

### Performance
1. **Off-Peak Hours**: Schedule backups during low activity
2. **Incremental Backups**: Consider for large databases
3. **Compression**: Use compression to reduce storage
4. **Cleanup**: Regularly remove old backups

### Disaster Recovery
1. **Recovery Plan**: Document step-by-step recovery process
2. **Contact Information**: Keep emergency contacts handy
3. **Alternative Systems**: Plan for system failures
4. **Testing**: Regularly test disaster recovery procedures

## Support

If you encounter issues with the backup system:

1. **Check logs**: Review console output for error messages
2. **Verify prerequisites**: Ensure all required software is installed
3. **Test components**: Test individual backup components
4. **Check permissions**: Verify file and database permissions

For additional help, refer to the PostgreSQL documentation or contact your system administrator. 