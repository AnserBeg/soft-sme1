import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SaveIcon from '@mui/icons-material/Save';
import ReplayIcon from '@mui/icons-material/Replay';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_FIELD_VISIBILITY_SETTINGS,
  FieldVisibilitySettings,
  fieldVisibilityService,
} from '../services/fieldVisibilityService';

type SectionKey = 'salesOrders' | 'invoices';

const salesOrderFields: Array<{ key: keyof FieldVisibilitySettings['salesOrders']; label: string }> = [
  { key: 'customerPoNumber', label: 'Customer PO #' },
  { key: 'quotedPrice', label: 'Quoted Price' },
  { key: 'sourceQuote', label: 'Source Quote' },
  { key: 'vin', label: 'VIN #' },
  { key: 'vehicleYear', label: 'Vehicle Year' },
  { key: 'unitNumber', label: 'Unit #' },
  { key: 'vehicleMake', label: 'Vehicle Make' },
  { key: 'vehicleModel', label: 'Vehicle Model' },
  { key: 'invoiceStatus', label: 'Invoice Status' },
  { key: 'wantedByDate', label: 'Wanted By Date' },
  { key: 'wantedByTimeOfDay', label: 'Wanted By Time of Day' },
  { key: 'productDescription', label: 'Product Description' },
  { key: 'terms', label: 'Terms' },
  { key: 'mileage', label: 'Mileage' },
];

const invoiceFields: Array<{ key: keyof FieldVisibilitySettings['invoices']; label: string }> = [
  { key: 'vin', label: 'VIN #' },
  { key: 'productDescription', label: 'Product Description' },
  { key: 'unitNumber', label: 'Unit #' },
  { key: 'vehicleMake', label: 'Vehicle Make' },
  { key: 'vehicleModel', label: 'Vehicle Model' },
  { key: 'mileage', label: 'Mileage' },
];

const FieldVisibilitySettingsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.access_role === 'Admin';

  const [settings, setSettings] = useState<FieldVisibilitySettings>(DEFAULT_FIELD_VISIBILITY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fetched = await fieldVisibilityService.fetchSettings();
        setSettings(fetched);
      } catch (err) {
        console.error('Failed to load field visibility settings', err);
        setError('Could not load field visibility settings. Using defaults.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = <K extends SectionKey>(section: K, key: keyof FieldVisibilitySettings[K]) => (
    _: React.ChangeEvent<HTMLInputElement>,
    checked: boolean,
  ) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: checked,
      },
    }));
  };

  const handleReset = () => {
    setSettings(DEFAULT_FIELD_VISIBILITY_SETTINGS);
    setSuccess(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!isAdmin) {
      setError('Only admins can change field visibility defaults.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await fieldVisibilityService.updateSettings(settings);
      setSettings(updated);
      setSuccess('Field visibility updated. Users can still adjust their own view within these limits.');
    } catch (err) {
      console.error('Failed to save field visibility settings', err);
      setError('Failed to save field visibility settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderSection = (
    title: string,
    description: string,
    section: SectionKey,
    fields: Array<{ key: string; label: string }>,
  ) => (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <VisibilityIcon color="primary" />
        <Typography variant="h6">{title}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>
      <Grid container spacing={2}>
        {fields.map(field => (
          <Grid item xs={12} sm={6} md={4} key={field.key}>
            <FormControlLabel
              control={
                <Switch
                  color="primary"
                  checked={Boolean((settings as any)[section][field.key])}
                  onChange={handleToggle(section, field.key as any)}
                  disabled={!isAdmin}
                />
              }
              label={field.label}
            />
          </Grid>
        ))}
      </Grid>
    </Paper>
  );

  return (
    <Container maxWidth="lg">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <VisibilityIcon color="primary" />
        <Typography variant="h5">Field Visibility</Typography>
        <Chip label="Admin default" color="primary" size="small" />
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Choose which sales order and invoice fields are available to users by default. Users can still
        hide fields locally with the “Customize fields/columns” toggles, but cannot turn on anything you
        disable here.
      </Typography>

      {error ? (
        <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>
      ) : null}
      {success ? (
        <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>
      ) : null}
      {!isAdmin ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Only admins can change these defaults. You can view the current configuration below.
        </Alert>
      ) : null}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={3}>
          {renderSection(
            'Sales Orders',
            'Toggle which optional fields appear on sales orders. These act as the baseline for all users.',
            'salesOrders',
            salesOrderFields,
          )}
          <Divider />
          {renderSection(
            'Invoices',
            'Toggle which optional fields appear on invoices.',
            'invoices',
            invoiceFields,
          )}
        </Stack>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 3 }}>
        <Button
          variant="outlined"
          startIcon={<ReplayIcon />}
          onClick={handleReset}
          disabled={!isAdmin || loading || saving}
        >
          Reset to defaults
        </Button>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!isAdmin || loading || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Stack>
    </Container>
  );
};

export default FieldVisibilitySettingsPage;
