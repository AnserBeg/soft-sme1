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
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  FormControlLabel
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  getProfiles,
  getSalesOrders,
  getTimeEntryReport,
  exportTimeEntryReport,
  Profile,
  SalesOrder,
  TimeEntryReport,
  updateTimeEntry,
  createTimeEntry
} from '../services/timeTrackingService';
import { getShiftsInRange, updateShift, createShift } from '../services/attendanceService';
import api from '../api/axios';
import { Edit as EditIcon, Save as SaveIcon } from '@mui/icons-material';

// Helper to convert UTC string to local datetime-local input value
function toLocalInputValue(dateString: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}
// Helper to convert local datetime-local input value to UTC ISO string
function toUTCISOString(localValue: string) {
  if (!localValue) return null;
  const local = new Date(localValue);
  return local.toISOString();
}

function normalizeToLocalMidnight(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateAtLocalMidnight(date: Date) {
  const normalized = normalizeToLocalMidnight(date);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, '0');
  const day = String(normalized.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TimeTrackingReportsPage: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [reports, setReports] = useState<TimeEntryReport[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | ''>('');
  const [selectedSO, setSelectedSO] = useState<number | ''>('');
  // Set default date range: from 14 days ago to yesterday (14-day period ending yesterday)
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(yesterday.getDate() - 13); // 14 days before yesterday
  const [fromDate, setFromDate] = useState<Date | null>(fourteenDaysAgo);
  const [toDate, setToDate] = useState<Date | null>(yesterday);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<TimeEntryReport | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editEntryError, setEditEntryError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const [shiftEntries, setShiftEntries] = useState<{ [shiftId: number]: any[] }>({});
  const [unscheduledEntries, setUnscheduledEntries] = useState<any[]>([]);
  const [expandedShift, setExpandedShift] = useState<number | null>(null);
  const [editShift, setEditShift] = useState<any | null>(null);
  const [editShiftClockIn, setEditShiftClockIn] = useState('');
  const [editShiftClockOut, setEditShiftClockOut] = useState('');
  const [savingShift, setSavingShift] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [addEntryShift, setAddEntryShift] = useState<any | null>(null);
  const [addEntrySalesOrder, setAddEntrySalesOrder] = useState<number | ''>('');
  const [addEntryClockIn, setAddEntryClockIn] = useState('');
  const [addEntryClockOut, setAddEntryClockOut] = useState('');
  const [addingEntry, setAddingEntry] = useState(false);
  const [addShiftOpen, setAddShiftOpen] = useState(false);
  const [addShiftProfile, setAddShiftProfile] = useState<number | ''>('');
  const [addShiftClockIn, setAddShiftClockIn] = useState('');
  const [addShiftClockOut, setAddShiftClockOut] = useState('');
  const [savingNewShift, setSavingNewShift] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [profilesData, salesOrdersData] = await Promise.all([
        getProfiles(),
        getSalesOrders()
      ]);
      setProfiles(profilesData);
      setSalesOrders(salesOrdersData);
      setError(null);
    } catch (err) {
      setError('Failed to fetch data. Please try again.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!fromDate || !toDate) {
      setError('Please select a date range');
      return;
    }
    try {
      setLoading(true);
      const startDate = normalizeToLocalMidnight(fromDate);
      const endDateExclusive = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
      const fromDateStr = formatDateAtLocalMidnight(startDate);
      const toDateStr = formatDateAtLocalMidnight(endDateExclusive);
      console.log('Requesting shifts for:', fromDateStr, toDateStr);
      
      // Fetch time entries for the selected sales order
      const timeEntriesParams: any = {
        from_date: fromDateStr,
        to_date: toDateStr
      };
      if (selectedProfile) timeEntriesParams.profile_id = selectedProfile;
      if (selectedSO) timeEntriesParams.sales_order_id = selectedSO;
      
      const timeEntriesResponse = await getTimeEntryReport(
        fromDateStr,
        toDateStr,
        selectedProfile || undefined,
        selectedSO || undefined
      );
      setReports(timeEntriesResponse);
      
      // Only fetch shifts if no specific sales order is selected (for shift-based view)
      if (!selectedSO) {
        const fetchedShifts = await getShiftsInRange(selectedProfile ? selectedProfile : undefined, fromDateStr, toDateStr);
        const normalizedShifts = fetchedShifts.map(shift => ({
          ...shift,
          id: Number(shift.id),
          profile_id: Number(shift.profile_id)
        }));
        console.log('Fetched shifts:', normalizedShifts);
        setShifts(normalizedShifts);
        
        // Fetch all time entries for each date in range for shift grouping
        const allEntries: any[] = [];
        let cur = new Date(startDate);
        const end = new Date(endDateExclusive);
        while (cur < end) {
          const dateStr = formatDateAtLocalMidnight(cur);
          const params: any = { date: dateStr };
          if (selectedProfile) params.profile_id = selectedProfile;
          const entries = await api.get('/api/time-tracking/time-entries', { params });
          allEntries.push(...entries.data);
          cur.setDate(cur.getDate() + 1);
        }
        
        // Group entries by shift
        const shiftEntryMap: { [shiftId: number]: any[] } = {};
        const unscheduled: any[] = [];
        normalizedShifts.forEach(shift => {
          const shiftId = Number(shift.id);
          if (Number.isNaN(shiftId)) {
            return;
          }
          shiftEntryMap[shiftId] = [];
        });
        allEntries.forEach(entry => {
          const entryIn = new Date(entry.clock_in).getTime();
          const entryProfileId = Number(entry.profile_id);
          let found = false;
          for (const shift of normalizedShifts) {
            const shiftId = Number(shift.id);
            if (Number.isNaN(shiftId)) {
              continue;
            }
            const shiftIn = new Date(shift.clock_in).getTime();
            const shiftOut = shift.clock_out ? new Date(shift.clock_out).getTime() : null;
            const shiftProfileId = Number(shift.profile_id);
            if (
              shiftOut &&
              !Number.isNaN(entryProfileId) &&
              !Number.isNaN(shiftProfileId) &&
              entryProfileId === shiftProfileId &&
              entryIn >= shiftIn &&
              entryIn < shiftOut
            ) {
              shiftEntryMap[shiftId].push(entry);
              found = true;
              break;
            }
          }
          if (!found) unscheduled.push(entry);
        });
        setShiftEntries(shiftEntryMap);
        setUnscheduledEntries(unscheduled);
      } else {
        // Clear shift data when sales order is selected
        setShifts([]);
        setShiftEntries({});
        setUnscheduledEntries([]);
      }
      
      setError(null);
    } catch (err) {
      setError('Failed to generate report. Please try again.');
      console.error('Error generating report:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportReport = async (format: 'csv' | 'pdf') => {
    if (!fromDate || !toDate) {
      setError('Please select both from and to dates');
      return;
    }
    try {
      const startDate = normalizeToLocalMidnight(fromDate);
      const endDateExclusive = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
      const fromDateStr = formatDateAtLocalMidnight(startDate);
      const toDateStr = formatDateAtLocalMidnight(endDateExclusive);

      const blob = await exportTimeEntryReport(
        fromDateStr,
        toDateStr,
        selectedProfile || undefined,
        selectedSO || undefined, // Include sales order filter
        format
      );
      const filename = selectedSO 
        ? `time-entries-report-so-${selectedSO}.${format}`
        : `time-entries-report.${format}`;
      triggerDownload(blob, filename);
    } catch (err) {
      setError('Failed to export report. Please try again.');
      console.error('Error exporting report:', err);
    }
  };

  const handleSaveEditEntry = async () => {
    if (!editEntry) return;
    setEditEntryError(null);
    setError(null);
    try {
      const clockInISO = toUTCISOString(editClockIn);
      const clockOutISO = toUTCISOString(editClockOut);
      const updated = await updateTimeEntry(editEntry.id, clockInISO, clockOutISO);
      setReports(reports.map(entry => entry.id === editEntry.id ? { ...entry, clock_in: updated.clock_in, clock_out: updated.clock_out, duration: updated.duration } : entry));
      setEditEntryError(null);
      setEditEntry(null);
      setError(null);
    } catch (err: any) {
      const backendMessage = err?.response?.data?.message ?? err?.response?.data?.error;
      const message = backendMessage || 'Failed to update time entry. Please try again.';
      setEditEntryError(message);
      setError(message);
      console.error('Error updating time entry:', err);
    }
  };

  const handleOpenAddEntry = (shift: any) => {
    setAddEntryShift(shift);
    setAddEntryOpen(true);
    setAddEntrySalesOrder(selectedSO !== '' ? selectedSO : '');
    setAddEntryClockIn(shift.clock_in ? toLocalInputValue(shift.clock_in) : '');
    setAddEntryClockOut(shift.clock_out ? toLocalInputValue(shift.clock_out) : '');
    setError(null);
  };

  const handleCloseAddEntry = () => {
    setAddEntryOpen(false);
    setAddEntryShift(null);
    setAddEntryClockIn('');
    setAddEntryClockOut('');
    setAddEntrySalesOrder(selectedSO !== '' ? selectedSO : '');
    setAddingEntry(false);
  };

  const handleSaveAddEntry = async () => {
    if (!addEntryShift || addEntrySalesOrder === '' || !addEntryClockIn || !addEntryClockOut) {
      return;
    }

    const clockInISO = toUTCISOString(addEntryClockIn);
    const clockOutISO = toUTCISOString(addEntryClockOut);

    if (!clockInISO || !clockOutISO) {
      return;
    }

    setAddingEntry(true);
    setError(null);

    try {
      await createTimeEntry(addEntryShift.profile_id, Number(addEntrySalesOrder), clockInISO, clockOutISO);
      handleCloseAddEntry();
      await handleGenerateReport();
    } catch (err: any) {
      const message = (err?.response?.data?.message) || (err?.response?.data?.error) || 'Failed to create time entry. Please try again.';
      setError(message);
      console.error('Error creating manual time entry:', err);
    } finally {
      setAddingEntry(false);
    }
  };

  useEffect(() => {
    if (editShift) {
      setEditShiftClockIn(editShift.clock_in ? toLocalInputValue(editShift.clock_in) : '');
      setEditShiftClockOut(editShift.clock_out ? toLocalInputValue(editShift.clock_out) : '');
    }
  }, [editShift]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  const addEntryClockInDate = addEntryClockIn ? new Date(addEntryClockIn) : null;
  const addEntryClockOutDate = addEntryClockOut ? new Date(addEntryClockOut) : null;
  const canSaveAddEntry = Boolean(
    addEntryShift &&
    addEntrySalesOrder !== '' &&
    addEntryClockInDate &&
    addEntryClockOutDate &&
    addEntryClockOutDate.getTime() > addEntryClockInDate.getTime()
  );
  const addEntryProfileName = addEntryShift
    ? (addEntryShift.profile_name || profiles.find(p => p.id === addEntryShift.profile_id)?.name || `Profile ${addEntryShift.profile_id}`)
    : '';

  // Compute total shift duration, idle time, regular, and overtime per profile
  const profileShiftStats: { [profileId: number]: { hours: number, idle: number, regular: number, overtime: number } } = {};
  shifts.forEach(shift => {
    if (shift.clock_in && shift.clock_out) {
      const shiftId = Number(shift.id);
      if (Number.isNaN(shiftId)) {
        return;
      }
      const profileId = Number(shift.profile_id);
      if (Number.isNaN(profileId)) {
        return;
      }
      const inTime = new Date(shift.clock_in).getTime();
      const outTime = new Date(shift.clock_out).getTime();
      const dur = Math.max(0, (outTime - inTime) / (1000 * 60 * 60));
      // Find all entries for this shift
      const entries = shiftEntries[shiftId] || [];
      let booked = 0;
      entries.forEach(e => {
        const entryDur = typeof e.duration === 'number' ? e.duration : Number(e.duration) || 0;
        booked += entryDur;
      });
      const idle = Math.max(0, dur - booked);

      // Calculate regular and overtime hours for the shift
      const regularHoursShift = Math.min(dur, 8);
      const overtimeHoursShift = Math.max(0, dur - 8);

      if (!profileShiftStats[profileId]) profileShiftStats[profileId] = { hours: 0, idle: 0, regular: 0, overtime: 0 };
      profileShiftStats[profileId].hours += dur;
      profileShiftStats[profileId].idle += idle;
      profileShiftStats[profileId].regular += regularHoursShift;
      profileShiftStats[profileId].overtime += overtimeHoursShift;
    }
  });

  // Calculate profile totals for selected sales order
  let soProfileTotals: { [profileName: string]: number } = {};
  let soProfileEntries: { [profileName: string]: { date: string, duration: number }[] } = {};
  if (selectedSO) {
    // When a sales order is selected, all reports are already filtered for that sales order
    reports.forEach(entry => {
      const pname = entry.profile_name || 'Unknown';
      const dur = typeof entry.duration === 'number' ? entry.duration : Number(entry.duration) || 0;
      soProfileTotals[pname] = (soProfileTotals[pname] || 0) + dur;
      if (!soProfileEntries[pname]) soProfileEntries[pname] = [];
      soProfileEntries[pname].push({ date: entry.date, duration: dur });
    });
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ fontSize: '2.5rem' }}>
        Time Tracking Reports
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Filters */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel shrink>Profile</InputLabel>
                  <Select
                    value={selectedProfile}
                    label="Profile"
                    onChange={(e) => setSelectedProfile(e.target.value as number | "")}
                    displayEmpty
                    sx={{ '& .MuiSelect-select': { fontSize: '1.2rem' } }}
                  >
                    <MenuItem value="" sx={{ fontSize: '1.2rem' }}>All Profiles</MenuItem>
                    {profiles.map((profile) => (
                      <MenuItem key={profile.id} value={profile.id} sx={{ fontSize: '1.1rem' }}>
                        {profile.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel shrink>Sales Order</InputLabel>
                  <Select
                    value={selectedSO}
                    label="Sales Order"
                    onChange={(e) => setSelectedSO(e.target.value as number | "")}
                    displayEmpty
                    sx={{ '& .MuiSelect-select': { fontSize: '1.2rem' } }}
                  >
                    <MenuItem value="" sx={{ fontSize: '1.2rem' }}>All Sales Orders</MenuItem>
                    {salesOrders.map((so) => (
                      <MenuItem key={so.id} value={so.id} sx={{ fontSize: '1.1rem' }}>
                        {so.number}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DatePicker
                    label="From Date"
                    value={fromDate}
                    onChange={(newValue) => setFromDate(newValue)}
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                </LocalizationProvider>
              </Grid>
              <Grid item xs={12} md={2}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DatePicker
                    label="To Date"
                    value={toDate}
                    onChange={(newValue) => setToDate(newValue)}
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                </LocalizationProvider>
              </Grid>
            </Grid>
            <Box display="flex" justifyContent="center" gap={2} mt={2}>
              <Button
                variant="contained"
                color="secondary"
                onClick={() => {
                  setAddShiftProfile(selectedProfile === '' ? '' : selectedProfile);
                  setAddShiftClockIn('');
                  setAddShiftClockOut('');
                  setError(null);
                  setAddShiftOpen(true);
                }}
              >
                Add Shift
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleGenerateReport}
              >
                Generate Report
              </Button>
              <Button
                variant="outlined"
                onClick={() => handleExportReport('csv')}
              >
                Export CSV
              </Button>
              <Button
                variant="outlined"
                onClick={() => handleExportReport('pdf')}
              >
                Download PDF
              </Button>
            </Box>
          </Paper>
        </Grid>

        {/* Report Table */}
        <Grid item xs={12}>
          {selectedSO ? (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom sx={{ fontSize: '1.5rem' }}>
                Time Entries Report for Sales Order
              </Typography>
              {/* SO summary and table only */}
              <Box mb={2}>
                <Paper elevation={2} sx={{ p: 2, background: '#ede9fe', borderLeft: '6px solid #7c3aed' }}>
                  <Typography variant="h6" color="#7c3aed" fontWeight={700} sx={{ fontSize: '1.5rem' }}>
                    Total Hours by Profile on Sales Order
                  </Typography>
                  {Object.entries(soProfileTotals).map(([profileName, hours]) => (
                    <Typography key={profileName} variant="body1" sx={{ ml: 2, fontSize: '1.2rem' }}>
                      • {profileName}: {hours.toFixed(2)} hrs
                    </Typography>
                  ))}
                </Paper>
              </Box>
              <Paper elevation={3} sx={{ p: 2, mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Time Entries for Sales Order
                </Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontSize: '1.1rem' }}>Profile</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>Date</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>Clock In</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>Clock Out</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>Duration</TableCell>
                        <TableCell sx={{ fontSize: '1.1rem' }}>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{report.profile_name}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{new Date(report.date).toLocaleDateString()}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{new Date(report.clock_in).toLocaleTimeString()}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>{report.clock_out ? new Date(report.clock_out).toLocaleTimeString() : '-'}</TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>
                            {report.duration !== null && report.duration !== undefined && !isNaN(Number(report.duration))
                              ? `${Number(report.duration).toFixed(3)} hrs`
                              : '-'}
                          </TableCell>
                          <TableCell sx={{ fontSize: '1.1rem' }}>
                            {report.clock_out && (
                              <Button
                                variant="text"
                                startIcon={<EditIcon />}
                                onClick={() => {
                                  setEditEntryError(null);
                                  setError(null);
                                  setEditEntry(report);
                                  setEditClockIn(toLocalInputValue(report.clock_in));
                                  setEditClockOut(toLocalInputValue(report.clock_out));
                                }}
                                sx={{ ml: 1 }}
                              >
                                Edit
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Paper>
          ) : (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom sx={{ fontSize: '1.5rem' }}>
                Time Entries Report
              </Typography>
              <Box display="flex" alignItems="center" mb={2}>
                <FormControlLabel
                  control={<Switch checked={showBreakdown} onChange={e => setShowBreakdown(e.target.checked)} color="primary" />}
                  label={<Typography sx={{ fontSize: '1.1rem' }}>Show time entry breakdown</Typography>}
                />
              </Box>
              {/* Default UI only */}
              {shifts.length > 0 && (
                <Box mb={2}>
                  <Paper elevation={2} sx={{ p: 2, background: '#ede9fe', borderLeft: '6px solid #7c3aed' }}>
                    <Typography variant="h6" color="#7c3aed" fontWeight={700}>
                      Summary of Shift Hours by Profile
                    </Typography>
                    <TableContainer component={Paper} sx={{ mt: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Profile Name</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Total hr</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Idle hr</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Regular hr</TableCell>
                            <TableCell sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Overtime hr</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.entries(profileShiftStats).map(([profileId, stats]) => {
                            const shift = shifts.find(s => s.profile_id === Number(profileId));
                            const profileName = shift?.profile_name || profiles.find(p => p.id === Number(profileId))?.name || `Profile ${profileId}`;
                            return (
                              <TableRow key={profileId}>
                                <TableCell sx={{ fontSize: '1.2rem' }}>{profileName}</TableCell>
                                <TableCell sx={{ fontSize: '1.2rem' }}>{stats.hours.toFixed(2)}</TableCell>
                                <TableCell sx={{ fontSize: '1.2rem' }}>{stats.idle.toFixed(2)}</TableCell>
                                <TableCell sx={{ fontSize: '1.2rem' }}>{stats.regular.toFixed(2)}</TableCell>
                                <TableCell sx={{ fontSize: '1.2rem' }}>{stats.overtime.toFixed(2)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>
                </Box>
              )}
              {shifts.length === 0 && !loading && (
                <Alert severity="info" sx={{ mb: 2 }}>No shifts found</Alert>
              )}
              {shifts.map(shift => {
                const shiftId = Number(shift.id);
                if (Number.isNaN(shiftId)) {
                  return null;
                }
                return (
                  <ShiftSummaryCard
                    key={shiftId}
                    shift={shift}
                    entries={shiftEntries[shiftId] || []}
                    expanded={expandedShift === shiftId}
                    onExpand={() => setExpandedShift(expandedShift === shiftId ? null : shiftId)}
                    onAddEntry={handleOpenAddEntry}
                    setEditEntry={setEditEntry}
                    setEditClockIn={setEditClockIn}
                    setEditClockOut={setEditClockOut}
                    profiles={profiles}
                    setEditShift={setEditShift}
                    showBreakdown={showBreakdown}
                    setEditEntryError={setEditEntryError}
                    setError={setError}
                  />
                );
              })}
              {unscheduledEntries.length > 0 && (
                <Paper elevation={3} sx={{ mb: 2, borderLeft: '6px solid #a21caf', background: '#f3e8ff' }}>
                  <Box p={2}>
                    <Typography variant="subtitle1" fontWeight={700} color="#a21caf" sx={{ fontSize: '1.2rem' }}>
                      Unscheduled Entries
                    </Typography>
                    <TimeEntriesTable entries={unscheduledEntries} setEditEntry={setEditEntry} setEditClockIn={setEditClockIn} setEditClockOut={setEditClockOut} setEditEntryError={setEditEntryError} setError={setError} />
                  </Box>
                </Paper>
              )}
            </Paper>
          )}
        </Grid>
      </Grid>

      {/* Add Entry Dialog */}
      <Dialog open={addEntryOpen} onClose={handleCloseAddEntry}>
        <DialogTitle>Add Time Entry</DialogTitle>
        <DialogContent>
          {addEntryShift && (
            <Typography variant="body2" sx={{ mb: 2 }}>
              {`Profile: ${addEntryProfileName} | Shift Date: ${new Date(addEntryShift.clock_in).toLocaleDateString()}`}
            </Typography>
          )}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="add-entry-sales-order-label">Sales Order</InputLabel>
            <Select
              labelId="add-entry-sales-order-label"
              value={addEntrySalesOrder}
              label="Sales Order"
              displayEmpty
              onChange={(e) => {
                const value = e.target.value;
                setAddEntrySalesOrder(value === '' ? '' : Number(value));
              }}
            >
              <MenuItem value="" disabled>
                <em>Select a Sales Order</em>
              </MenuItem>
              {salesOrders.map((so) => (
                <MenuItem key={so.id} value={so.id}>
                  {so.number}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Clock In"
            type="datetime-local"
            value={addEntryClockIn}
            onChange={e => setAddEntryClockIn(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Clock Out"
            type="datetime-local"
            value={addEntryClockOut}
            onChange={e => setAddEntryClockOut(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAddEntry} disabled={addingEntry}>Cancel</Button>
          <Button onClick={handleSaveAddEntry} variant="contained" disabled={!canSaveAddEntry || addingEntry}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Entry Dialog */}
      <Dialog open={!!editEntry} onClose={() => { setEditEntry(null); setEditEntryError(null); }}>
        <DialogTitle>Edit Time Entry</DialogTitle>
        <DialogContent>
          {editEntryError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {editEntryError}
            </Alert>
          )}
          <TextField
            label="Clock In"
            type="datetime-local"
            value={editClockIn}
            onChange={e => setEditClockIn(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Clock Out"
            type="datetime-local"
            value={editClockOut}
            onChange={e => setEditClockOut(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditEntry(null); setEditEntryError(null); }}>Cancel</Button>
          <Button onClick={handleSaveEditEntry} variant="contained" startIcon={<SaveIcon />}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Add Shift Dialog */}
      <Dialog open={addShiftOpen} onClose={() => { if (!savingNewShift) { setAddShiftOpen(false); } }}>
        <DialogTitle>Add Shift</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="add-shift-profile-label">Profile</InputLabel>
            <Select
              labelId="add-shift-profile-label"
              value={addShiftProfile}
              label="Profile"
              onChange={(e) => setAddShiftProfile(e.target.value as number | '')}
              displayEmpty
              renderValue={(value) => {
                if (value === undefined || value === null) {
                  return <em>Select Profile</em>;
                }
                if (typeof value === 'string' && value === '') {
                  return <em>Select Profile</em>;
                }
                const profile = profiles.find((p) => p.id === Number(value));
                return profile ? profile.name : String(value);
              }}
            >
              <MenuItem value="">
                <em>Select Profile</em>
              </MenuItem>
              {profiles.map((profile) => (
                <MenuItem key={profile.id} value={profile.id}>
                  {profile.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Clock In"
            type="datetime-local"
            value={addShiftClockIn}
            onChange={(e) => setAddShiftClockIn(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Clock Out"
            type="datetime-local"
            value={addShiftClockOut}
            onChange={(e) => setAddShiftClockOut(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { if (!savingNewShift) { setAddShiftOpen(false); } }}>Cancel</Button>
          <Button
            onClick={async () => {
              if (addShiftProfile === '' || !addShiftClockIn || !addShiftClockOut) {
                return;
              }
              const clockInISO = toUTCISOString(addShiftClockIn);
              const clockOutISO = toUTCISOString(addShiftClockOut);
              if (!clockInISO || !clockOutISO) {
                setError('Please provide valid shift times.');
                return;
              }
              setSavingNewShift(true);
              try {
                await createShift(addShiftProfile as number, clockInISO, clockOutISO);
                setAddShiftOpen(false);
                setAddShiftClockIn('');
                setAddShiftClockOut('');
                setError(null);
                await handleGenerateReport();
              } catch (err: any) {
                const message = err?.response?.data?.message || err?.response?.data?.error || 'Failed to create shift.';
                setError(message);
              } finally {
                setSavingNewShift(false);
              }
            }}
            variant="contained"
            color="primary"
            disabled={
              savingNewShift ||
              addShiftProfile === '' ||
              !addShiftClockIn ||
              !addShiftClockOut
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Shift Dialog */}
      <Dialog open={!!editShift} onClose={() => setEditShift(null)}>
        <DialogTitle>Edit Shift</DialogTitle>
        <DialogContent>
          <TextField
            label="Clock In"
            type="datetime-local"
            value={editShiftClockIn}
            onChange={e => setEditShiftClockIn(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Clock Out"
            type="datetime-local"
            value={editShiftClockOut}
            onChange={e => setEditShiftClockOut(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditShift(null)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!editShift) return;
              setSavingShift(true);
              try {
                await updateShift(editShift.id, new Date(editShiftClockIn).toISOString(), new Date(editShiftClockOut).toISOString());
                setEditShift(null);
                setSavingShift(false);
                await handleGenerateReport();
              } catch (err: any) {
                setSavingShift(false);
                const message = err?.response?.data?.message || err?.response?.data?.error || 'Failed to update shift.';
                setError(message);
              }
            }}
            variant="contained"
            color="primary"
            disabled={savingShift}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default TimeTrackingReportsPage;

function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

function ShiftSummaryCard({ shift, entries, expanded, onExpand, onAddEntry, setEditEntry, setEditClockIn, setEditClockOut, profiles, setEditShift, showBreakdown, setEditEntryError, setError }: { shift: any, entries: any[], expanded: boolean, onExpand: () => void, onAddEntry: (shift: any) => void, setEditEntry: any, setEditClockIn: any, setEditClockOut: any, profiles: any[], setEditShift: any, showBreakdown: boolean, setEditEntryError: any, setError: any }) {
  const shiftIn = new Date(shift.clock_in);
  const shiftOut = shift.clock_out ? new Date(shift.clock_out) : null;
  // Use stored duration from database (which includes break deductions) instead of calculating raw duration
  const shiftDuration = shift.duration !== null && shift.duration !== undefined ? Number(shift.duration) : 0;
  // Use profile name from shift data, fallback to lookup in profiles array
  const profileName = shift.profile_name || profiles.find(p => p.id === shift.profile_id)?.name || `Profile ${shift.profile_id}`;
  // Calculate total booked time from individual entries
  let booked = 0;
  entries.forEach(e => {
    const dur = typeof e.duration === 'number' ? e.duration : Number(e.duration) || 0;
    booked += dur;
  });
  const idle = Math.max(0, shiftDuration - booked);
  return (
    <Paper elevation={3} sx={{ mb: 2, borderLeft: '6px solid #7c3aed', background: expanded ? '#f3e8ff' : 'white' }}>
      <Box p={2}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1" fontWeight={700} color="#7c3aed" sx={{ fontSize: '1.2rem' }}>
            Profile: {profileName} &nbsp; Date: {shiftIn.toLocaleDateString()}
          </Typography>
          <Box display="flex" gap={1}>
            {showBreakdown && (
              <Button variant="contained" color="primary" size="small" onClick={onExpand}>
                {expanded ? 'Hide Entries' : 'Show Entries'}
              </Button>
            )}
            <Button variant="outlined" color="primary" size="small" onClick={() => onAddEntry(shift)}>
              Add Entry
            </Button>
            <Button variant="contained" color="primary" size="small" onClick={() => setEditShift(shift)}>
              Edit Shift
            </Button>
          </Box>
        </Box>
        <Typography variant="body1" sx={{ mt: 1, fontSize: '1.1rem' }}>
          Shift: {shiftIn.toLocaleTimeString()} → {shiftOut ? shiftOut.toLocaleTimeString() : '-'} ({shiftDuration.toFixed(2)} hrs)
        </Typography>
        {showBreakdown && (
          <Box sx={{ mt: 1, ml: 2 }}>
            {entries.map((entry, index) => {
              const dur = typeof entry.duration === 'number' ? entry.duration : Number(entry.duration) || 0;
              const clockIn = new Date(entry.clock_in);
              const clockOut = entry.clock_out ? new Date(entry.clock_out) : null;
              return (
                <Typography key={entry.id || index} variant="body2" sx={{ fontSize: '1.1rem' }}>
                  • {entry.sales_order_number}: {clockIn.toLocaleTimeString()} → {clockOut ? clockOut.toLocaleTimeString() : '-'} ({dur.toFixed(3)} hrs)
                </Typography>
              );
            })}
            {idle > 0 && (
              <Typography variant="body2" sx={{ fontSize: '1.1rem' }}>• Idle: {idle.toFixed(3)} hrs</Typography>
            )}
          </Box>
        )}
        {showBreakdown && expanded && <TimeEntriesTable entries={entries} setEditEntry={setEditEntry} setEditClockIn={setEditClockIn} setEditClockOut={setEditClockOut} setEditEntryError={setEditEntryError} setError={setError} />}
      </Box>
    </Paper>
  );
}
function TimeEntriesTable({ entries, setEditEntry, setEditClockIn, setEditClockOut, setEditEntryError, setError }: { entries: any[], setEditEntry: any, setEditClockIn: any, setEditClockOut: any, setEditEntryError: any, setError: any }) {
  return (
    <TableContainer sx={{ mt: 1, mb: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Sales Order</TableCell>
            <TableCell>Clock In</TableCell>
            <TableCell>Clock Out</TableCell>
            <TableCell>Duration</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map(entry => (
            <TableRow key={entry.id}>
              <TableCell>{entry.sales_order_number}</TableCell>
              <TableCell>{new Date(entry.clock_in).toLocaleTimeString()}</TableCell>
              <TableCell>{entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : '-'}</TableCell>
              <TableCell>{entry.duration !== null && entry.duration !== undefined && !isNaN(Number(entry.duration)) ? `${Number(entry.duration).toFixed(3)} hrs` : '-'}</TableCell>
              <TableCell>
                {entry.clock_out && (
                  <Button
                    variant="text"
                    startIcon={<EditIcon />}
                    onClick={() => {
                      setEditEntryError(null);
                      setError(null);
                      setEditEntry(entry);
                      setEditClockIn(toLocalInputValue(entry.clock_in));
                      setEditClockOut(toLocalInputValue(entry.clock_out));
                    }}
                    sx={{ ml: 1 }}
                  >
                    Edit
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
} 
