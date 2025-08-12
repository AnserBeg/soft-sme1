import React, { useState, useEffect } from 'react';
import {
  Container,
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  Grid,
  Card,
  CardContent,
  TextField,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Refresh as RefreshIcon,
  Security as SecurityIcon,
  Computer as ComputerIcon,
  Phone as PhoneIcon,
  Tablet as TabletIcon,
  LocationOn as LocationIcon,
  AccessTime as TimeIcon,
  Block as BlockIcon,
} from '@mui/icons-material';
import api from '../api/axios';

interface SessionSettings {
  max_concurrent_sessions: number;
  session_timeout_hours: number;
  refresh_token_days: number;
  allow_multiple_devices: boolean;
}

interface CompanySession {
  id: number;
  userId: number;
  username: string;
  email: string;
  role: string;
  accessRole: string;
  deviceInfo: {
    deviceId: string;
    deviceType: string;
    browser: string;
    os: string;
  };
  ipAddress: string;
  userAgent: string;
  locationInfo?: {
    ip: string;
    country?: string;
    region?: string;
    city?: string;
  };
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
}

const CompanySessionManagementPage: React.FC = () => {
  const [settings, setSettings] = useState<SessionSettings>({
    max_concurrent_sessions: 5,
    session_timeout_hours: 24,
    refresh_token_days: 30,
    allow_multiple_devices: true,
  });
  const [sessions, setSessions] = useState<CompanySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsDialog, setSettingsDialog] = useState(false);
  const [forceLogoutDialog, setForceLogoutDialog] = useState<number | null>(null);
  const [tempSettings, setTempSettings] = useState<SessionSettings>(settings);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [settingsResponse, sessionsResponse] = await Promise.all([
        api.get('/api/auth/company-session-settings'),
        api.get('/api/auth/company-sessions'),
      ]);
      
      setSettings(settingsResponse.data);
      setSessions(sessionsResponse.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const response = await api.put('/api/auth/company-session-settings', tempSettings);
      setSettings(response.data.settings);
      setSettingsDialog(false);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update settings');
      console.error('Error updating settings:', err);
    }
  };

  const handleForceLogout = async (userId: number) => {
    try {
      await api.post(`/api/auth/force-logout-user/${userId}`);
      setSessions(sessions.filter(session => session.userId !== userId));
      setForceLogoutDialog(null);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to force logout user');
      console.error('Error forcing logout:', err);
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case 'mobile':
        return <PhoneIcon />;
      case 'tablet':
        return <TabletIcon />;
      case 'desktop':
        return <ComputerIcon />;
      default:
        return <ComputerIcon />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getLocationDisplay = (session: CompanySession) => {
    if (session.locationInfo?.city && session.locationInfo?.country) {
      return `${session.locationInfo.city}, ${session.locationInfo.country}`;
    }
    return session.ipAddress;
  };

  const getRoleColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'error';
      case 'manager':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ mt: 4, mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          Company Session Management
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Monitor and manage active sessions across your company.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 3, display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => {
              setTempSettings(settings);
              setSettingsDialog(true);
            }}
            startIcon={<SettingsIcon />}
          >
            Session Settings
          </Button>
          <Button
            variant="outlined"
            onClick={loadData}
            disabled={loading}
            startIcon={<RefreshIcon />}
          >
            Refresh
          </Button>
        </Box>

        {/* Settings Summary */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Max Concurrent Sessions
                </Typography>
                <Typography variant="h4" color="primary">
                  {settings.max_concurrent_sessions}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Session Timeout
                </Typography>
                <Typography variant="h4" color="primary">
                  {settings.session_timeout_hours}h
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Refresh Token Days
                </Typography>
                <Typography variant="h4" color="primary">
                  {settings.refresh_token_days}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Multiple Devices
                </Typography>
                <Chip
                  label={settings.allow_multiple_devices ? 'Allowed' : 'Not Allowed'}
                  color={settings.allow_multiple_devices ? 'success' : 'error'}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Sessions Table */}
        <Paper>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Device</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Last Used</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <Box>
                        <Typography variant="subtitle2">
                          {session.username}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {session.email}
                        </Typography>
                        <Chip
                          label={session.role}
                          size="small"
                          color={getRoleColor(session.role) as any}
                          sx={{ mt: 0.5 }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {getDeviceIcon(session.deviceInfo.deviceType)}
                        <Box sx={{ ml: 1 }}>
                          <Typography variant="body2">
                            {session.deviceInfo.browser}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {session.deviceInfo.os}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <LocationIcon sx={{ mr: 1, fontSize: 'small' }} />
                        <Typography variant="body2">
                          {getLocationDisplay(session)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(session.lastUsedAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(session.expiresAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Force logout user from all devices">
                        <IconButton
                          color="error"
                          onClick={() => setForceLogoutDialog(session.userId)}
                        >
                          <BlockIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {sessions.length === 0 && !loading && (
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              No active sessions found
            </Typography>
          </Paper>
        )}
      </Box>

      {/* Settings Dialog */}
      <Dialog open={settingsDialog} onClose={() => setSettingsDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Session Settings</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Max Concurrent Sessions"
                type="number"
                value={tempSettings.max_concurrent_sessions}
                onChange={(e) => setTempSettings({
                  ...tempSettings,
                  max_concurrent_sessions: parseInt(e.target.value)
                })}
                inputProps={{ min: 1, max: 20 }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Session Timeout (hours)"
                type="number"
                value={tempSettings.session_timeout_hours}
                onChange={(e) => setTempSettings({
                  ...tempSettings,
                  session_timeout_hours: parseInt(e.target.value)
                })}
                inputProps={{ min: 1, max: 168 }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Refresh Token Days"
                type="number"
                value={tempSettings.refresh_token_days}
                onChange={(e) => setTempSettings({
                  ...tempSettings,
                  refresh_token_days: parseInt(e.target.value)
                })}
                inputProps={{ min: 1, max: 365 }}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={tempSettings.allow_multiple_devices}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      allow_multiple_devices: e.target.checked
                    })}
                  />
                }
                label="Allow Multiple Devices"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveSettings} variant="contained">
            Save Settings
          </Button>
        </DialogActions>
      </Dialog>

      {/* Force Logout Dialog */}
      <Dialog open={forceLogoutDialog !== null} onClose={() => setForceLogoutDialog(null)}>
        <DialogTitle>Force Logout User</DialogTitle>
        <DialogContent>
          <Typography>
            This will log out the user from all their devices. They will need to log in again.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForceLogoutDialog(null)}>Cancel</Button>
          <Button
            onClick={() => forceLogoutDialog && handleForceLogout(forceLogoutDialog)}
            color="error"
            variant="contained"
          >
            Force Logout
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default CompanySessionManagementPage; 