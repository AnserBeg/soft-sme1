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
  Alert,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
  Card,
  CardContent
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  CalendarToday as CalendarIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Today as TodayIcon,
  AccessTime as AccessTimeIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { leaveManagementApi, LeaveRequest, Profile } from '../services/leaveManagementService';

const LeaveManagementPageNoDatePicker: React.FC = () => {
  const { user } = useAuth();
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>

      <Typography variant="h4" component="h1" gutterBottom>
        Leave Management
        {user.access_role === 'Admin' ? ' (Admin)' : ' (View Only)'}
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        {user.access_role === 'Admin' 
          ? 'Manage employee leave requests and view the company leave calendar'
          : 'View employee leave requests and company leave calendar'
        }
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Leave Requests Table */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              <AccessTimeIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              All Leave Requests
              {user.access_role !== 'Admin' && (
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                  View-only mode. Admin actions are restricted to administrators.
                </Typography>
              )}
            </Typography>
            
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
                  {leaveRequests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">
                          No leave requests found
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    leaveRequests.map((request) => (
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
                            {new Date(request.start_date).toLocaleDateString()}
                          </Typography>
                          <Typography variant="body2">
                            to {new Date(request.end_date).toLocaleDateString()}
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
                              <Tooltip title="Admin Actions Available">
                                <IconButton color="info" size="small">
                                  <CalendarIcon />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default LeaveManagementPageNoDatePicker;

