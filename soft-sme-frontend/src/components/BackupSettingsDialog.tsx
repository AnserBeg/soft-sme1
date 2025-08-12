import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  FolderOpen as FolderOpenIcon,
  Upload as UploadIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../api/axios';

interface BackupSettings {
  customBackupDir: string;
  customRestoreDir: string;
}

interface BackupSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSettingsSaved: () => void;
}

const BackupSettingsDialog: React.FC<BackupSettingsDialogProps> = ({
  open,
  onClose,
  onSettingsSaved
}) => {
  const [settings, setSettings] = useState<BackupSettings>({
    customBackupDir: '',
    customRestoreDir: ''
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSettings();
    }
  }, [open]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/backup/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Error fetching backup settings:', error);
      toast.error('Failed to load backup settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await api.post('/api/backup/settings', settings);
      toast.success('Backup settings saved successfully!');
      onSettingsSaved();
      onClose();
    } catch (error) {
      console.error('Error saving backup settings:', error);
      toast.error('Failed to save backup settings');
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUploadBackup = async () => {
    if (!selectedFile) {
      toast.error('Please select a backup file to upload');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('backup', selectedFile);

      const response = await api.post('/api/backup/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      toast.success('Backup uploaded successfully!');
      setSelectedFile(null);
      onSettingsSaved();
      onClose();
    } catch (error) {
      console.error('Error uploading backup:', error);
      toast.error('Failed to upload backup file');
    } finally {
      setUploading(false);
    }
  };

  const handleBrowseBackupDir = async () => {
    try {
      // Check if we're in Electron environment
      if (window.api?.browseDirectory) {
        const result = await window.api.browseDirectory({ title: 'Select Backup Directory' });
        if (result.success && result.directory) {
          setSettings(prev => ({ ...prev, customBackupDir: result.directory }));
        }
      } else {
        // Fallback to manual input
        toast.info('Please enter the backup directory path manually');
      }
    } catch (error) {
      console.error('Error browsing backup directory:', error);
      toast.error('Failed to browse directory');
    }
  };

  const handleBrowseRestoreDir = async () => {
    try {
      // Check if we're in Electron environment
      if (window.api?.browseDirectory) {
        const result = await window.api.browseDirectory({ title: 'Select Restore Directory' });
        if (result.success && result.directory) {
          setSettings(prev => ({ ...prev, customRestoreDir: result.directory }));
        }
      } else {
        // Fallback to manual input
        toast.info('Please enter the restore directory path manually');
      }
    } catch (error) {
      console.error('Error browsing restore directory:', error);
      toast.error('Failed to browse directory');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SettingsIcon />
          Backup Settings
        </Box>
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Custom Backup Directory
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Set a custom directory where backups will be stored on your device
            </Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs>
                <TextField
                  fullWidth
                  label="Backup Directory Path"
                  value={settings.customBackupDir}
                  onChange={(e) => setSettings(prev => ({ ...prev, customBackupDir: e.target.value }))}
                  placeholder="e.g., C:\MyBackups or /home/user/backups"
                  helperText="Leave empty to use default backup location"
                />
              </Grid>
              <Grid item>
                <Tooltip title="Browse for backup directory">
                  <IconButton onClick={handleBrowseBackupDir}>
                    <FolderOpenIcon />
                  </IconButton>
                </Tooltip>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              Custom Restore Directory
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Set a custom directory to look for backup files when restoring
            </Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs>
                <TextField
                  fullWidth
                  label="Restore Directory Path"
                  value={settings.customRestoreDir}
                  onChange={(e) => setSettings(prev => ({ ...prev, customRestoreDir: e.target.value }))}
                  placeholder="e.g., C:\ExternalBackups or /home/user/external-backups"
                  helperText="Leave empty to use default restore location"
                />
              </Grid>
              <Grid item>
                <Tooltip title="Browse for restore directory">
                  <IconButton onClick={handleBrowseRestoreDir}>
                    <FolderOpenIcon />
                  </IconButton>
                </Tooltip>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              Upload External Backup
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a backup file from your device to restore from
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="outlined"
                component="label"
                startIcon={<UploadIcon />}
                disabled={uploading}
              >
                Select Backup File
                <input
                  type="file"
                  hidden
                  accept=".zip,.sql,.json"
                  onChange={handleFileSelect}
                />
              </Button>
              {selectedFile && (
                <Typography variant="body2">
                  Selected: {selectedFile.name}
                </Typography>
              )}
              {selectedFile && (
                <Button
                  variant="contained"
                  onClick={handleUploadBackup}
                  disabled={uploading}
                  startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
                >
                  {uploading ? 'Uploading...' : 'Upload & Restore'}
                </Button>
              )}
            </Box>

            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Note:</strong> Custom directories must be accessible by the application. 
                Make sure the directories exist and have proper read/write permissions.
              </Typography>
            </Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSaveSettings}
          variant="contained"
          disabled={saving || loading}
          startIcon={saving ? <CircularProgress size={20} /> : undefined}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BackupSettingsDialog; 