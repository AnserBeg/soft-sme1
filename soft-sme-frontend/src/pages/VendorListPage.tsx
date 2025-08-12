import React, { useState, useEffect } from 'react';
import { Typography, Box, TextField, Stack, Button, InputAdornment, Container, Paper, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Grid, IconButton } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridActionsColDef,
  GridActionsCellItem
} from '@mui/x-data-grid';
import Papa from 'papaparse';
import api from '../api/axios'; // Use the custom axios instance
import { AxiosError } from 'axios';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import { getVendors } from '../services/vendorService';
import { Vendor } from '../types/vendor'; // Import the new Vendor type
import { toast } from 'react-toastify';
import UnifiedVendorDialog, { VendorFormValues } from '../components/UnifiedVendorDialog';

// Mock Vendor Master data
// const MOCK_VENDORS = [
//   { id: 1, vendorName: 'Acme Corp', address: '123 Main St', contactPerson: 'John Doe', telephoneNumber: '555-1234', email: 'john.doe@acme.com', website: 'www.acme.com' },
//   { id: 2, vendorName: 'Beta Supplies', address: '456 Oak Ave', contactPerson: 'Jane Smith', telephoneNumber: '555-5678', email: 'jane.smith@beta.com', website: 'www.beta.com' },
//   { id: 3, vendorName: 'Gamma Traders', address: '789 Pine Ln', contactPerson: 'Peter Jones', telephoneNumber: '555-9012', email: 'peter.jones@gamma.com', website: 'www.gamma.com' },
// ];

const VendorListPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  // State for Add/Edit Vendor modal
  const [openModal, setOpenModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentVendor, setCurrentVendor] = useState<Partial<Vendor>>({});

  const filteredRows = rows.filter(row =>
    (row.vendor_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (row.contact_person || '').toLowerCase().includes(search.toLowerCase()) ||
    (row.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const columns: GridColDef[] = [
    { field: 'vendor_name', headerName: 'Vendor Name', flex: 1.5 },
    { field: 'contact_person', headerName: 'Contact Person', flex: 1 },
    { field: 'email', headerName: 'Email', flex: 1.5 },
    { field: 'telephone_number', headerName: 'Phone Number', flex: 1 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteVendor(params.row.vendor_id);
          }}
        >
          <DeleteIcon />
        </IconButton>
      ),
    },
  ];

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const response = await getVendors();
      // Add id property for DataGrid
      const vendorsWithId = response.map((vendor: Vendor) => ({
        ...vendor,
        id: vendor.vendor_id,
      }));
      setRows(vendorsWithId);
    } catch (err) {
      toast.error('Failed to fetch vendors.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  const handleOpenModal = (vendor: Vendor | null = null) => {
    if (vendor) {
      setIsEditMode(true);
      setCurrentVendor(vendor);
    } else {
      setIsEditMode(false);
      setCurrentVendor({
        vendor_name: '',
        street_address: '',
        city: '',
        province: '',
        country: '',
        contact_person: '',
        telephone_number: '',
        email: '',
        website: '',
        postal_code: '',
      });
    }
    setOpenModal(true);
  };

  const handleCloseModal = () => {
    setOpenModal(false);
    setCurrentVendor({});
  };

  const handleSaveVendor = async () => {
    try {
      if (isEditMode) {
        await api.put(`/api/vendors/${currentVendor.vendor_id}`, currentVendor);
        toast.success('Vendor updated successfully!');
      } else {
        await api.post('/api/vendors', currentVendor);
        toast.success('Vendor added successfully!');
      }
      handleCloseModal();
      fetchVendors();
    } catch (err) {
        if (err instanceof AxiosError) {
            toast.error(err.response?.data?.error || `Failed to ${isEditMode ? 'update' : 'add'} vendor.`);
        } else {
            toast.error(`An unexpected error occurred while ${isEditMode ? 'updating' : 'adding'} the vendor.`);
        }
    }
  };

  const handleDeleteVendor = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this vendor?')) {
      try {
        await api.delete(`/api/vendors/${id}`);
        toast.success('Vendor deleted successfully!');
        fetchVendors();
      } catch (err) {
        if (err instanceof AxiosError) {
          toast.error(err.response?.data?.error || 'Failed to delete vendor.');
        } else {
          toast.error('An unexpected error occurred while deleting the vendor.');
        }
      }
    }
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentVendor(prev => ({ ...prev, [name]: value }));
  };

  const handleExportCSV = () => {
    const csv = Papa.unparse(filteredRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'vendor_list.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handlePrintPDF = () => {
    // Use backend PDF generation with forced download
    const url = '/api/vendors/export/pdf';
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'vendor_list.pdf');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Vendor Management
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: 'flex-end' }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
                New Vendor
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV}>Export CSV</Button>
        </Stack>
        <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
          <Box sx={{ p: 2, width: '100%' }}>
            <TextField
              fullWidth
              variant="outlined"
              placeholder="Search vendors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />
            <DataGrid
              rows={filteredRows}
              columns={columns}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[10, 25, 50]}
              getRowId={(row) => row.vendor_id}
              onRowClick={(params) => handleOpenModal(params.row as Vendor)}
              disableRowSelectionOnClick
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
              }}
            />
          </Box>
        </Paper>
      </Box>

      <UnifiedVendorDialog
        open={openModal}
        onClose={handleCloseModal}
        onSave={async (vendor: VendorFormValues) => {
          try {
            if (isEditMode) {
              await api.put(`/api/vendors/${currentVendor.vendor_id}`, vendor);
              toast.success('Vendor updated successfully!');
            } else {
              await api.post('/api/vendors', vendor);
              toast.success('Vendor added successfully!');
            }
            handleCloseModal();
            fetchVendors();
          } catch (err) {
            if (err instanceof AxiosError) {
              toast.error(err.response?.data?.error || `Failed to ${isEditMode ? 'update' : 'add'} vendor.`);
            } else {
              toast.error(`An unexpected error occurred while ${isEditMode ? 'updating' : 'adding'} the vendor.`);
            }
          }
        }}
        initialVendor={currentVendor}
        isEditMode={isEditMode}
      />
    </Container>
  );
};

export default VendorListPage;
