import React, { useState, useEffect } from 'react';
import {
  Container,
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Button,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Card,
  CardContent,
  Divider,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Computer as ComputerIcon,
  Phone as PhoneIcon,
  Tablet as TabletIcon,
  LocationOn as LocationIcon,
  AccessTime as TimeIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

interface Session {
  id: number;
  deviceInfo: {
    deviceId: string;
    deviceType: string;
    browser: string;
    os: string;
    timezone?: string;
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

const DeviceManagementPage: React.FC = () => {
  const { getUserSessions, deactivateSession, logoutFromAllDevices, currentDeviceId } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logoutAllDialog, setLogoutAllDialog] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const userSessions = await getUserSessions();
      setSessions(userSessions);
    } catch (err) {
      setError('Failed to load sessions');
      console.error('Error loading sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateSession = async (sessionId: number) => {
    try {
      const success = await deactivateSession(sessionId);
      if (success) {
        setSessions(sessions.filter(session => session.id !== sessionId));
      }
    } catch (err) {
      setError('Failed to deactivate session');
      console.error('Error deactivating session:', err);
    }
  };

  const handleLogoutAll = async () => {
    try {
      await logoutFromAllDevices();
      setLogoutAllDialog(false);
    } catch (err) {
      setError('Failed to logout from all devices');
      console.error('Error logging out from all devices:', err);
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

  const isCurrentDevice = (session: Session) => {
    return session.deviceInfo.deviceId === currentDeviceId;
  };

  const getLocationDisplay = (session: Session) => {
    if (session.locationInfo?.city && session.locationInfo?.country) {
      return `${session.locationInfo.city}, ${session.locationInfo.country}`;
    }
    return session.ipAddress;
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ mt: 4, mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          Device Management
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Manage your active sessions across different devices and locations.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 3, display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => setLogoutAllDialog(true)}
            startIcon={<SecurityIcon />}
          >
            Logout from All Devices
          </Button>
          <Button
            variant="outlined"
            onClick={loadSessions}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>

        <Grid container spacing={3}>
          {sessions.map((session) => (
            <Grid item xs={12} md={6} key={session.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    {getDeviceIcon(session.deviceInfo.deviceType)}
                    <Box sx={{ ml: 1, flexGrow: 1 }}>
                      <Typography variant="h6">
                        {session.deviceInfo.browser} on {session.deviceInfo.os}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {session.deviceInfo.deviceType.charAt(0).toUpperCase() + session.deviceInfo.deviceType.slice(1)}
                      </Typography>
                    </Box>
                    {isCurrentDevice(session) && (
                      <Chip label="Current Device" color="primary" size="small" />
                    )}
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <LocationIcon sx={{ mr: 1, fontSize: 'small' }} />
                      <Typography variant="body2">
                        {getLocationDisplay(session)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <TimeIcon sx={{ mr: 1, fontSize: 'small' }} />
                      <Typography variant="body2">
                        Last used: {formatDate(session.lastUsedAt)}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      Expires: {formatDate(session.expiresAt)}
                    </Typography>
                  </Box>

                  {!isCurrentDevice(session) && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <IconButton
                        color="error"
                        onClick={() => handleDeactivateSession(session.id)}
                        title="Logout from this device"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {sessions.length === 0 && !loading && (
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              No active sessions found
            </Typography>
          </Paper>
        )}
      </Box>

      {/* Logout All Dialog */}
      <Dialog open={logoutAllDialog} onClose={() => setLogoutAllDialog(false)}>
        <DialogTitle>Logout from All Devices</DialogTitle>
        <DialogContent>
          <Typography>
            This will log you out from all devices except the current one. You'll need to log in again on other devices.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogoutAllDialog(false)}>Cancel</Button>
          <Button onClick={handleLogoutAll} color="error" variant="contained">
            Logout All
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default DeviceManagementPage; 