const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
require('dotenv').config();

class RestoreSystem {
  constructor() {
    this.backupDir = path.join(__dirname, 'backups');
  }

  // List available backups
  listBackups() {
    if (!fs.existsSync(this.backupDir)) {
      console.log('No backups directory found');
      return [];
    }

    const files = fs.readdirSync(this.backupDir);
    const manifests = files.filter(f => f.startsWith('backup_manifest_'));
    
    const backups = manifests.map(manifest => {
      const manifestPath = path.join(this.backupDir, manifest);
      const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return {
        manifest,
        timestamp: manifestData.backup_timestamp,
        components: manifestData.components,
        system_info: manifestData.system_info
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return backups;
  }

  // Restore database from backup
  async restoreDatabase(backupFile) {
    return new Promise((resolve, reject) => {
      const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_DATABASE || 'soft_sme_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '123'
      };

      console.log('WARNING: This will overwrite your current database!');
      console.log('Database:', dbConfig.database);
      console.log('Backup file:', backupFile);
      
      const psqlCommand = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${backupFile}"`;

      console.log('Starting database restore...');
      
      const child = exec(psqlCommand, {
        env: { ...process.env, PGPASSWORD: dbConfig.password }
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('Database restore failed:', error);
          reject(error);
          return;
        }
        
        console.log('Database restore completed successfully');
        resolve();
      });

      child.stdout?.on('data', (data) => {
        console.log('psql output:', data);
      });

      child.stderr?.on('data', (data) => {
        console.log('psql stderr:', data);
      });
    });
  }

  // Restore uploads from backup
  async restoreUploads(backupFile) {
    return new Promise((resolve, reject) => {
      const uploadsDir = path.join(__dirname, 'uploads');
      
      console.log('Starting uploads restore...');
      console.log('Backup file:', backupFile);
      console.log('Target directory:', uploadsDir);

      // Create uploads directory if it doesn't exist
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const input = fs.createReadStream(backupFile);
      const extract = archiver.create('zip', {});

      extract.on('error', (err) => {
        console.error('Uploads restore failed:', err);
        reject(err);
      });

      extract.on('close', () => {
        console.log('Uploads restore completed successfully');
        resolve();
      });

      input.pipe(extract);
      extract.extractEntryTo('uploads/', uploadsDir, false);
    });
  }

  // Restore configuration from backup
  async restoreConfig(backupFile) {
    return new Promise((resolve, reject) => {
      console.log('Starting configuration restore...');
      console.log('Backup file:', backupFile);

      const input = fs.createReadStream(backupFile);
      const extract = archiver.create('zip', {});

      extract.on('error', (err) => {
        console.error('Configuration restore failed:', err);
        reject(err);
      });

      extract.on('close', () => {
        console.log('Configuration restore completed successfully');
        resolve();
      });

      input.pipe(extract);
      extract.extractEntryTo('', __dirname, false);
    });
  }

  // Restore complete backup
  async restoreCompleteBackup(manifestFile) {
    try {
      console.log('=== Starting Complete Restore ===');
      
      const manifestPath = path.join(this.backupDir, manifestFile);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      
      console.log('Restoring from backup:', manifest.backup_timestamp);
      console.log('Components:', manifest.components);

      // Restore database
      if (manifest.components.database) {
        const dbBackupFile = path.join(this.backupDir, manifest.components.database);
        if (fs.existsSync(dbBackupFile)) {
          await this.restoreDatabase(dbBackupFile);
        } else {
          console.error('Database backup file not found:', manifest.components.database);
        }
      }

      // Restore uploads
      if (manifest.components.uploads) {
        const uploadsBackupFile = path.join(this.backupDir, manifest.components.uploads);
        if (fs.existsSync(uploadsBackupFile)) {
          await this.restoreUploads(uploadsBackupFile);
        } else {
          console.error('Uploads backup file not found:', manifest.components.uploads);
        }
      }

      // Restore configuration
      if (manifest.components.config) {
        const configBackupFile = path.join(this.backupDir, manifest.components.config);
        if (fs.existsSync(configBackupFile)) {
          await this.restoreConfig(configBackupFile);
        } else {
          console.error('Configuration backup file not found:', manifest.components.config);
        }
      }

      console.log('=== Complete Restore Finished ===');
    } catch (error) {
      console.error('Complete restore failed:', error);
      throw error;
    }
  }

  // Interactive restore
  async interactiveRestore() {
    const backups = this.listBackups();
    
    if (backups.length === 0) {
      console.log('No backups found');
      return;
    }

    console.log('Available backups:');
    backups.forEach((backup, index) => {
      console.log(`${index + 1}. ${backup.timestamp}`);
      console.log(`   Components: ${Object.keys(backup.components).filter(k => backup.components[k]).join(', ')}`);
    });

    console.log('\nWARNING: Restoring will overwrite your current data!');
    console.log('Make sure you have a backup of your current data before proceeding.');
    
    // In a real implementation, you would prompt for user input here
    // For now, we'll just show the available backups
    console.log('\nTo restore, use: node restore-system.js restore <manifest_file>');
  }
}

// CLI interface
if (require.main === module) {
  const restoreSystem = new RestoreSystem();
  const command = process.argv[2];

  switch (command) {
    case 'list':
      restoreSystem.listBackups();
      break;

    case 'restore':
      const manifestFile = process.argv[3];
      if (!manifestFile) {
        console.log('Usage: node restore-system.js restore <manifest_file>');
        console.log('Available manifests:');
        restoreSystem.listBackups().forEach(backup => {
          console.log(`  ${backup.manifest}`);
        });
        break;
      }
      
      restoreSystem.restoreCompleteBackup(manifestFile)
        .then(() => {
          console.log('Restore completed successfully');
          process.exit(0);
        })
        .catch(error => {
          console.error('Restore failed:', error);
          process.exit(1);
        });
      break;

    case 'interactive':
      restoreSystem.interactiveRestore();
      break;

    default:
      console.log('Usage:');
      console.log('  node restore-system.js list                    - List available backups');
      console.log('  node restore-system.js restore <manifest_file> - Restore from backup');
      console.log('  node restore-system.js interactive             - Interactive restore');
      break;
  }
}

module.exports = RestoreSystem; 