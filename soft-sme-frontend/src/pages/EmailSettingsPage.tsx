import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Divider,
  Grid,
  Card,
  CardContent,
  CardActions,
  CircularProgress
} from '@mui/material';
import { toast } from 'react-toastify';
import EmailIcon from '@mui/icons-material/Email';
import SendIcon from '@mui/icons-material/Send';
import TestIcon from '@mui/icons-material/BugReport';
import TemplateIcon from '@mui/icons-material/Description';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import EmailModal from '../components/EmailModal';

interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

const EmailSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<EmailSettings>({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: ''
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');

  useEffect(() => {
    loadSettings();
    testConnection();
  }, []);

  const loadSettings = async () => {
    try {
      // Load settings from environment or localStorage
      const savedSettings = localStorage.getItem('emailSettings');
      if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
      }
    } catch (error) {
      console.error('Error loading email settings:', error);
    }
  };

  const saveSettings = async () => {
    setLoading(true);
    try {
      // Save to localStorage for now (in a real app, you'd save to backend)
      localStorage.setItem('emailSettings', JSON.stringify(settings));
      toast.success('Email settings saved successfully!');
    } catch (error) {
      console.error('Error saving email settings:', error);
      toast.error('Failed to save email settings');
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const response = await api.get('/api/email/test');
      setConnectionStatus(response.data.success ? 'connected' : 'failed');
      
      if (response.data.success) {
        toast.success('Email connection test successful!');
      } else {
        toast.error('Email connection test failed');
      }
    } catch (error) {
      console.error('Error testing email connection:', error);
      setConnectionStatus('failed');
      toast.error('Email connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSettingChange = (field: keyof EmailSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'warning';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'failed':
        return 'Connection Failed';
      default:
        return 'Unknown';
    }
  };

  return (
    <Box p={3}>
      <Typography variant="h4" component="h1" gutterBottom>
        Email Settings
      </Typography>

      <Grid container spacing={3}>
        {/* Email Configuration */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              SMTP Configuration
            </Typography>
            
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="SMTP Host"
                  value={settings.host}
                  onChange={(e) => handleSettingChange('host', e.target.value)}
                  margin="normal"
                  placeholder="smtp.gmail.com"
                />
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="SMTP Port"
                  type="number"
                  value={settings.port}
                  onChange={(e) => handleSettingChange('port', parseInt(e.target.value))}
                  margin="normal"
                  placeholder="587"
                />
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email Username"
                  value={settings.user}
                  onChange={(e) => handleSettingChange('user', e.target.value)}
                  margin="normal"
                  placeholder="your-email@gmail.com"
                />
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email Password"
                  type="password"
                  value={settings.pass}
                  onChange={(e) => handleSettingChange('pass', e.target.value)}
                  margin="normal"
                  placeholder="your-app-password"
                />
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="From Email"
                  value={settings.from}
                  onChange={(e) => handleSettingChange('from', e.target.value)}
                  margin="normal"
                  placeholder="noreply@yourcompany.com"
                />
              </Grid>
              
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.secure}
                      onChange={(e) => handleSettingChange('secure', e.target.checked)}
                    />
                  }
                  label="Use SSL/TLS"
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                onClick={saveSettings}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} /> : <EmailIcon />}
              >
                {loading ? 'Saving...' : 'Save Settings'}
              </Button>
              
              <Button
                variant="outlined"
                onClick={testConnection}
                disabled={testing}
                startIcon={testing ? <CircularProgress size={20} /> : <TestIcon />}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
            </Box>
          </Paper>
        </Grid>

        {/* Status and Quick Actions */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Connection Status
              </Typography>
              
              <Alert 
                severity={getConnectionStatusColor() as any}
                sx={{ mb: 2 }}
              >
                {getConnectionStatusText()}
              </Alert>

              <Typography variant="body2" color="text.secondary" paragraph>
                Configure your email settings to enable email functionality throughout the app.
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Typography variant="h6" gutterBottom>
                Quick Actions
              </Typography>
              
              <Button
                fullWidth
                variant="contained"
                onClick={() => setEmailModalOpen(true)}
                startIcon={<SendIcon />}
                sx={{ mb: 1 }}
              >
                Send Test Email
              </Button>

              <Button
                fullWidth
                variant="outlined"
                onClick={() => navigate('/email-templates')}
                startIcon={<TemplateIcon />}
                sx={{ mb: 1 }}
              >
                Manage Email Templates
              </Button>
            </CardContent>
          </Card>

          {/* Email Provider Help */}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Email Provider Setup
              </Typography>
              
              <Typography variant="body2" color="text.secondary" paragraph>
                <strong>Gmail:</strong><br />
                Host: smtp.gmail.com<br />
                Port: 587<br />
                Use App Password (not regular password)
              </Typography>
              
              <Typography variant="body2" color="text.secondary" paragraph>
                <strong>Outlook/Hotmail:</strong><br />
                Host: smtp-mail.outlook.com<br />
                Port: 587<br />
                Enable "Less secure app access"
              </Typography>
              
              <Typography variant="body2" color="text.secondary">
                <strong>Custom SMTP:</strong><br />
                Contact your email provider for SMTP settings
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Email Modal */}
      <EmailModal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        type="custom"
        defaultSubject="Test Email from NeuraTask"
        defaultMessage="This is a test email to verify your email configuration is working correctly."
      />
    </Box>
  );
};

export default EmailSettingsPage; 