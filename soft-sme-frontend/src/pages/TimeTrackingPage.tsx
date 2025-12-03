import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField
} from '@mui/material';

import {
  getProfiles,
  getSalesOrders,
  updateSalesOrderRate,
  getTimeEntries,
  getOpenTimeEntries,
  clockIn,
  clockOut,
  Profile,
  SalesOrder,
  TimeEntry,
  formatDurationDisplay
} from '../services/timeTrackingService';
import { useAuth } from '../contexts/AuthContext';



const TimeTrackingPage: React.FC = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimeEntries, setActiveTimeEntries] = useState<TimeEntry[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | ''>('');
  const [selectedSO, setSelectedSO] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimeoutRef = useRef<number | null>(null);

  const showSuccess = (message: string) => {
    if (successTimeoutRef.current) {
      window.clearTimeout(successTimeoutRef.current);
    }
    setSuccessMessage(message);
    successTimeoutRef.current = window.setTimeout(() => {
      setSuccessMessage(null);
      successTimeoutRef.current = null;
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  


  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      fetchTimeEntries();
    } else {
      setTimeEntries([]);
    }
  }, [selectedProfile]);

  // Add interval for real-time duration updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeEntries(prevEntries => 
        prevEntries.map(entry => {
          if (!entry.clock_out) {
            const now = new Date();
            const clockIn = new Date(entry.clock_in);
            const duration = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60); // in hours
            return { ...entry, duration };
          }
          return entry;
        })
      );
      setActiveTimeEntries(prevEntries =>
        prevEntries.map(entry => {
          if (!entry.clock_out) {
            const now = new Date();
            const clockIn = new Date(entry.clock_in);
            const duration = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60); // in hours
            return { ...entry, duration };
          }
          return entry;
        })
      );
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [profilesData, salesOrdersData] = await Promise.all([
        getProfiles(),
        getSalesOrders()
      ]);
      console.log('Sales orders data received:', salesOrdersData);
      setProfiles(profilesData);
      setSalesOrders(salesOrdersData);
      fetchActiveTimeEntries(profilesData);
      setError(null);
    } catch (err) {
      setError('Failed to fetch data. Please try again.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTimeEntries = async () => {
    if (!selectedProfile) return;
    try {
      const [todayEntries, openEntries] = await Promise.all([
        getTimeEntries(new Date().toISOString().split('T')[0], selectedProfile),
        getOpenTimeEntries(selectedProfile)
      ]);
      // Merge, removing duplicates by id
      const allEntriesMap = new Map();
      [...todayEntries, ...openEntries].forEach(entry => {
        allEntriesMap.set(entry.id, entry);
      });
      setTimeEntries(Array.from(allEntriesMap.values()));
    } catch (err) {
      setError('Failed to fetch time entries. Please try again.');
      console.error('Error fetching time entries:', err);
    }
  };

  const fetchActiveTimeEntries = async (profileList?: Profile[]) => {
    const list = profileList || profiles;
    if (!list.length) {
      setActiveTimeEntries([]);
      return;
    }
    try {
      setActiveLoading(true);
      const entries: TimeEntry[] = [];
      await Promise.all(
        list.map(async (profile) => {
          try {
            const openEntries = await getOpenTimeEntries(profile.id);
            openEntries.forEach((entry) => {
              entries.push({
                ...entry,
                profile_name: profile.name
              });
            });
          } catch (err) {
            console.error(`Failed to fetch open time entries for profile ${profile.id}`, err);
          }
        })
      );
      setActiveTimeEntries(entries);
    } catch (err) {
      console.error('Error fetching active time entries:', err);
    } finally {
      setActiveLoading(false);
    }
  };

  const handleClockIn = async () => {
    if (!selectedProfile || !selectedSO) {
      setError('Please select both a profile and a sales order');
      return;
    }

    // Check if profile is already clocked in for this SO
    const existingEntry = timeEntries.find(
      entry => entry.sales_order_id === selectedSO && !entry.clock_out
    );

    if (existingEntry) {
      setError('You are already clocked in for this sales order');
      return;
    }

    try {
      setSuccessMessage(null);
      const newEntry = await clockIn(selectedProfile, selectedSO);
      setTimeEntries([newEntry, ...timeEntries]);
      // Reset profile selection without reloading page
      setSelectedProfile('');
      setSelectedSO('');
      setTimeEntries([]);
      setError(null);
      showSuccess('Successfully clocked in.');
      fetchActiveTimeEntries();
    } catch (err: any) {
      setSuccessMessage(null);
      if (err.response && err.response.data && err.response.data.error.includes('attendance')) {
        setError('You must clock in for attendance before you can clock in for a sales order.');
      } else {
        setError(err?.message || 'Failed to clock in. Please try again.');
      }
      console.error('Error clocking in:', err);
    }
  };

  const handleClockOut = async (id: number) => {
    try {
      setSuccessMessage(null);
      const updatedEntry = await clockOut(id);
      setTimeEntries(timeEntries.map(entry => 
        entry.id === id ? updatedEntry : entry
      ));
      // Reset profile selection without reloading page
      setSelectedProfile('');
      setSelectedSO('');
      setTimeEntries([]);
      setError(null);
      showSuccess('Successfully clocked out.');
      fetchActiveTimeEntries();
    } catch (err) {
      setSuccessMessage(null);
      setError((err as any)?.message || 'Failed to clock out. Please try again.');
      console.error('Error clocking out:', err);
    }
  };



  



  const isProfileClockedIn = selectedProfile && timeEntries.some(entry => entry.profile_id === selectedProfile && !entry.clock_out);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Time Tracking
      </Typography>

      {error && (
        <Alert severity="error" variant="filled" sx={{ mb: 2, fontSize: '1.1rem', fontWeight: 700, py: 2 }}>
          {error}
        </Alert>
      )}
      <Dialog
        open={Boolean(successMessage)}
        onClose={() => setSuccessMessage(null)}
        PaperProps={{
          sx: {
            px: 6,
            py: 4,
            textAlign: 'center'
          }
        }}
      >
        <DialogTitle sx={{ fontSize: '2rem' }}>Success</DialogTitle>
        <DialogContent>
          <Typography variant="h4" component="p">
            {successMessage}
          </Typography>
        </DialogContent>
      </Dialog>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Active Clock Ins</Typography>
              {activeLoading && <CircularProgress size={24} />}
            </Box>
            {activeTimeEntries.length === 0 && !activeLoading ? (
              <Typography color="text.secondary">No active clock ins.</Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Profile</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Sales Order</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Clock In</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Duration</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activeTimeEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell sx={{ fontSize: '1.1rem' }}>{entry.profile_name || profiles.find(p => p.id === entry.profile_id)?.name || 'Unknown'}</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>{entry.sales_order_number}</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>{new Date(entry.clock_in).toLocaleString()}</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>{formatDurationDisplay(entry.duration)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        {/* Profile Selection */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Profile</Typography>
            </Box>
            <FormControl fullWidth>
              <InputLabel>Select Profile</InputLabel>
              <Select
                value={selectedProfile}
                label="Select Profile"
                onChange={(e) => setSelectedProfile(e.target.value as number)}
                sx={{ '& .MuiSelect-select': { fontSize: '1.2rem', py: 1.25 } }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      '& .MuiMenuItem-root': { fontSize: '1.2rem', py: 1.25 },
                      '& .MuiMenuItem-root.Mui-selected, & .MuiMenuItem-root.Mui-selected:hover': {
                        backgroundColor: 'rgba(25, 118, 210, 0.2)',
                        color: 'primary.main',
                        fontWeight: 700
                      },
                      '& .MuiMenuItem-root:hover': {
                        backgroundColor: 'rgba(25, 118, 210, 0.15)'
                      }
                    }
                  }
                }}
              >
                {profiles.map((profile) => (
                  <MenuItem key={profile.id} value={profile.id} sx={{ fontSize: '1.2rem', py: 1.25 }}>
                    {profile.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>
        </Grid>

        {/* Sales Order Selection - Only show if profile is selected */}
        {selectedProfile && (
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">Sales Order</Typography>
                
              </Box>
              <FormControl fullWidth>
                <InputLabel>Select Sales Order</InputLabel>
                <Select
                  value={selectedSO}
                  label="Select Sales Order"
                  onChange={(e) => setSelectedSO(e.target.value as number)}
                  sx={{ '& .MuiSelect-select': { fontSize: '1.2rem', py: 1.25 } }}
                  MenuProps={{
                    PaperProps: {
                      sx: {
                        '& .MuiMenuItem-root': { fontSize: '1.2rem', py: 1.25, lineHeight: 1.3 },
                        '& .MuiMenuItem-root.Mui-selected, & .MuiMenuItem-root.Mui-selected:hover': {
                          backgroundColor: 'rgba(25, 118, 210, 0.2)',
                          color: 'primary.main',
                          fontWeight: 700
                        },
                        '& .MuiMenuItem-root:hover': {
                          backgroundColor: 'rgba(25, 118, 210, 0.15)'
                        }
                      }
                    }
                  }}
                >
                  {salesOrders.map((so) => {
                    // Check if profile is already clocked in for this SO
                    const isClockedIn = timeEntries.some(
                      entry => entry.sales_order_id === so.id && !entry.clock_out
                    );
                    return (
                      <MenuItem 
                        key={so.id} 
                        value={so.id}
                        disabled={isClockedIn}
                        sx={{ fontSize: '1.1rem' }}
                      >
                        {`${so.number} - ${so.product_name || 'No Product Name'} - ${so.customer_name || 'Unknown Customer'}`}
                        {isClockedIn ? ' - Already Clocked In' : ''}
                        {/* Debug: {JSON.stringify(so)} */}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Paper>
          </Grid>
        )}

        {/* Clock Controls - Only show if both profile and SO are selected */}
        {selectedProfile && selectedSO && (
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Box display="flex" justifyContent="center" gap={2}>
                <Button
                  variant="contained"
                  sx={{ 
                    backgroundColor: 'green',
                    px: 4,
                    py: 2,
                    fontSize: '1.2rem',
                    fontWeight: 700,
                    borderRadius: '12px',
                    minWidth: 220,
                    '&:hover': {
                      backgroundColor: 'darkgreen',
                    }
                  }}
                  onClick={handleClockIn}
                  disabled={isProfileClockedIn}
                >
                  Clock In
                </Button>
              </Box>
            </Paper>
          </Grid>
        )}

        {/* Time Entries Table - Only show if profile is selected */}
        {selectedProfile && (
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Today's Time Entries for {profiles.find(p => p.id === selectedProfile)?.name}
              </Typography>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Sales Order</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Clock In</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Clock Out</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Duration</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {timeEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell sx={{ fontSize: '1.1rem' }}>{entry.sales_order_number}</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>
                          {new Date(entry.clock_in).toLocaleTimeString()}
                        </TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>
                          {entry.clock_out
                            ? new Date(entry.clock_out).toLocaleTimeString()
                            : '-'}
                        </TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>{formatDurationDisplay(entry.duration)}</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>
                          {!entry.clock_out && (
                            <Button
                              variant="contained"
                              sx={{ 
                                backgroundColor: 'red',
                                px: 3,
                                py: 1.5,
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                borderRadius: '12px',
                                '&:hover': {
                                  backgroundColor: 'darkred',
                                }
                              }}
                              onClick={() => handleClockOut(entry.id)}
                            >
                              Clock Out
                            </Button>
                          )}

                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
        )}
      </Grid>


    </Container>
  );
};

export default TimeTrackingPage;
