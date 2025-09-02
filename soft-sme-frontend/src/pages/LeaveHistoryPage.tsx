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
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Divider
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  History as HistoryIcon,
  Person as PersonIcon,
  CalendarToday as CalendarIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { leaveManagementApi, LeaveHistoryProfile, LeaveStatistics } from '../services/leaveManagementService';
import dayjs from 'dayjs';

const LeaveHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const [leaveHistory, setLeaveHistory] = useState<LeaveHistoryProfile[]>([]);
  const [statistics, setStatistics] = useState<LeaveStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.access_role === 'Admin' || user?.access_role === 'Time Tracking') {
      fetchLeaveHistory();
    }
  }, [user]);

  const fetchLeaveHistory = async () => {
    try {
      setLoading(true);
      const [historyData, statsData] = await Promise.all([
        leaveManagementApi.getLeaveHistory(),
        leaveManagementApi.getLeaveStatistics()
      ]);
      setLeaveHistory(historyData || []);
      setStatistics(statsData);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching leave history:', err);
      setError(err.response?.data?.message || 'Failed to load leave history. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getMonthName = (monthKey: string) => {
    return dayjs(monthKey + '-01').format('MMMM YYYY');
  };

  const getLeaveTypeColor = (type: string) => {
    const colors: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
      vacation: 'success',
      sick: 'error',
      personal: 'info',
      bereavement: 'warning'
    };
    return colors[type] || 'default';
  };

  const getLeaveTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      vacation: 'Vacation',
      sick: 'Sick',
      personal: 'Personal',
      bereavement: 'Bereavement'
    };
    return labels[type] || type;
  };

  const calculateTotalDays = (profile: LeaveHistoryProfile) => {
    let total = 0;
    Object.values(profile.months).forEach(month => {
      total += month.total_days;
    });
    return total;
  };

  const getMonthKeys = () => {
    const keys = new Set<string>();
    leaveHistory.forEach(profile => {
      Object.keys(profile.months).forEach(key => keys.add(key));
    });
    return Array.from(keys).sort().reverse(); // Most recent first
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

  const monthKeys = getMonthKeys();

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        <HistoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        Leave History (Past 12 Months)
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        View leave history for all employees over the past 12 months
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {leaveHistory.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <HistoryIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Leave History Found
          </Typography>
          <Typography color="text.secondary">
            No approved leave requests found in the past 12 months.
          </Typography>
        </Paper>
      ) : (
        <Box>
          {/* Summary Cards */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center">
                    <PersonIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                    <Box>
                      <Typography variant="h4" component="div">
                        {statistics?.employees_with_leave_this_month || 0}
                      </Typography>
                      <Typography color="text.secondary">
                        Employees with Leave This Month
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center">
                    <CalendarIcon sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                    <Box>
                      <Typography variant="h4" component="div">
                        {statistics?.total_days_this_month || 0}
                      </Typography>
                      <Typography color="text.secondary">
                        Total Days of Leave This Month
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center">
                    <TrendingUpIcon sx={{ fontSize: 40, color: 'info.main', mr: 2 }} />
                    <Box>
                      <Typography variant="h4" component="div">
                        {statistics?.total_days_past_12_months || 0}
                      </Typography>
                      <Typography color="text.secondary">
                        Total Days of Leave (Past 12 Months)
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Employee Details */}
          {leaveHistory.map((profile) => (
            <Accordion key={profile.profile_id} sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                  <Box>
                    <Typography variant="h6">
                      {profile.profile_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {profile.profile_email}
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Typography variant="body2" color="text.secondary">
                      Total: {calculateTotalDays(profile).toFixed(1)} days
                    </Typography>
                    <Chip 
                      label={`${Object.keys(profile.months).length} months`} 
                      size="small" 
                      variant="outlined"
                    />
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 'bold' }}>Month</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>Vacation</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>Sick</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>Personal</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>Bereavement</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>Total</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {monthKeys.map((monthKey) => {
                        const monthData = profile.months[monthKey];
                        if (!monthData || monthData.total_days === 0) {
                          return null; // Don't show months with no leave
                        }
                        
                        return (
                          <TableRow key={monthKey} hover>
                            <TableCell sx={{ fontWeight: 'medium' }}>
                              {getMonthName(monthKey)}
                            </TableCell>
                            <TableCell align="center">
                              {monthData.vacation_days > 0 ? (
                                <Chip 
                                  label={monthData.vacation_days} 
                                  size="small" 
                                  color="success"
                                  variant="outlined"
                                />
                              ) : '-'}
                            </TableCell>
                            <TableCell align="center">
                              {monthData.sick_days > 0 ? (
                                <Chip 
                                  label={monthData.sick_days} 
                                  size="small" 
                                  color="error"
                                  variant="outlined"
                                />
                              ) : '-'}
                            </TableCell>
                            <TableCell align="center">
                              {monthData.personal_days > 0 ? (
                                <Chip 
                                  label={monthData.personal_days} 
                                  size="small" 
                                  color="info"
                                  variant="outlined"
                                />
                              ) : '-'}
                            </TableCell>
                            <TableCell align="center">
                              {monthData.bereavement_days > 0 ? (
                                <Chip 
                                  label={monthData.bereavement_days} 
                                  size="small" 
                                  color="warning"
                                  variant="outlined"
                                />
                              ) : '-'}
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                {monthData.total_days}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}
    </Container>
  );
};

export default LeaveHistoryPage;
