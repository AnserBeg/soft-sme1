import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  Grid,
  Chip,
  Divider
} from '@mui/material';
import {
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { leaveManagementApi, Profile, VacationSettings } from '../services/leaveManagementService';

const VacationDaysManagementPage: React.FC = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [vacationSettings, setVacationSettings] = useState<VacationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<number | null>(null);
  const [editingDays, setEditingDays] = useState<number>(0);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [resetDate, setResetDate] = useState<Dayjs | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (user?.access_role === 'Admin') {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [profilesData, settingsData] = await Promise.all([
        leaveManagementApi.getProfiles(),
        leaveManagementApi.getVacationSettings()
      ]);
      
      setProfiles(profilesData || []);
      setVacationSettings(settingsData);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching data:', err);
      setError(err.response?.data?.message || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditProfile = (profile: Profile) => {
    setEditingProfile(profile.id);
    setEditingDays(profile.total_vacation_days || profile.vacation_days_available || 20);
  };

  const handleSaveProfile = async () => {
    if (!editingProfile) return;

    // Ensure we're sending an integer
    const daysToSave = Math.round(editingDays);

    try {
      setProcessing(true);
      await leaveManagementApi.updateEmployeeVacationDays(editingProfile, daysToSave);
      await fetchData(); // Refresh data
      setEditingProfile(null);
      setEditingDays(0);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update vacation days.');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingProfile(null);
    setEditingDays(0);
  };

  const handleOpenSettings = () => {
    setResetDate(vacationSettings?.reset_date ? dayjs(vacationSettings.reset_date) : null);
    setSettingsDialogOpen(true);
  };

  const handleSaveSettings = async () => {
    if (!resetDate) {
      setError('Please select a reset date.');
      return;
    }

    try {
      setProcessing(true);
      await leaveManagementApi.updateVacationSettings(resetDate.format('YYYY-MM-DD'));
      await fetchData(); // Refresh data
      setSettingsDialogOpen(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update settings.');
    } finally {
      setProcessing(false);
    }
  };

  const handleResetAllVacationDays = async () => {
    if (!window.confirm('This will reset vacation days for ALL employees. Are you sure?')) {
      return;
    }

    try {
      setProcessing(true);
      await leaveManagementApi.resetAllVacationDays();
      await fetchData(); // Refresh data
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to reset vacation days.');
    } finally {
      setProcessing(false);
    }
  };

  if (!user) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
          <Typography variant="body2" sx={{ ml: 2 }}>
            Loading user data...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (user.access_role !== 'Admin') {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">
          Access denied. Admin privileges required to view this page.
        </Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  const totalEmployees = profiles.length;
  const totalVacationDays = profiles.reduce((sum, profile) => sum + (profile.total_vacation_days || profile.vacation_days_available || 20), 0);
  const totalDaysUsed = profiles.reduce((sum, profile) => sum + Math.round(profile.days_used || 0), 0);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Vacation Days Management
          </Typography>
          <Box display="flex" gap={2}>
            <Button
              variant="outlined"
              startIcon={<CalendarIcon />}
              onClick={handleOpenSettings}
            >
              Reset Settings
            </Button>
            <Button
              variant="contained"
              color="warning"
              startIcon={<RefreshIcon />}
              onClick={handleResetAllVacationDays}
              disabled={processing}
            >
              Reset All Days
            </Button>
          </Box>
        </Box>

        <Typography variant="body1" color="text.secondary" paragraph>
          Manage vacation days allocation for each employee and set the global reset date.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Summary Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <PersonIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {totalEmployees}
                    </Typography>
                    <Typography color="text.secondary">
                      Total Employees
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <CalendarIcon sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {totalVacationDays}
                    </Typography>
                    <Typography color="text.secondary">
                      Total Days Allocated
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <TrendingUpIcon sx={{ fontSize: 40, color: 'info.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {totalDaysUsed}
                    </Typography>
                    <Typography color="text.secondary">
                      Days Used
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <SettingsIcon sx={{ fontSize: 40, color: 'warning.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h6" component="div">
                      {vacationSettings?.reset_date ? dayjs(vacationSettings.reset_date).format('MMM D, YYYY') : 'Not Set'}
                    </Typography>
                    <Typography color="text.secondary">
                      Reset Date
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Employee Table */}
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Employee Vacation Days
          </Typography>
          
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 'bold' }}>Employee</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>Total Days</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>Days Used</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>Days Remaining</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>Reset Date</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id} hover>
                    <TableCell>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                          {profile.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {profile.email}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      {editingProfile === profile.id ? (
                                               <TextField
                         type="number"
                         value={editingDays}
                         onChange={(e) => setEditingDays(Math.max(0, parseInt(e.target.value) || 0))}
                         size="small"
                         sx={{ width: 80 }}
                         inputProps={{ min: 0, step: 1 }}
                       />
                      ) : (
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {profile.total_vacation_days || profile.vacation_days_available || 20}
                        </Typography>
                      )}
                    </TableCell>
                                         <TableCell align="center">
                       <Typography variant="body2" color="text.secondary">
                         {Math.round(profile.days_used || 0)}
                       </Typography>
                     </TableCell>
                                         <TableCell align="center">
                       <Chip 
                         label={Math.round(profile.days_remaining || profile.vacation_days_available || 20)}
                         size="small"
                         color={profile.days_remaining && profile.days_remaining < 5 ? 'warning' : 'success'}
                         variant="outlined"
                       />
                     </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2" color="text.secondary">
                        {profile.reset_date ? dayjs(profile.reset_date).format('MMM D, YYYY') : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {editingProfile === profile.id ? (
                        <Box display="flex" gap={1}>
                          <Tooltip title="Save">
                            <IconButton
                              color="success"
                              size="small"
                              onClick={handleSaveProfile}
                              disabled={processing}
                            >
                              <SaveIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Cancel">
                            <IconButton
                              color="error"
                              size="small"
                              onClick={handleCancelEdit}
                              disabled={processing}
                            >
                              <CancelIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ) : (
                        <Tooltip title="Edit Vacation Days">
                          <IconButton
                            color="primary"
                            size="small"
                            onClick={() => handleEditProfile(profile)}
                          >
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {/* Settings Dialog */}
        <Dialog 
          open={settingsDialogOpen} 
          onClose={() => setSettingsDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" alignItems="center">
              <SettingsIcon sx={{ mr: 1 }} />
              Vacation Reset Settings
            </Box>
          </DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 2 }}>
                             <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                 Set the date when vacation days will reset for all employees. This date will be the same for everyone and will repeat on the same month and day every year (e.g., January 1st, July 1st, etc.).
               </Typography>
              
              <DatePicker
                label="Reset Date"
                value={resetDate}
                onChange={(newValue) => setResetDate(newValue)}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    size: 'small'
                  }
                }}
              />
              
                             {resetDate && (
                 <Alert severity="info" sx={{ mt: 2 }}>
                   Vacation days will reset on {resetDate.format('MMMM D')} every year for all employees.
                 </Alert>
               )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setSettingsDialogOpen(false)}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSettings}
              disabled={processing || !resetDate}
              variant="contained"
            >
              {processing ? 'Saving...' : 'Save Settings'}
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </LocalizationProvider>
  );
};

export default VacationDaysManagementPage;
