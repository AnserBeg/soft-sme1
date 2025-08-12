import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  FormControlLabel,
  Switch,
  Divider,
  Grid,
  Card,
  CardContent,
  CardActions,
  CircularProgress,
  MenuItem,
  Container
} from '@mui/material';
import { toast } from 'react-toastify';
import EmailIcon from '@mui/icons-material/Email';
import SaveIcon from '@mui/icons-material/Save';
import TestIcon from '@mui/icons-material/BugReport';
import TemplateIcon from '@mui/icons-material/Description';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

interface UserEmailSettings {
  email_provider: string;
  email_host: string;
  email_port: number;
  email_secure: boolean;
  email_user: string;
  email_from: string;
}

const EMAIL_PROVIDERS = [
  { value: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false },
  { value: 'outlook', label: 'Outlook/Hotmail', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  { value: 'yahoo', label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 587, secure: false },
  { value: 'icloud', label: 'iCloud', host: 'smtp.mail.me.com', port: 587, secure: false },
  { value: 'custom', label: 'Custom SMTP', host: '', port: 587, secure: false }
];

const UserEmailSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserEmailSettings>({
    email_provider: 'gmail',
    email_host: 'smtp.gmail.com',
    email_port: 587,
    email_secure: false,
    email_user: '',
    email_from: ''
  });
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await api.get('/api/email/user-settings');
      if (response.data.success && response.data.settings) {
        const userSettings = response.data.settings;
        setSettings({
          email_provider: userSettings.email_provider,
          email_host: userSettings.email_host,
          email_port: userSettings.email_port,
          email_secure: userSettings.email_secure,
          email_user: userSettings.email_user,
          email_from: userSettings.email_from || userSettings.email_user
        });
        setHasSettings(true);
      }
    } catch (error) {
      console.error('Error loading user email settings:', error);
    }
  };

  const saveSettings = async () => {
    // Check required fields (password is only required for new settings)
    if (!settings.email_host || !settings.email_port || !settings.email_user) {
      toast.error('Please fill in all required fields');
      return;
    }

    // If updating existing settings and password is empty, don't send password
    if (hasSettings && !password) {
      toast.info('Password field is empty - keeping existing password');
    }

    setLoading(true);
    try {
      const payload = {
        ...settings,
        ...(password && { email_pass: password }) // Only include password if provided
      };

      const response = await api.post('/api/email/user-settings', payload);

      if (response.data.success) {
        toast.success('Email settings saved successfully!');
        setHasSettings(true);
        setPassword(''); // Clear password field after successful save
        setConnectionStatus('unknown');
      } else {
        toast.error(response.data.message || 'Failed to save email settings');
      }
    } catch (error: any) {
      console.error('Error saving email settings:', error);
      toast.error(error.response?.data?.message || 'Failed to save email settings');
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    if (!hasSettings) {
      toast.error('Please save your email settings first');
      return;
    }

    setTesting(true);
    try {
      const response = await api.post('/api/email/test-user-connection');
      
      if (response.data.success) {
        setConnectionStatus('connected');
        toast.success('Email connection test successful!');
      } else {
        setConnectionStatus('failed');
        toast.error(response.data.message || 'Email connection test failed');
      }
    } catch (error: any) {
      console.error('Error testing email connection:', error);
      setConnectionStatus('failed');
      toast.error(error.response?.data?.message || 'Email connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleProviderChange = (provider: string) => {
    const providerConfig = EMAIL_PROVIDERS.find(p => p.value === provider);
    if (providerConfig) {
      setSettings(prev => ({
        ...prev,
        email_provider: provider,
        email_host: providerConfig.host,
        email_port: providerConfig.port,
        email_secure: providerConfig.secure
      }));
    }
  };

  const handleSettingChange = (field: keyof UserEmailSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'success';
      case 'failed': return 'error';
      default: return 'info';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'failed': return 'Connection Failed';
      default: return 'Not Tested';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <EmailIcon sx={{ mr: 2, fontSize: 32 }} />
        <Typography variant="h4" component="h1">
          My Email Settings
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Configure your personal email settings to send emails from your own email account. 
        These settings are private to your account and will be used when you send emails from the system.
      </Alert>

      <Alert severity="warning" sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          <strong>Important for Gmail users:</strong>
        </Typography>
        <Typography variant="body2">
          If you're using Gmail with 2-Factor Authentication, you need to use an "App Password" instead of your regular password. 
          <br />
          • Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Google App Passwords</a>
          <br />
          • Generate an app password for "Mail" 
          <br />
          • Use that 16-character password in the "App Password" field below
        </Typography>
      </Alert>

      <Grid container spacing={3}>
        {/* Email Configuration */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Email Configuration
              </Typography>
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    select
                    label="Email Provider"
                    value={settings.email_provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    fullWidth
                    helperText="Select your email provider or choose Custom for other SMTP servers"
                  >
                    {EMAIL_PROVIDERS.map((provider) => (
                      <MenuItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12} sm={8}>
                  <TextField
                    label="SMTP Host"
                    value={settings.email_host}
                    onChange={(e) => handleSettingChange('email_host', e.target.value)}
                    fullWidth
                    required
                    disabled={settings.email_provider !== 'custom'}
                  />
                </Grid>

                <Grid item xs={12} sm={4}>
                  <TextField
                    label="SMTP Port"
                    type="number"
                    value={settings.email_port}
                    onChange={(e) => handleSettingChange('email_port', parseInt(e.target.value))}
                    fullWidth
                    required
                    disabled={settings.email_provider !== 'custom'}
                  />
                </Grid>

                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.email_secure}
                        onChange={(e) => handleSettingChange('email_secure', e.target.checked)}
                        disabled={settings.email_provider !== 'custom'}
                      />
                    }
                    label="Use SSL/TLS (usually for port 465)"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Email Address"
                    type="email"
                    value={settings.email_user}
                    onChange={(e) => handleSettingChange('email_user', e.target.value)}
                    fullWidth
                    required
                    helperText="Your email address for authentication"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label={hasSettings ? "Update App Password" : "App Password"}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    fullWidth
                    required={!hasSettings}
                    helperText={hasSettings ? "Leave blank to keep current password, or enter new password to update" : "Your email password or app password (for Gmail with 2FA)"}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="From Name (Optional)"
                    value={settings.email_from}
                    onChange={(e) => handleSettingChange('email_from', e.target.value)}
                    fullWidth
                    helperText="Display name for outgoing emails (defaults to email address)"
                  />
                </Grid>
              </Grid>
            </CardContent>

            <CardActions>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
                onClick={saveSettings}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardActions>
          </Card>
        </Grid>

        {/* Connection Status & Test */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Connection Status
              </Typography>
              
              <Alert severity={getConnectionStatusColor()} sx={{ mb: 2 }}>
                {getConnectionStatusText()}
              </Alert>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Test your email configuration to ensure it works correctly.
              </Typography>
            </CardContent>

            <CardActions>
              <Button
                variant="outlined"
                startIcon={testing ? <CircularProgress size={20} /> : <TestIcon />}
                onClick={testConnection}
                disabled={testing || !hasSettings}
                fullWidth
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
            </CardActions>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Setup Instructions
              </Typography>
              
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Gmail:</strong> Use an App Password instead of your regular password.
              </Typography>
              
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Outlook:</strong> Use an App Password for enhanced security.
              </Typography>
              
              <Typography variant="body2">
                <strong>Other providers:</strong> Check your email provider's SMTP settings.
              </Typography>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2, border: '2px solid red' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Actions
              </Typography>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Manage your email templates and customize email content for different types of communications.
              </Typography>

              <Button
                fullWidth
                variant="outlined"
                onClick={() => navigate('/email-templates')}
                startIcon={<TemplateIcon />}
                sx={{ mb: 1 }}
                color="primary"
              >
                Manage Email Templates
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
};

export default UserEmailSettingsPage;