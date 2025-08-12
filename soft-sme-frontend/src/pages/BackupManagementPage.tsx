import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Paper,
  Button,
  Container,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  Tooltip,
  Snackbar
} from '@mui/material';
import {
  Backup as BackupIcon,
  Restore as RestoreIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../api/axios';
import BackupSettingsDialog from '../components/BackupSettingsDialog';

interface Backup {
  manifest: string;
  timestamp: string;
  components: {
    database: string | null;
    uploads: string | null;
    config: string | null;
  };
  system_info: {
    node_version: string;
    platform: string;
    arch: string;
  };
  size: number;
}

interface BackupStats {
  total_backups: number;
  total_size: number;
  oldest_backup: string | null;
  newest_backup: string | null;
}

const BackupManagementPage: React.FC = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [restoreDialog, setRestoreDialog] = useState<Backup | null>(null);
  const [settingsDialog, setSettingsDialog] = useState(false);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const [backupsResponse, statsResponse] = await Promise.all([
        api.get('/api/backup/list'),
        api.get('/api/backup/stats')
      ]);
      setBackups(backupsResponse.data.backups);
      setStats(statsResponse.data);
    } catch (error) {
      console.error('Error fetching backups:', error);
      toast.error('Failed to fetch backups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const createBackup = async () => {
    setCreatingBackup(true);
    try {
      const response = await api.post('/api/backup/create');
      toast.success('Backup created successfully!');
      fetchBackups();
    } catch (error) {
      console.error('Error creating backup:', error);
      toast.error('Failed to create backup');
    } finally {
      setCreatingBackup(false);
    }
  };

  const downloadBackup = async (filename: string) => {
    try {
      const response = await api.get(`/api/backup/download/${filename}`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success('Backup downloaded successfully!');
    } catch (error) {
      console.error('Error downloading backup:', error);
      toast.error('Failed to download backup');
    }
  };

  const deleteBackup = async (manifest: string) => {
    try {
      await api.delete(`/api/backup/delete/${manifest}`);
      toast.success('Backup deleted successfully!');
      setDeleteDialog(null);
      fetchBackups();
    } catch (error) {
      console.error('Error deleting backup:', error);
      toast.error('Failed to delete backup');
    }
  };

  const restoreBackup = async (backup: Backup) => {
    setRestoringBackup(backup.manifest);
    try {
      const response = await api.post(`/api/backup/restore/${backup.manifest}`);
      
      const results = response.data.results;
      const successCount = Object.values(results).filter(r => r === 'success').length;
      const totalCount = Object.keys(results).length;
      
      if (successCount === totalCount) {
        toast.success('Backup restored successfully! Please refresh the page.');
      } else {
        toast.warning(`Restore completed with ${successCount}/${totalCount} components successful`);
      }
      
      setRestoreDialog(null);
      setRestoringBackup(null);
    } catch (error) {
      console.error('Error restoring backup:', error);
      toast.error('Failed to restore backup');
      setRestoringBackup(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Fixes dash-formatted timestamps like 2025-07-15T19-47-42-315Z to valid ISO
  const fixTimestamp = (ts: string) => {
    // Only fix if it matches the dash format
    // 2025-07-15T19-47-42-315Z => 2025-07-15T19:47:42.315Z
    return ts.replace(
      /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
      '$1T$2:$3:$4.$5Z'
    );
  };

  const formatDate = (timestamp: string) => {
    return new Date(fixTimestamp(timestamp)).toLocaleString();
  };

  // Helper to safely format dash-formatted or null backup timestamps
  const safeFormatBackupDate = (ts: string | null) => {
    if (!ts) return 'None';
    // Try to fix dash-formatted timestamps
    const fixed = fixTimestamp(ts);
    const date = new Date(fixed);
    return isNaN(date.getTime()) ? 'None' : date.toLocaleString();
  };

  const getComponentStatus = (backup: Backup) => {
    const components = backup.components;
    const total = Object.keys(components).length;
    const available = Object.values(components).filter(c => c !== null).length;
    return `${available}/${total}`;
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Backup Management
        </Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Create, manage, and restore backups of your application data
        </Typography>
      </Box>

      {/* Statistics Cards */}
      {stats && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Backups
                </Typography>
                <Typography variant="h4" component="div">
                  {stats.total_backups}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Size
                </Typography>
                <Typography variant="h4" component="div">
                  {formatFileSize(stats.total_size)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Action Buttons */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          startIcon={creatingBackup ? <CircularProgress size={20} /> : <BackupIcon />}
          onClick={createBackup}
          disabled={creatingBackup}
        >
          {creatingBackup ? 'Creating Backup...' : 'Create Backup'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={fetchBackups}
          disabled={loading}
        >
          Refresh
        </Button>
        <Button
          variant="outlined"
          startIcon={<SettingsIcon />}
          onClick={() => setSettingsDialog(true)}
        >
          Backup Settings
        </Button>
      </Box>

      {/* Warning Alert */}
      <Alert severity="warning" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>Important:</strong> Restoring a backup will overwrite your current data. 
          Make sure you have a backup of your current data before proceeding.
        </Typography>
      </Alert>

      {/* Backups Table */}
      <Paper sx={{ width: '100%', overflow: 'hidden' }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date & Time</TableCell>
                <TableCell>Components</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>System Info</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : backups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary">
                      No backups found. Create your first backup to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                backups.map((backup) => (
                  <TableRow key={backup.manifest} hover>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(backup.timestamp)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {backup.components.database && (
                          <Chip label="Database" size="small" color="primary" />
                        )}
                        {backup.components.uploads && (
                          <Chip label="Uploads" size="small" color="secondary" />
                        )}
                        {backup.components.config && (
                          <Chip label="Config" size="small" color="default" />
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {getComponentStatus(backup)} components available
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatFileSize(backup.size)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {backup.system_info.platform} • {backup.system_info.arch}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                        <Tooltip title="Download Backup">
                          <IconButton
                            size="small"
                            onClick={() => downloadBackup(backup.manifest)}
                          >
                            <DownloadIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Restore Backup">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => setRestoreDialog(backup)}
                          >
                            <RestoreIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete Backup">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteDialog(backup.manifest)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteDialog} onClose={() => setDeleteDialog(null)}>
        <DialogTitle>Delete Backup</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this backup? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(null)}>Cancel</Button>
          <Button 
            onClick={() => deleteDialog && deleteBackup(deleteDialog)} 
            color="error" 
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <Dialog open={!!restoreDialog} onClose={() => setRestoreDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningIcon color="warning" />
            Restore Backup
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Warning:</strong> This will overwrite your current data with the backup from{' '}
              {restoreDialog ? formatDate(restoreDialog.timestamp) : ''}.
            </Typography>
          </Alert>
          <Typography variant="body2" gutterBottom>
            Backup components:
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            {restoreDialog?.components.database && (
              <Chip label="Database" size="small" color="primary" />
            )}
            {restoreDialog?.components.uploads && (
              <Chip label="Uploads" size="small" color="secondary" />
            )}
            {restoreDialog?.components.config && (
              <Chip label="Config" size="small" color="default" />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            Make sure you have a backup of your current data before proceeding.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreDialog(null)}>Cancel</Button>
          <Button 
            onClick={() => restoreDialog && restoreBackup(restoreDialog)} 
            color="warning" 
            variant="contained"
            disabled={restoringBackup === restoreDialog?.manifest}
            startIcon={restoringBackup === restoreDialog?.manifest ? <CircularProgress size={20} /> : <RestoreIcon />}
          >
            {restoringBackup === restoreDialog?.manifest ? 'Restoring...' : 'Restore'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Backup Settings Dialog */}
      <BackupSettingsDialog
        open={settingsDialog}
        onClose={() => setSettingsDialog(false)}
        onSettingsSaved={fetchBackups}
      />
    </Container>
  );
};

export default BackupManagementPage; 