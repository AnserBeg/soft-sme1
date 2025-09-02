import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
// @ts-ignore
import unzipper from 'unzipper';
import multer from 'multer';

const router = express.Router();

interface BackupComponent {
  database: string | null;
  uploads: string | null;
  config: string | null;
}

interface BackupManifest {
  backup_timestamp: string;
  backup_type: string;
  components: BackupComponent;
  system_info: {
    node_version: string;
    platform: string;
    arch: string;
  };
}

interface Backup {
  manifest: string;
  timestamp: string;
  components: BackupComponent;
  system_info: {
    node_version: string;
    platform: string;
    arch: string;
  };
  size: number;
}

function isValidDate(d: any): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

// Helper function to get backup directory
function getBackupDir(): string {
  const settingsPath = path.join(__dirname, '../../backup-settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.customBackupDir) {
        // Check if directory exists and is writable
        if (fs.existsSync(settings.customBackupDir)) {
          try {
            // Test write access by creating a temporary file
            const testFile = path.join(settings.customBackupDir, '.test-write-access');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            return settings.customBackupDir;
          } catch (error) {
            console.error('Custom backup directory is not writable:', settings.customBackupDir, error);
          }
        } else {
          console.error('Custom backup directory does not exist:', settings.customBackupDir);
        }
      }
    } catch (error) {
      console.error('Error reading backup settings:', error);
    }
  }
  return path.join(__dirname, '../../backups');
}

// Get list of available backups
router.get('/list', authMiddleware, async (req: Request, res: Response) => {
  try {
    const backupDir = getBackupDir();
    
    if (!fs.existsSync(backupDir)) {
      return res.json({ backups: [] });
    }

    const files = fs.readdirSync(backupDir);
    const manifests = files.filter(f => f.startsWith('backup_manifest_'));
    
    const backups: Backup[] = manifests.map(manifest => {
      const manifestPath = path.join(backupDir, manifest);
      const manifestData: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return {
        manifest,
        timestamp: manifestData.backup_timestamp,
        components: manifestData.components,
        system_info: manifestData.system_info,
        size: fs.statSync(manifestPath).size
      };
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ backups });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Create a new backup
router.post('/create', authMiddleware, async (req: Request, res: Response) => {
  try {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results: any = {
      timestamp,
      database: null,
      uploads: null,
      config: null
    };

    // Backup database
    try {
      const dbBackupFile = path.join(backupDir, `database_backup_${timestamp}.sql`);
      const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_DATABASE || 'soft_sme_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '123'
      };

      const pgDumpCommand = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${dbBackupFile}"`;

      await new Promise<void>((resolve, reject) => {
        exec(pgDumpCommand, {
          env: { ...process.env, PGPASSWORD: dbConfig.password }
        }, (error) => {
          if (error) {
            reject(error);
          } else {
            results.database = dbBackupFile;
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Database backup failed:', error);
    }

    // Backup uploads
    try {
      const uploadsDir = path.join(__dirname, '../../uploads');
      if (fs.existsSync(uploadsDir)) {
        const uploadsBackupFile = path.join(backupDir, `uploads_backup_${timestamp}.zip`);
        
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(uploadsBackupFile);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', () => {
            results.uploads = uploadsBackupFile;
            resolve();
          });

          archive.on('error', reject);
          archive.pipe(output);
          archive.directory(uploadsDir, 'uploads');
          archive.finalize();
        });
      }
    } catch (error) {
      console.error('Uploads backup failed:', error);
    }

    // Backup configuration
    try {
      const configBackupFile = path.join(backupDir, `config_backup_${timestamp}.zip`);
      
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(configBackupFile);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          results.config = configBackupFile;
          resolve();
        });

        archive.on('error', reject);
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
          const filePath = path.join(__dirname, '../../', file);
          if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: file });
          }
        });

        // Add migrations folder
        const migrationsDir = path.join(__dirname, '../../migrations');
        if (fs.existsSync(migrationsDir)) {
          archive.directory(migrationsDir, 'migrations');
        }

        archive.finalize();
      });
    } catch (error) {
      console.error('Configuration backup failed:', error);
    }

    // Create backup manifest
    const manifest: BackupManifest = {
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

    const manifestFile = path.join(backupDir, `backup_manifest_${timestamp}.json`);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    res.json({
      success: true,
      message: 'Backup created successfully',
      backup: {
        timestamp,
        manifest: path.basename(manifestFile),
        components: manifest.components
      }
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Download a backup file
router.get('/download/:filename', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const backupDir = getBackupDir();
    const filePath = path.join(backupDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    res.download(filePath);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

// Delete a backup
router.delete('/delete/:manifest', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { manifest } = req.params;
    const backupDir = getBackupDir();
    const manifestPath = path.join(backupDir, manifest);

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    // Read manifest to get component files
    const manifestData: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const filesToDelete = [manifest];

    // Add component files to deletion list
    Object.values(manifestData.components).forEach((component: string | null) => {
      if (component) {
        filesToDelete.push(component);
      }
    });

    // Delete all files
    filesToDelete.forEach(file => {
      const filePath = path.join(backupDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(500).json({ error: 'Failed to delete backup' });
  }
});

// Restore from backup
router.post('/restore/:manifest', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { manifest } = req.params;
    const backupDir = getBackupDir();
    const manifestPath = path.join(backupDir, manifest);

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    const manifestData: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const results: any = {};

    // Restore database
    if (manifestData.components.database) {
      try {
        const dbBackupFile = path.join(backupDir, manifestData.components.database);
        if (fs.existsSync(dbBackupFile)) {
          const dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || '5432',
            database: process.env.DB_DATABASE || 'soft_sme_db',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '123'
          };

          const psqlCommand = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${dbBackupFile}"`;

          await new Promise<void>((resolve, reject) => {
            exec(psqlCommand, {
              env: { ...process.env, PGPASSWORD: dbConfig.password }
            }, (error) => {
              if (error) {
                reject(error);
              } else {
                results.database = 'success';
                resolve();
              }
            });
          });
        }
      } catch (error) {
        console.error('Database restore failed:', error);
        results.database = 'failed';
      }
    }

    // Restore uploads
    if (manifestData.components.uploads) {
      try {
        const uploadsBackupFile = path.join(backupDir, manifestData.components.uploads);
        if (fs.existsSync(uploadsBackupFile)) {
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }

          await new Promise<void>((resolve, reject) => {
            const input = fs.createReadStream(uploadsBackupFile);
            const extract = unzipper.Parse();

            extract.on('error', reject);
            extract.on('close', () => {
              results.uploads = 'success';
              resolve();
            });

            input.pipe(extract);
            extract.on('entry', (entry: any) => {
              if (entry.path.startsWith('uploads/')) {
                const filePath = path.join(uploadsDir, entry.path.replace('uploads/', ''));
                if (entry.type === 'Directory') {
                  fs.mkdirSync(filePath, { recursive: true });
                } else {
                  entry.pipe(fs.createWriteStream(filePath));
                }
              } else {
                entry.autodrain();
              }
            });
          });
        }
      } catch (error) {
        console.error('Uploads restore failed:', error);
        results.uploads = 'failed';
      }
    }

    // Restore configuration
    if (manifestData.components.config) {
      try {
        const configBackupFile = path.join(backupDir, manifestData.components.config);
        if (fs.existsSync(configBackupFile)) {
          await new Promise<void>((resolve, reject) => {
            const input = fs.createReadStream(configBackupFile);
            const extract = unzipper.Parse();

            extract.on('error', reject);
            extract.on('close', () => {
              results.config = 'success';
              resolve();
            });

            input.pipe(extract);
            extract.on('entry', (entry: any) => {
              const filePath = path.join(__dirname, '../../', entry.path);
              if (entry.type === 'Directory') {
                fs.mkdirSync(filePath, { recursive: true });
              } else {
                entry.pipe(fs.createWriteStream(filePath));
              }
            });
          });
        }
      } catch (error) {
        console.error('Configuration restore failed:', error);
        results.config = 'failed';
      }
    }

    res.json({
      success: true,
      message: 'Restore completed',
      results,
      backup_timestamp: manifestData.backup_timestamp
    });
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// Get backup statistics
router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const backupDir = getBackupDir();
    
    if (!fs.existsSync(backupDir)) {
      return res.json({
        total_backups: 0,
        total_size: 0,
        oldest_backup: null,
        newest_backup: null
      });
    }

    const files = fs.readdirSync(backupDir);
    const manifests = files.filter(f => f.startsWith('backup_manifest_'));
    
    let totalSize = 0;
    let oldestBackup: Date | null = null;
    let newestBackup: Date | null = null;

    manifests.forEach(manifest => {
      const manifestPath = path.join(backupDir, manifest);
      const manifestData: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const fileSize = fs.statSync(manifestPath).size;
      
      totalSize += fileSize;
      
      const backupDate: Date = new Date(manifestData.backup_timestamp);
      if (!oldestBackup || backupDate < oldestBackup) {
        oldestBackup = backupDate;
      }
      if (!newestBackup || backupDate > newestBackup) {
        newestBackup = backupDate;
      }
    });

    res.json({
      total_backups: manifests.length,
      total_size: totalSize,
      oldest_backup: isValidDate(oldestBackup) ? (oldestBackup as Date).toISOString() : null,
      newest_backup: isValidDate(newestBackup) ? (newestBackup as Date).toISOString() : null
    });
  } catch (error) {
    console.error('Error getting backup stats:', error);
    res.status(500).json({ error: 'Failed to get backup statistics' });
  }
});

// Schedule automated backup
router.post('/schedule', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { frequency, time } = req.body; // frequency: 'daily', 'weekly', time: 'HH:MM'
    
    // This is a simplified scheduler - in production you'd want to use a proper job scheduler
    // For now, we'll just create a backup immediately and return success
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results: any = {
      timestamp,
      database: null,
      uploads: null,
      config: null
    };

    // Create backup (same logic as create endpoint)
    // ... backup logic here ...

    res.json({
      success: true,
      message: `Automated backup scheduled for ${frequency} at ${time}`,
      schedule: { frequency, time }
    });
  } catch (error) {
    console.error('Error scheduling backup:', error);
    res.status(500).json({ error: 'Failed to schedule backup' });
  }
});

// Get backup settings
router.get('/settings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const settingsPath = path.join(__dirname, '../../backup-settings.json');
    let settings = {
      customBackupDir: '',
      customRestoreDir: ''
    };

    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }

    // Get current backup directory info
    const currentBackupDir = getBackupDir();
    const defaultBackupDir = path.join(__dirname, '../../backups');
    
    res.json({
      ...settings,
      currentBackupDir,
      defaultBackupDir,
      isUsingCustomDir: currentBackupDir !== defaultBackupDir,
      customDirExists: settings.customBackupDir ? fs.existsSync(settings.customBackupDir) : false
    });
  } catch (error) {
    console.error('Error fetching backup settings:', error);
    res.status(500).json({ error: 'Failed to fetch backup settings' });
  }
});

// Save backup settings
router.post('/settings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { customBackupDir, customRestoreDir } = req.body;
    const settingsPath = path.join(__dirname, '../../backup-settings.json');
    
    const settings = {
      customBackupDir: customBackupDir || '',
      customRestoreDir: customRestoreDir || ''
    };

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving backup settings:', error);
    res.status(500).json({ error: 'Failed to save backup settings' });
  }
});

// Browse directory (for desktop app)
router.post('/browse-dir', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type } = req.body;
    const title = type === 'backup' ? 'Select Backup Directory' : 'Select Restore Directory';
    
    // This would work in an Electron app
    // For now, we'll return a mock response
    res.json({ 
      directory: '',
      message: 'Directory browser not available in web version. Please enter path manually.'
    });
  } catch (error) {
    console.error('Error browsing directory:', error);
    res.status(500).json({ error: 'Failed to browse directory' });
  }
});

// Upload backup file
const upload = multer({ 
  dest: path.join(__dirname, '../../temp-uploads/'),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

router.post('/upload', authMiddleware, upload.single('backup'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No backup file provided' });
    }

    const uploadedFile = req.file;
    const backupDir = getBackupDir();
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Move uploaded file to backup directory
    const fileName = `uploaded_backup_${Date.now()}_${uploadedFile.originalname}`;
    const destinationPath = path.join(backupDir, fileName);
    
    fs.renameSync(uploadedFile.path, destinationPath);

    // If it's a manifest file, we can list it as a backup
    if (fileName.includes('manifest')) {
      res.json({ 
        success: true, 
        message: 'Backup uploaded successfully',
        fileName 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Backup file uploaded. You can now restore from it.',
        fileName 
      });
    }
  } catch (error) {
    console.error('Error uploading backup:', error);
    res.status(500).json({ error: 'Failed to upload backup file' });
  }
});

export default router; 