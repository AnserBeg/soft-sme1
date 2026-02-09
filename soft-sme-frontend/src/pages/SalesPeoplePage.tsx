import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Container, IconButton, Paper, Stack, TextField, Typography } from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import InputAdornment from '@mui/material/InputAdornment';
import { useNavigate } from 'react-router-dom';
import { SalesPerson } from '../types/salesPerson';
import { createSalesPerson, getSalesPeople, updateSalesPerson } from '../services/salesPeopleService';
import UnifiedSalesPersonDialog, { SalesPersonFormValues } from '../components/UnifiedSalesPersonDialog';
import { toast } from 'react-toastify';

const SalesPeoplePage: React.FC = () => {
  const navigate = useNavigate();
  const [salesPeople, setSalesPeople] = useState<SalesPerson[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SalesPerson | null>(null);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 10 });

  useEffect(() => {
    fetchSalesPeople();
  }, []);

  const fetchSalesPeople = async () => {
    try {
      const data = await getSalesPeople();
      setSalesPeople(data);
    } catch (err) {
      console.error('Failed to load sales people', err);
      toast.error('Failed to load sales people');
    }
  };

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return salesPeople;
    return salesPeople.filter(sp =>
      `${sp.sales_person_name || ''} ${sp.email || ''} ${sp.phone_number || ''}`.toLowerCase().includes(q)
    );
  }, [salesPeople, searchTerm]);

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'sales_person_name', headerName: 'Sales Person', flex: 1.3, minWidth: 180 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
    { field: 'phone_number', headerName: 'Phone', flex: 1, minWidth: 140 },
    { field: 'is_active', headerName: 'Active', flex: 0.6, minWidth: 100, valueGetter: (p) => (p.row?.is_active === false ? 'No' : 'Yes') },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      width: 80,
      renderCell: (params) => (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setEditTarget(params.row as SalesPerson);
            setDialogOpen(true);
          }}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      ),
    },
  ], []);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h4">Sales People</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              placeholder="Search sales people"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditTarget(null);
                setDialogOpen(true);
              }}
            >
              New Sales Person
            </Button>
          </Stack>
        </Stack>

        <Box sx={{ height: 520, width: '100%' }}>
          <DataGrid
            rows={filtered}
            columns={columns}
            getRowId={(row) => row.sales_person_id}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50]}
            disableRowSelectionOnClick
            onRowClick={(params) => navigate(`/sales-people/${params.row.sales_person_id}`)}
          />
        </Box>
      </Paper>

      <UnifiedSalesPersonDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={async (values: SalesPersonFormValues) => {
          try {
            const payload = {
              sales_person_name: values.sales_person_name,
              email: values.email,
              phone_number: values.phone_number,
            };
            if (editTarget?.sales_person_id) {
              const updated = await updateSalesPerson(editTarget.sales_person_id, payload);
              setSalesPeople(prev => prev.map(sp => sp.sales_person_id === updated.sales_person_id ? updated : sp));
              toast.success('Sales person updated');
            } else {
              const created = await createSalesPerson(payload);
              setSalesPeople(prev => [...prev, created]);
              toast.success('Sales person created');
            }
            setDialogOpen(false);
          } catch (err) {
            console.error('Failed to save sales person', err);
            toast.error('Failed to save sales person');
          }
        }}
        initialSalesPerson={editTarget ? {
          sales_person_id: String(editTarget.sales_person_id),
          sales_person_name: editTarget.sales_person_name || '',
          email: editTarget.email || '',
          phone_number: editTarget.phone_number || '',
        } : {}}
        isEditMode={Boolean(editTarget)}
      />
    </Container>
  );
};

export default SalesPeoplePage;
