import React, { useState, useEffect } from 'react';
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
  Chip,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  CardHeader,
  Divider
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  CalendarToday as CalendarIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Today as TodayIcon,
  Person as PersonIcon,
  Event as EventIcon,
  AccessTime as AccessTimeIcon,
  History as HistoryIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { leaveManagementApi, LeaveRequest, Profile } from '../services/leaveManagementService';
import { useNavigate } from 'react-router-dom';

const LeaveManagementPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentWeekStart, setCurrentWeekStart] = useState<Dayjs>(() => {
    const now = dayjs();
    const dayOfWeek = now.day();
    return now.subtract(dayOfWeek, 'day').startOf('day');
  });

  // Admin action modal state
  const [adminModal, setAdminModal] = useState<{
    open: boolean;
    requestId: number;
    action: 'approve' | 'deny' | 'propose';
    currentDays?: number;
  }>({ open: false, requestId: 0, action: 'approve' });
  const [adminNotes, setAdminNotes] = useState('');
  const [proposedStartDate, setProposedStartDate] = useState<Dayjs | null>(null);
  const [proposedEndDate, setProposedEndDate] = useState<Dayjs | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(true);

  useEffect(() => {
    console.log('LeaveManagementPage - User data:', user);
    if (user?.access_role === 'Admin' || user?.access_role === 'Time Tracking') {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      console.log('LeaveManagementPage - Fetching data...');
      setLoading(true);
      const [requestsData, profilesData] = await Promise.all([
        leaveManagementApi.getAllRequests(),
        leaveManagementApi.getProfiles()
      ]);
      
      console.log('LeaveManagementPage - Data received:', { requestsData, profilesData });
      setLeaveRequests(requestsData || []);
      setProfiles(profilesData || []);
      setError(null);
    } catch (err: any) {
      console.error('LeaveManagementPage - Error fetching data:', err);
      setError(err.response?.data?.message || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Calendar helper functions
  const getWeekDays = (): Array<{ date: Dayjs; isToday: boolean; hasTimeOff: boolean; timeOffProfiles: string[] }> => {
    const days = [];
    const today = dayjs();
    
    for (let i = 0; i < 7; i++) {
      const date = currentWeekStart.add(i, 'day');
      const isToday = date.isSame(today, 'day');
      
      // Check if anyone has time off on this day
      const timeOffProfiles = leaveRequests
        .filter(request => {
          if (request.status !== 'approved') return false;
          const startDate = dayjs(request.start_date);
          const endDate = dayjs(request.end_date);
          return (startDate.isSame(date, 'day') || startDate.isBefore(date)) && 
                 (endDate.isSame(date, 'day') || endDate.isAfter(date));
        })
        .map(request => request.profile_name);
      
      days.push({
        date,
        isToday,
        hasTimeOff: timeOffProfiles.length > 0,
        timeOffProfiles
      });
    }
    
    return days;
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      setCurrentWeekStart(prev => prev.subtract(7, 'day'));
    } else {
      setCurrentWeekStart(prev => prev.add(7, 'day'));
    }
  };

  const goToCurrentWeek = () => {
    const now = dayjs();
    const dayOfWeek = now.day();
    setCurrentWeekStart(now.subtract(dayOfWeek, 'day').startOf('day'));
  };

  // Get profiles with time off in the current week
  const getProfilesWithTimeOff = () => {
    const weekEnd = currentWeekStart.add(6, 'day');
    
    return leaveRequests
      .filter(request => {
        if (request.status !== 'approved') return false;
        const startDate = dayjs(request.start_date);
        const endDate = dayjs(request.end_date);
        return (startDate.isSame(weekEnd, 'day') || startDate.isBefore(weekEnd)) && 
               (endDate.isSame(currentWeekStart, 'day') || endDate.isAfter(currentWeekStart));
      })
      .map(request => ({
        profileName: request.profile_name,
        startDate: dayjs(request.start_date),
        endDate: dayjs(request.end_date),
        requestType: request.request_type,
        reason: request.reason
      }))
      .sort((a, b) => a.startDate.valueOf() - b.startDate.valueOf());
  };

  // Get current month's leave information
  const getCurrentMonthLeaveInfo = () => {
    const now = dayjs();
    const monthStart = now.startOf('month');
    const monthEnd = now.endOf('month');
    
    const monthLeaveRequests = leaveRequests
      .filter(request => {
        if (request.status !== 'approved') return false;
        const startDate = dayjs(request.start_date);
        const endDate = dayjs(request.end_date);
        return (startDate.isSame(monthEnd, 'day') || startDate.isBefore(monthEnd)) && 
               (endDate.isSame(monthStart, 'day') || endDate.isAfter(monthStart));
      })
      .map(request => ({
        profileName: request.profile_name,
        startDate: dayjs(request.start_date),
        endDate: dayjs(request.end_date),
        requestType: request.request_type
      }))
      .sort((a, b) => a.startDate.valueOf() - b.startDate.valueOf());

    return monthLeaveRequests;
  };

  // Format leave information for display
  const formatLeaveInfo = () => {
    const monthLeave = getCurrentMonthLeaveInfo();
    
    if (monthLeave.length === 0) {
      return "No employees on leave this month";
    }
    
    // Group by employee and format their leave periods
    const employeeLeaveMap = new Map();
    
    monthLeave.forEach(leave => {
      if (!employeeLeaveMap.has(leave.profileName)) {
        employeeLeaveMap.set(leave.profileName, []);
      }
      employeeLeaveMap.get(leave.profileName).push(leave);
    });
    
    const formattedLeave = Array.from(employeeLeaveMap.entries()).map(([name, leaves]) => {
      const leavePeriods = leaves.map(leave => {
        const startStr = leave.startDate.format('MMM D');
        const endStr = leave.endDate.format('MMM D');
        return `${startStr}-${endStr}`;
      }).join(', ');
      
      return `${name}: ${leavePeriods}`;
    });
    
    return formattedLeave.slice(0, 3).join(' • '); // Show first 3 employees
  };

  const handleAdminAction = (requestId: number, action: 'approve' | 'deny' | 'propose') => {
    setAdminModal({ open: true, requestId, action });
    setAdminNotes('');
    setProposedStartDate(null);
    setProposedEndDate(null);
  };

  const submitAdminAction = async () => {
    setProcessing(true);
    try {
      const { requestId, action } = adminModal;
      
      if (action === 'approve') {
        await leaveManagementApi.approveRequest(
          requestId, 
          adminNotes, 
          proposedStartDate?.format('YYYY-MM-DD'), 
          proposedEndDate?.format('YYYY-MM-DD')
        );
      } else if (action === 'deny') {
        await leaveManagementApi.denyRequest(requestId, adminNotes);
      } else if (action === 'propose') {
        if (!proposedStartDate || !proposedEndDate) {
          setError('Please enter both start and end dates');
          setProcessing(false);
          return;
        }
        
        if (proposedEndDate.isBefore(proposedStartDate)) {
          setError('End date cannot be before start date');
          setProcessing(false);
          return;
        }
        
        await leaveManagementApi.proposeVacationDates(
          requestId, 
          proposedStartDate.format('YYYY-MM-DD'), 
          proposedEndDate.format('YYYY-MM-DD'), 
          adminNotes
        );
      }
      
      setAdminModal({ open: false, requestId: 0, action: 'approve' });
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Action failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const getStatusChip = (status: string) => {
    const statusConfig: Record<string, { color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'; label: string }> = {
      pending: { color: 'warning', label: 'Pending' },
      approved: { color: 'success', label: 'Approved' },
      denied: { color: 'error', label: 'Denied' },
      modified: { color: 'info', label: 'Modified' }
    };
    
    const config = statusConfig[status] || { color: 'default', label: status };
    return <Chip label={config.label} color={config.color} size="small" />;
  };

  const getRequestTypeLabel = (type: string) => {
    const typeLabels: Record<string, string> = {
      vacation: 'Vacation',
      sick: 'Sick Day',
      personal: 'Personal',
      bereavement: 'Bereavement'
    };
    return typeLabels[type] || type;
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

  if (user.access_role !== 'Admin' && user.access_role !== 'Time Tracking') {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">
          Access denied. Admin or Time Tracking privileges required to view this page.
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

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>

        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            Leave Management
            {user.access_role === 'Admin' ? ' (Admin)' : ' (View Only)'}
          </Typography>
          <Box display="flex" gap={2}>
            <Button
              variant="outlined"
              startIcon={<HistoryIcon />}
              onClick={() => navigate('/leave-history')}
            >
              View History
            </Button>
            <Button
              variant="outlined"
              startIcon={<SettingsIcon />}
              onClick={() => navigate('/vacation-days-management')}
            >
              Manage Vacation Days
            </Button>
          </Box>
        </Box>
        <Typography variant="body1" color="text.secondary" paragraph>
          {formatLeaveInfo()}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* Weekly Calendar View */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h6">
                  <CalendarIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Weekly Leave Schedule
                </Typography>
                <Box display="flex" gap={1}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigateWeek('prev')}
                    startIcon={<NavigateBeforeIcon />}
                  >
                    Previous Week
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={goToCurrentWeek}
                    startIcon={<TodayIcon />}
                  >
                    Today
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigateWeek('next')}
                    endIcon={<NavigateNextIcon />}
                  >
                    Next Week
                  </Button>
                </Box>
              </Box>
              
              <Typography variant="body2" color="text.secondary" mb={3}>
                Week of {currentWeekStart.format('MMMM D, YYYY')}
              </Typography>

              {/* Calendar Table */}
              <Box sx={{ overflowX: 'auto' }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 'bold', minWidth: 140 }}>
                          Employee Name
                        </TableCell>
                        {getWeekDays().map((day, index) => (
                          <TableCell key={index} align="center" sx={{ fontWeight: 'bold', minWidth: 70 }}>
                            <Box>
                              <Typography variant="caption" display="block" sx={{ fontWeight: 'bold' }}>
                                {day.date.format('ddd')}
                              </Typography>
                              <Typography variant="body2">
                                {day.date.format('MMM D')}
                              </Typography>
                              {day.isToday && (
                                <Typography variant="caption" display="block" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                                  Today
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {/* Only show rows for employees who have approved time off in this week */}
                      {getProfilesWithTimeOff().map((profile, index) => (
                        <TableRow key={index} hover>
                          <TableCell sx={{ fontWeight: 'medium' }}>
                            {profile.profileName}
                          </TableCell>
                          {getWeekDays().map((day, dayIndex) => {
                            const isOffOnThisDay = (profile.startDate.isSame(day.date, 'day') || profile.startDate.isBefore(day.date)) && 
                                                   (profile.endDate.isSame(day.date, 'day') || profile.endDate.isAfter(day.date));
                            return (
                              <TableCell 
                                key={dayIndex} 
                                align="center"
                                sx={{
                                  backgroundColor: isOffOnThisDay ? 'error.light' : 'inherit',
                                  color: isOffOnThisDay ? 'error.dark' : 'text.primary',
                                  fontWeight: isOffOnThisDay ? 'medium' : 'normal'
                                }}
                              >
                                {isOffOnThisDay ? (
                                  <Box>
                                    <Typography variant="caption" display="block" sx={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                                      {getRequestTypeLabel(profile.requestType)}
                                    </Typography>
                                    {profile.reason && (
                                      <Tooltip title={profile.reason}>
                                        <Typography variant="caption" sx={{ opacity: 0.75 }}>
                                          {profile.reason.length > 8 ? profile.reason.substring(0, 8) + '...' : profile.reason}
                                        </Typography>
                                      </Tooltip>
                                    )}
                                  </Box>
                                ) : (
                                  <Typography variant="body2" color="text.secondary">
                                    -
                                  </Typography>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                      
                      {/* Show empty row when no employees are off */}
                      {getProfilesWithTimeOff().length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                            <Box sx={{ textAlign: 'center' }}>
                              <CalendarIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                              <Typography color="text.secondary">
                                No employees on leave this week
                              </Typography>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Paper>
          </Grid>

          {/* Leave Requests Table */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h6">
                  <AccessTimeIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Leave Requests
                  {user.access_role !== 'Admin' && (
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                      View-only mode. Admin actions are restricted to administrators.
                    </Typography>
                  )}
                </Typography>
                
                {/* Toggle for Pending vs All Requests */}
                <Box display="flex" alignItems="center" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    Show:
                  </Typography>
                  <Button
                    variant={showPendingOnly ? "contained" : "outlined"}
                    size="small"
                    onClick={() => setShowPendingOnly(true)}
                    sx={{ minWidth: 100 }}
                  >
                    Pending
                  </Button>
                  <Button
                    variant={!showPendingOnly ? "contained" : "outlined"}
                    size="small"
                    onClick={() => setShowPendingOnly(false)}
                    sx={{ minWidth: 100 }}
                  >
                    All
                  </Button>
                </Box>
              </Box>
              
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Employee</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Dates</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Days</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Reason</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Admin Notes</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(() => {
                      const filteredRequests = showPendingOnly 
                        ? leaveRequests.filter(request => request.status === 'pending')
                        : leaveRequests;
                      
                      if (filteredRequests.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                              <Typography color="text.secondary">
                                {showPendingOnly ? 'No pending leave requests found' : 'No leave requests found'}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      
                      return filteredRequests.map((request) => (
                        <TableRow key={request.request_id} hover>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                {request.profile_name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {request.user_email}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={getRequestTypeLabel(request.request_type)} 
                              size="small" 
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {dayjs(request.start_date).format('MMM D, YYYY')}
                            </Typography>
                            <Typography variant="body2">
                              to {dayjs(request.end_date).format('MMM D, YYYY')}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {request.total_days} day{request.total_days !== 1 ? 's' : ''}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {getStatusChip(request.status)}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 200 }}>
                              {request.reason || '-'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 200 }}>
                              {request.admin_notes || '-'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {request.status === 'pending' && user.access_role === 'Admin' && (
                              <Box display="flex" gap={1}>
                                <Tooltip title="Approve Request">
                                  <IconButton
                                    color="success"
                                    size="small"
                                    onClick={() => handleAdminAction(request.request_id, 'approve')}
                                  >
                                    <CheckCircleIcon />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Deny Request">
                                  <IconButton
                                    color="error"
                                    size="small"
                                    onClick={() => handleAdminAction(request.request_id, 'deny')}
                                  >
                                    <CancelIcon />
                                  </IconButton>
                                </Tooltip>
                                {(request.request_type === 'vacation' || request.request_type === 'personal' || request.request_type === 'bereavement') && (
                                  <Tooltip title="Propose Dates">
                                    <IconButton
                                      color="info"
                                      size="small"
                                      onClick={() => handleAdminAction(request.request_id, 'propose')}
                                    >
                                      <CalendarIcon />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            )}
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
        </Grid>

        {/* Admin Action Modal */}
        <Dialog 
          open={adminModal.open} 
          onClose={() => setAdminModal({ open: false, requestId: 0, action: 'approve' })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {adminModal.action === 'approve' ? 'Approve Request' : 
             adminModal.action === 'deny' ? 'Deny Request' : 'Propose Dates'}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 2 }}>
              {/* Date Input for Propose/Approve */}
              {(adminModal.action === 'propose' || adminModal.action === 'approve') && (
                <Box sx={{ mb: 3 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <DatePicker
                        label={adminModal.action === 'propose' ? 'Proposed Start Date' : 'Proposed Start Date (Optional)'}
                        value={proposedStartDate}
                        onChange={(newValue) => setProposedStartDate(newValue)}
                        slotProps={{
                          textField: {
                            fullWidth: true,
                            size: 'small'
                          }
                        }}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <DatePicker
                        label={adminModal.action === 'propose' ? 'Proposed End Date' : 'Proposed End Date (Optional)'}
                        value={proposedEndDate}
                        onChange={(newValue) => setProposedEndDate(newValue)}
                        minDate={proposedStartDate}
                        disabled={!proposedStartDate}
                        slotProps={{
                          textField: {
                            fullWidth: true,
                            size: 'small'
                          }
                        }}
                      />
                    </Grid>
                  </Grid>
                </Box>
              )}
              
              {/* Admin Notes */}
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Admin Notes"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add notes about this decision..."
                variant="outlined"
                size="small"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setAdminModal({ open: false, requestId: 0, action: 'approve' })}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              onClick={submitAdminAction}
              disabled={processing}
              variant="contained"
              color={adminModal.action === 'deny' ? 'error' : 'primary'}
            >
              {processing ? 'Processing...' : 
               adminModal.action === 'approve' ? 'Approve' :
               adminModal.action === 'deny' ? 'Deny' : 'Propose'}
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </LocalizationProvider>
  );
};

export default LeaveManagementPage;
