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
  TextField,
  IconButton
} from '@mui/material';
import { Add as AddIcon, GetApp as GetAppIcon, PictureAsPdf as PictureAsPdfIcon } from '@mui/icons-material';
import { getProfiles, createProfile, Profile } from '../services/timeTrackingService';
import { Delete as DeleteIcon } from '@mui/icons-material';
import api from '../api/axios';
import { toast } from 'react-toastify';
import { getShifts, clockInShift, clockOutShift, getActiveShift } from '../services/attendanceService';
import { useAuth } from '../contexts/AuthContext';

interface ShiftEntry {
  id: number;
  profile_id: number;
  clock_in: string;
  clock_out: string | null;
  duration?: number;
}

interface ActiveShift extends ShiftEntry {
  profile_name: string;
}

const AttendancePage: React.FC = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);
  const [activeShifts, setActiveShifts] = useState<ActiveShift[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openProfileDialog, setOpenProfileDialog] = useState(false);
  const [newProfile, setNewProfile] = useState({ name: '', email: '' });

  const [showUnclosedWarning, setShowUnclosedWarning] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimeoutRef = useRef<number | null>(null);

  const formatErrorMessage = (err: any, fallback: string) => {
    return (
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      fallback
    );
  };

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
      fetchShifts();
    } else {
      setShifts([]);
    }
  }, [selectedProfile]);

  useEffect(() => {
    const interval = setInterval(() => {
      setShifts(prev =>
        prev.map(entry => {
          if (!entry.clock_out) {
            const now = new Date();
            const clockIn = new Date(entry.clock_in);
            const duration = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
            return { ...entry, duration };
          }
          return entry;
        })
      );
      setActiveShifts(prev =>
        prev.map(entry => {
          if (!entry.clock_out) {
            const now = new Date();
            const clockIn = new Date(entry.clock_in);
            const duration = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
            return { ...entry, duration };
          }
          return entry;
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const profilesData = await getProfiles();
      setProfiles(profilesData);
      fetchActiveShifts(profilesData);
      setError(null);
    } catch (err) {
      setError('Failed to fetch data. Please try again.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchShifts = async () => {
    if (!selectedProfile) return;
    try {
      const shiftEntries = await getShifts(selectedProfile as number);
      setShifts(shiftEntries);
      // Check for unclosed shift from previous day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const unclosed = shiftEntries.find(entry => !entry.clock_out && new Date(entry.clock_in).toDateString() !== new Date().toDateString());
      setShowUnclosedWarning(!!unclosed);
    } catch (err) {
      setError('Failed to fetch shifts. Please try again.');
      console.error('Error fetching shifts:', err);
    }
  };

  const fetchActiveShifts = async (profileList?: Profile[]) => {
    const list = profileList || profiles;
    if (!list.length) {
      setActiveShifts([]);
      return;
    }
    try {
      setActiveLoading(true);
      const entries: ActiveShift[] = [];
      await Promise.all(
        list.map(async (profile) => {
          try {
            const active = await getActiveShift(profile.id);
            if (active) {
              entries.push({
                ...active,
                profile_name: profile.name
              });
            }
          } catch (err) {
            console.error(`Failed to fetch active shift for profile ${profile.id}`, err);
          }
        })
      );
      setActiveShifts(entries);
    } catch (err) {
      console.error('Error fetching active shifts:', err);
    } finally {
      setActiveLoading(false);
    }
  };

  const handleClockIn = async () => {
    if (!selectedProfile) {
      setError('Please select a profile');
      return;
    }
    // Prevent multiple open shifts
    if (shifts.some(entry => !entry.clock_out)) {
      setError('You are already clocked in. Please clock out first.');
      return;
    }
    try {
      setSuccessMessage(null);
      const newShift = await clockInShift(selectedProfile as number);
      setShifts([newShift, ...shifts]);
      setError(null);
      // Reset profile selection without reloading page
      setSelectedProfile('');
      setShifts([]);
      showSuccess('Successfully clocked in.');
      fetchActiveShifts();
    } catch (err) {
      setSuccessMessage(null);
      setError(formatErrorMessage(err, 'Failed to clock in. Please try again.'));
      console.error('Error clocking in:', err);
    }
  };

  const handleClockOut = async (id: number) => {
    try {
      setSuccessMessage(null);
      const updatedShift = await clockOutShift(id);
      setShifts(shifts.map(entry => entry.id === id ? updatedShift : entry));
      setError(null);
      // Reset profile selection without reloading page
      setSelectedProfile('');
      setShifts([]);
      showSuccess('Successfully clocked out.');
      fetchActiveShifts();
    } catch (err) {
      setSuccessMessage(null);
      setError(formatErrorMessage(err, 'Failed to clock out. Please try again.'));
      console.error('Error clocking out:', err);
    }
  };

  const handleCreateProfile = async () => {
    try {
      const profile = await createProfile(newProfile.name, newProfile.email);
      setProfiles([...profiles, profile]);
      setOpenProfileDialog(false);
      setNewProfile({ name: '', email: '' });
      setError(null);
    } catch (err) {
      setError('Failed to create profile. Please try again.');
      console.error('Error creating profile:', err);
    }
  };





  const handleExportCSV = () => {
    // Dummy: Replace with real export logic
    alert('Export CSV not implemented');
  };

  const handleExportPDF = () => {
    // Dummy: Replace with real export logic
    alert('Export PDF not implemented');
  };

  const isProfileClockedIn = selectedProfile && shifts.some(entry => entry.profile_id === selectedProfile && !entry.clock_out);

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
        Attendance (Shift Tracking)
      </Typography>

      {error && (
        <Alert severity="error" variant="filled" sx={{ mb: 2, fontSize: '1.1rem', fontWeight: 700, py: 2 }}>
          {error}
        </Alert>
      )}
      {showUnclosedWarning && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You have an unclosed shift from a previous day. Please clock out before starting a new shift.
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
        {/* Profile Selection */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Profile</Typography>
              {user?.access_role !== 'Time Tracking' && (
                <Button
                  startIcon={<AddIcon />}
                  onClick={() => setOpenProfileDialog(true)}
                >
                  Add Profile
                </Button>
              )}
            </Box>
            <FormControl fullWidth>
              <InputLabel>Select Profile</InputLabel>
              <Select
                value={selectedProfile}
                label="Select Profile"
                onChange={(e) => setSelectedProfile(e.target.value as number)}
                sx={{ '& .MuiSelect-select': { fontSize: '1.25rem', py: 1.5, minHeight: 56 } }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      '& .MuiMenuItem-root': { fontSize: '1.25rem', py: 1.5, minHeight: 56 },
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
                renderValue={(val) => {
                  const p = profiles.find(pr => pr.id === val);
                  return p ? p.name : '';
                }}
              >
                {profiles.map((profile) => (
                  <MenuItem key={profile.id} value={profile.id} sx={{ fontSize: '1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{profile.name}</span>
                    {user?.access_role === 'Admin' && (
                      <IconButton
                        aria-label={`Delete ${profile.name}`}
                        size="small"
                        edge="end"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const ok = window.confirm(`Delete profile "${profile.name}"? This cannot be undone.`);
                          if (!ok) return;
                          try {
                            await api.delete(`/api/time-tracking/profiles/${profile.id}`);
                            setProfiles(prev => prev.filter(pr => pr.id !== profile.id));
                            if (selectedProfile === profile.id) setSelectedProfile('');
                            toast.success('Profile deleted');
                          } catch (err: any) {
                            const msg = err?.response?.data?.error || 'Failed to delete profile';
                            toast.error(msg);
                          }
                        }}
                        sx={{ ml: 2, color: 'error.main' }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>
        </Grid>

        {/* Clock Controls - Only show if profile is selected */}
        {selectedProfile && !isProfileClockedIn && (
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
                >
                  Clock In
                </Button>
              </Box>
            </Paper>
          </Grid>
        )}

        {/* Shift Entries Table - Only show if profile is selected */}
        {selectedProfile && (
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" gutterBottom>
                  Shift History for {profiles.find(p => p.id === selectedProfile)?.name}
                </Typography>
              </Box>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Clock In</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Clock Out</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Duration</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shifts.map((entry) => {
                      const clockIn = new Date(entry.clock_in);
                      const clockOut = entry.clock_out ? new Date(entry.clock_out) : null;
                      // Use stored duration from database (which includes break deductions) instead of calculating raw duration
                      const duration = entry.duration !== null && entry.duration !== undefined ? Number(entry.duration) : null;
                      return (
                        <TableRow key={entry.id}>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{clockIn.toLocaleString()}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{clockOut ? clockOut.toLocaleString() : '-'}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{duration !== null ? `${duration.toFixed(2)} hrs` : '-'}</TableCell>
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
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
        )}

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Active Clock Ins</Typography>
              {activeLoading && <CircularProgress size={24} />}
            </Box>
            {activeShifts.length === 0 && !activeLoading ? (
              <Typography color="text.secondary">No active clock ins.</Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Profile</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Clock In</TableCell>
                      <TableCell sx={{ fontSize: '1.1rem' }}>Duration</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activeShifts.map((entry) => {
                      const duration = entry.duration !== null && entry.duration !== undefined ? Number(entry.duration) : null;
                      return (
                        <TableRow key={entry.id}>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{entry.profile_name}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{new Date(entry.clock_in).toLocaleString()}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{duration !== null ? `${duration.toFixed(2)} hrs` : '-'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Add Profile Dialog */}
      <Dialog open={openProfileDialog} onClose={() => setOpenProfileDialog(false)}>
        <DialogTitle>Add Profile</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={newProfile.name}
            onChange={e => setNewProfile({ ...newProfile, name: e.target.value })}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Email"
            value={newProfile.email}
            onChange={e => setNewProfile({ ...newProfile, email: e.target.value })}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenProfileDialog(false)}>Cancel</Button>
          <Button onClick={handleCreateProfile} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>


    </Container>
  );
};

export default AttendancePage; 
