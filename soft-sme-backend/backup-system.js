const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
require('dotenv').config();

class BackupSystem {
  constructor() {
    this.backupDir = path.join(__dirname, 'backups');
    this.ensureBackupDirectory();
  }

  ensureBackupDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  // Database backup using pg_dump
  async backupDatabase() {
    return new Promise((resolve, reject) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `database_backup_${timestamp}.sql`);
      
      const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_DATABASE || 'soft_sme_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '123'
      };

      const pgDumpCommand = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${backupFile}"`;

      console.log('Starting database backup...');
      
      const child = exec(pgDumpCommand, {
        env: { ...process.env, PGPASSWORD: dbConfig.password }
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('Database backup failed:', error);
          reject(error);
          return;
        }
        
        console.log('Database backup completed successfully');
        console.log('Backup file:', backupFile);
        resolve(backupFile);
      });

      child.stdout?.on('data', (data) => {
        console.log('pg_dump output:', data);
      });

      child.stderr?.on('data', (data) => {
        console.log('pg_dump stderr:', data);
      });
    });
  }

  // Backup uploads folder
  async backupUploads() {
    return new Promise((resolve, reject) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploadsDir = path.join(__dirname, 'uploads');
      const backupFile = path.join(this.backupDir, `uploads_backup_${timestamp}.zip`);

      if (!fs.existsSync(uploadsDir)) {
        console.log('Uploads directory does not exist, skipping...');
        resolve(null);
        return;
      }

      console.log('Starting uploads backup...');
      
      const output = fs.createWriteStream(backupFile);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log('Uploads backup completed successfully');
        console.log('Backup file:', backupFile);
        resolve(backupFile);
      });

      archive.on('error', (err) => {
        console.error('Uploads backup failed:', err);
        reject(err);
      });

      archive.pipe(output);
      archive.directory(uploadsDir, 'uploads');
      archive.finalize();
    });
  }

  // Backup configuration files
  async backupConfig() {
    return new Promise((resolve, reject) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `config_backup_${timestamp}.zip`);

      console.log('Starting configuration backup...');
      
      const output = fs.createWriteStream(backupFile);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log('Configuration backup completed successfully');
        console.log('Backup file:', backupFile);
        resolve(backupFile);
      });

      archive.on('error', (err) => {
        console.error('Configuration backup failed:', err);
        reject(err);
      });

      archive.pipe(output);

      // Add important configuration files
      const configFiles = [
        '.env',
        'env.example',
        'env.production',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'render.yaml'
      ];

      configFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: file });
        }
      });

      // Add migrations folder
      const migrationsDir = path.join(__dirname, 'migrations');
      if (fs.existsSync(migrationsDir)) {
        archive.directory(migrationsDir, 'migrations');
      }

      archive.finalize();
    });
  }

  // Create complete backup
  async createCompleteBackup() {
    try {
      console.log('=== Starting Complete Backup ===');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      const results = {
        timestamp,
        database: null,
        uploads: null,
        config: null,
        complete: null
      };

      // Backup database
      try {
        results.database = await this.backupDatabase();
      } catch (error) {
        console.error('Database backup failed:', error.message);
      }

      // Backup uploads
      try {
        results.uploads = await this.backupUploads();
      } catch (error) {
        console.error('Uploads backup failed:', error.message);
      }

      // Backup configuration
      try {
        results.config = await this.backupConfig();
      } catch (error) {
        console.error('Configuration backup failed:', error.message);
      }

      // Create backup manifest
      const manifest = {
        backup_timestamp: timestamp,
        backup_type: 'complete',
        components: {
          database: results.database ? path.basename(results.database) : null,
          uploads: results.uploads ? path.basename(results.uploads) : null,
          config: results.config ? path.basename(results.config) : null
        },
        system_info: {
          node_version: process.version,
          platform: process.platform,
          arch: process.arch
        }
      };

      const manifestFile = path.join(this.backupDir, `backup_manifest_${timestamp}.json`);
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

      console.log('=== Complete Backup Finished ===');
      console.log('Manifest file:', manifestFile);
      
      return results;
    } catch (error) {
      console.error('Complete backup failed:', error);
      throw error;
    }
  }

  // List all backups
  listBackups() {
    const files = fs.readdirSync(this.backupDir);
    const backups = {
      database: files.filter(f => f.startsWith('database_backup_')),
      uploads: files.filter(f => f.startsWith('uploads_backup_')),
      config: files.filter(f => f.startsWith('config_backup_')),
      manifests: files.filter(f => f.startsWith('backup_manifest_'))
    };

    console.log('Available backups:');
    console.log('Database backups:', backups.database.length);
    console.log('Uploads backups:', backups.uploads.length);
    console.log('Config backups:', backups.config.length);
    console.log('Manifest files:', backups.manifests.length);

    return backups;
  }

  // Clean old backups (keep last 10 of each type)
  cleanOldBackups(keepCount = 10) {
    const backups = this.listBackups();
    
    ['database', 'uploads', 'config'].forEach(type => {
      const files = backups[type]
        .map(f => ({ name: f, path: path.join(this.backupDir, f) }))
        .sort((a, b) => fs.statSync(b.path).mtime.getTime() - fs.statSync(a.path).mtime.getTime());

      if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        toDelete.forEach(file => {
          fs.unlinkSync(file.path);
          console.log(`Deleted old backup: ${file.name}`);
        });
      }
    });
  }
}

// CLI interface
if (require.main === module) {
  const backupSystem = new BackupSystem();
  const command = process.argv[2];

  switch (command) {
    case 'backup':
      backupSystem.createCompleteBackup()
        .then(() => {
          console.log('Backup completed successfully');
          process.exit(0);
        })
        .catch(error => {
          console.error('Backup failed:', error);
          process.exit(1);
        });
      break;

    case 'list':
      backupSystem.listBackups();
      break;

    case 'clean':
      const keepCount = parseInt(process.argv[3]) || 10;
      backupSystem.cleanOldBackups(keepCount);
      console.log(`Cleaned old backups, keeping last ${keepCount} of each type`);
      break;

    default:
      console.log('Usage:');
      console.log('  node backup-system.js backup    - Create complete backup');
      console.log('  node backup-system.js list      - List all backups');
      console.log('  node backup-system.js clean [N] - Clean old backups (keep N of each type, default 10)');
      break;
  }
}

module.exports = BackupSystem; 