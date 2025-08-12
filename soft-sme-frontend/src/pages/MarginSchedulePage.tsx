import React, { useState, useEffect } from 'react';
import { Typography, Box, TextField, Stack, Button, InputAdornment, Container, Paper } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridActionsCellItem,
  GridRowParams,
  GridActionsColDef,
  GridPaginationModel,
} from '@mui/x-data-grid';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { MarginSchedule } from '../types/margin';
import { formatCurrency, formatPercentage } from '../utils/formatters';
import { toast } from 'react-toastify';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import IconButton from '@mui/material/IconButton';

const MarginSchedulePage: React.FC = () => {
  const [marginSchedules, setMarginSchedules] = useState<Array<MarginSchedule>>([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentMargin, setCurrentMargin] = useState({ margin_id: '', cost_lower_bound: '', cost_upper_bound: '', margin_factor: '' });
  const [error, setError] = useState<string | null>(null);

  // v6 paginationModel state
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 5,
  });

  const [labourRate, setLabourRate] = useState<number | ''>('');
  const [labourRateLoading, setLabourRateLoading] = useState(false);
  const [overheadRate, setOverheadRate] = useState<number | ''>('');
  const [overheadRateLoading, setOverheadRateLoading] = useState(false);
  const [supplyRate, setSupplyRate] = useState<number | ''>('');
  const [supplyRateLoading, setSupplyRateLoading] = useState(false);

  const [dailyBreakStart, setDailyBreakStart] = useState<string | ''>('');
  const [dailyBreakStartLoading, setDailyBreakStartLoading] = useState(false);
  const [dailyBreakEnd, setDailyBreakEnd] = useState<string | ''>('');
  const [dailyBreakEndLoading, setDailyBreakEndLoading] = useState(false);

  const fetchMarginSchedules = async () => {
    try {
      const response = await api.get('/api/margin-schedule');
      setMarginSchedules(response.data.map((row: any) => ({ ...row, id: row.margin_id })));
      setLoading(false);
      setError(null);
    } catch (error) {
      console.error('Error fetching margin schedules:', error);
      setError('Failed to load margin schedules');
      toast.error('Failed to load margin schedules');
      setLoading(false);
    }
  };

  const fetchLabourRate = async () => {
    setLabourRateLoading(true);
    try {
      const response = await api.get('/api/settings/labour-rate');
      setLabourRate(response.data.labour_rate ?? '');
    } catch (error) {
      setLabourRate('');
    } finally {
      setLabourRateLoading(false);
    }
  };

  const fetchOverheadRate = async () => {
    setOverheadRateLoading(true);
    try {
      const response = await api.get('/api/settings/overhead-rate');
      setOverheadRate(response.data.overhead_rate ?? '');
    } catch (error) {
      setOverheadRate('');
    } finally {
      setOverheadRateLoading(false);
    }
  };

  const fetchSupplyRate = async () => {
    setSupplyRateLoading(true);
    try {
      const response = await api.get('/api/settings/supply-rate');
      setSupplyRate(response.data.supply_rate ?? '');
    } catch (error) {
      setSupplyRate('');
    } finally {
      setSupplyRateLoading(false);
    }
  };

  const fetchDailyBreakStart = async () => {
    setDailyBreakStartLoading(true);
    try {
      const response = await api.get('/api/settings/daily-break-start');
      setDailyBreakStart(response.data.daily_break_start ?? '');
    } catch (error) {
      setDailyBreakStart('');
    } finally {
      setDailyBreakStartLoading(false);
    }
  };

  const fetchDailyBreakEnd = async () => {
    setDailyBreakEndLoading(true);
    try {
      const response = await api.get('/api/settings/daily-break-end');
      setDailyBreakEnd(response.data.daily_break_end ?? '');
    } catch (error) {
      setDailyBreakEnd('');
    } finally {
      setDailyBreakEndLoading(false);
    }
  };

  useEffect(() => {
    fetchMarginSchedules();
    fetchLabourRate();
    fetchOverheadRate();
    fetchSupplyRate();
    fetchDailyBreakStart();
    fetchDailyBreakEnd();
  }, []);

  const handleOpenAddModal = () => {
    setIsEditing(false);
    setCurrentMargin({ margin_id: '', cost_lower_bound: '', cost_upper_bound: '', margin_factor: '' });
    setOpenModal(true);
  };

  const handleEdit = (margin: MarginSchedule) => {
    setIsEditing(true);
    setCurrentMargin({
      margin_id: margin.margin_id,
      cost_lower_bound: String(margin.cost_lower_bound),
      cost_upper_bound: String(margin.cost_upper_bound),
      margin_factor: String(margin.margin_factor)
    });
    setOpenModal(true);
  };

  const handleDelete = async (margin_id: string) => {
    if (window.confirm('Are you sure you want to delete this margin schedule?')) {
      try {
        await api.delete(`/api/margin-schedule/${margin_id}`);
        toast.success('Margin schedule deleted successfully');
        fetchMarginSchedules();
      } catch (error) {
        console.error('Error deleting margin schedule:', error);
        toast.error('Failed to delete margin schedule');
      }
    }
  };

  const handleCloseModal = () => {
    setOpenModal(false);
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentMargin(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await api.put(`/api/margin-schedule/${currentMargin.margin_id}`, {
          cost_lower_bound: parseFloat(currentMargin.cost_lower_bound),
          cost_upper_bound: parseFloat(currentMargin.cost_upper_bound),
          margin_factor: parseFloat(currentMargin.margin_factor),
        });
        toast.success('Margin schedule updated successfully');
      } else {
        await api.post('/api/margin-schedule', {
          schedule: [
            {
              cost_lower_bound: parseFloat(currentMargin.cost_lower_bound),
              cost_upper_bound: parseFloat(currentMargin.cost_upper_bound),
              margin_factor: parseFloat(currentMargin.margin_factor),
            }
          ]
        });
        toast.success('Margin schedule created successfully');
      }
      handleCloseModal();
      fetchMarginSchedules();
    } catch (error) {
      console.error('Error saving margin schedule:', error);
      toast.error('Failed to save margin schedule');
    }
  };

  const handleLabourRateSave = async () => {
    setLabourRateLoading(true);
    try {
      await api.put('/api/settings/labour-rate', { labour_rate: Number(labourRate) });
      fetchLabourRate();
    } catch (error) {
      // handle error
    } finally {
      setLabourRateLoading(false);
    }
  };

  const handleOverheadRateSave = async () => {
    setOverheadRateLoading(true);
    try {
      await api.put('/api/settings/overhead-rate', { overhead_rate: Number(overheadRate) });
      fetchOverheadRate();
    } catch (error) {
      // handle error
    } finally {
      setOverheadRateLoading(false);
    }
  };

  const handleSupplyRateSave = async () => {
    setSupplyRateLoading(true);
    try {
      await api.put('/api/settings/supply-rate', { supply_rate: Number(supplyRate) });
      fetchSupplyRate();
      toast.success('Supply rate updated successfully');
    } catch (error) {
      toast.error('Failed to update supply rate');
    } finally {
      setSupplyRateLoading(false);
    }
  };

  const handleDailyBreakStartSave = async () => {
    setDailyBreakStartLoading(true);
    try {
      await api.put('/api/settings/daily-break-start', { daily_break_start: dailyBreakStart });
      fetchDailyBreakStart();
      toast.success('Daily break start time updated successfully');
    } catch (error) {
      toast.error('Failed to update daily break start time');
    } finally {
      setDailyBreakStartLoading(false);
    }
  };

  const handleDailyBreakEndSave = async () => {
    setDailyBreakEndLoading(true);
    try {
      await api.put('/api/settings/daily-break-end', { daily_break_end: dailyBreakEnd });
      fetchDailyBreakEnd();
      toast.success('Daily break end time updated successfully');
    } catch (error) {
      toast.error('Failed to update daily break end time');
    } finally {
      setDailyBreakEndLoading(false);
    }
  };

  const columns: (GridColDef | GridActionsColDef)[] = [
    { field: 'margin_id', headerName: 'ID', flex: 0.5, minWidth: 60, headerAlign: 'center', align: 'center' },
    { field: 'cost_lower_bound', headerName: 'Cost Lower Bound', flex: 1, minWidth: 120, type: 'number', headerAlign: 'center', align: 'center' },
    { field: 'cost_upper_bound', headerName: 'Cost Upper Bound', flex: 1, minWidth: 120, type: 'number', headerAlign: 'center', align: 'center' },
    { field: 'margin_factor', headerName: 'Margin Factor', flex: 1, minWidth: 120, type: 'number', headerAlign: 'center', align: 'center' },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      headerAlign: 'center',
      align: 'center',
      renderCell: (params) => (
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(params.row.margin_id);
          }}
        >
          <DeleteIcon />
        </IconButton>
      ),
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Global Variables
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" onClick={handleOpenAddModal} startIcon={<AddIcon />}>
            New Entry
          </Button>
          <Button variant="contained" onClick={fetchMarginSchedules}>
            Refresh
          </Button>
        </Stack>
      </Box>
      <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
        <Box sx={{ p: 2 }}>
          <DataGrid
            rows={marginSchedules}
            columns={columns}
            getRowId={row => row.id}
            paginationModel={paginationModel}
            onPaginationModelChange={model => setPaginationModel(model)}
            pageSizeOptions={[5, 10, 20]}
            loading={loading}
            disableRowSelectionOnClick
            onRowClick={(params) => handleEdit(params.row)}
            sx={{
              '& .MuiDataGrid-cell, & .MuiDataGrid-columnHeader, & .MuiDataGrid-columnHeaderTitle': {
                fontSize: '1.1rem',
              },
              '& .MuiDataGrid-cell': {
                borderBottom: '1px solid rgba(224, 224, 224, 1)',
              },
              '& .MuiDataGrid-columnHeaders': {
                backgroundColor: 'background.paper',
                borderBottom: '2px solid rgba(224, 224, 224, 1)',
              },
              '& .MuiDataGrid-row': {
                minHeight: '52px !important',
                maxHeight: '52px !important',
              },
              '& .MuiDataGrid-columnHeadersInner': {
                minHeight: '60px !important',
                maxHeight: '60px !important',
              },
              '& .MuiDataGrid-row:hover': {
                backgroundColor: 'action.hover',
              },
              cursor: 'pointer',
            }}
          />
        </Box>
      </Paper>
      {/* Hourly Rates */}
      <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3, p: 2 }}>
        <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          {/* Labour Hourly Rate */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" gutterBottom>Labour Hourly Rate</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                label="Hourly Rate ($)"
                type="number"
                value={labourRate}
                onChange={e => setLabourRate(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={labourRateLoading}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                sx={{ maxWidth: 200 }}
              />
              <Button variant="contained" onClick={handleLabourRateSave} disabled={labourRateLoading || labourRate === ''}>
                Save
              </Button>
            </Box>
          </Box>

          {/* Overhead Hourly Rate */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" gutterBottom>Overhead Hourly Rate</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                label="Hourly Rate ($)"
                type="number"
                value={overheadRate}
                onChange={e => setOverheadRate(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={overheadRateLoading}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                sx={{ maxWidth: 200 }}
              />
              <Button variant="contained" onClick={handleOverheadRateSave} disabled={overheadRateLoading || overheadRate === ''}>
                Save
              </Button>
            </Box>
          </Box>

          {/* Supply Percentage Rate */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" gutterBottom>Supply Percentage</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                label="Percentage (%)"
                type="number"
                value={supplyRate}
                onChange={e => setSupplyRate(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={supplyRateLoading}
                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                sx={{ maxWidth: 200 }}
              />
              <Button variant="contained" onClick={handleSupplyRateSave} disabled={supplyRateLoading || supplyRate === ''}>
                Save
              </Button>
            </Box>
          </Box>

          {/* Daily Break Times */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" gutterBottom>Daily Break Times</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Break Start (HH:MM)"
                type="time"
                value={dailyBreakStart}
                onChange={e => setDailyBreakStart(e.target.value)}
                disabled={dailyBreakStartLoading}
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: 200 }}
              />
              <Button variant="contained" onClick={handleDailyBreakStartSave} disabled={dailyBreakStartLoading || dailyBreakStart === ''}>
                Save Start
              </Button>
              <TextField
                label="Break End (HH:MM)"
                type="time"
                value={dailyBreakEnd}
                onChange={e => setDailyBreakEnd(e.target.value)}
                disabled={dailyBreakEndLoading}
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: 200 }}
              />
              <Button variant="contained" onClick={handleDailyBreakEndSave} disabled={dailyBreakEndLoading || dailyBreakEnd === ''}>
                Save End
              </Button>
            </Box>
          </Box>
        </Box>
      </Paper>
      <Dialog open={openModal} onClose={handleCloseModal}>
        <DialogTitle>{isEditing ? 'Edit Margin Entry' : 'Add New Margin Entry'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label="Cost Lower Bound"
              name="cost_lower_bound"
              value={currentMargin.cost_lower_bound}
              onChange={handleFormChange}
              fullWidth
              type="number"
            />
            <TextField
              label="Cost Upper Bound"
              name="cost_upper_bound"
              value={currentMargin.cost_upper_bound}
              onChange={handleFormChange}
              fullWidth
              type="number"
            />
            <TextField
              label="Margin Factor"
              name="margin_factor"
              value={currentMargin.margin_factor}
              onChange={handleFormChange}
              fullWidth
              type="number"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseModal}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {isEditing ? 'Save Changes' : 'Add Entry'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default MarginSchedulePage;
