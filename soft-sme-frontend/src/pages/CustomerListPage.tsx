import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Paper, Container, Stack, IconButton, LinearProgress, Alert, Chip, List, ListItem, ListItemText } from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InputAdornment from '@mui/material/InputAdornment';
import { Customer } from '../types/customer';
import { getCustomers, deleteCustomer, updateCustomer, createCustomer, importCustomersFromExcel, downloadCustomerExcelTemplate } from '../services/customerService';
import { toast } from 'react-toastify';
import Papa from 'papaparse';
import Grid from '@mui/material/Grid';
import UnifiedCustomerDialog, { CustomerFormValues } from '../components/UnifiedCustomerDialog';

const CustomerListPage: React.FC = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    pageSize: 10,
    page: 0,
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [showUploadResult, setShowUploadResult] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await getCustomers();
      setCustomers(response);
    } catch (error) {
      console.error('Error fetching customers:', error);
      toast.error('Failed to fetch customers');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this customer?')) {
      try {
        await deleteCustomer(id);
        setCustomers(prevCustomers => prevCustomers.filter(customer => customer.id !== id));
        toast.success('Customer deleted successfully');
      } catch (error) {
        console.error('Error deleting customer:', error);
        toast.error('Failed to delete customer');
      }
    }
  };

  const handleEdit = (id: string) => {
    navigate(`/customers/${id}`);
  };

  const handleViewDetails = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditCustomer({ ...customer });
    setIsEditMode(true);
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setSelectedCustomer(null);
    setEditCustomer(null);
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await downloadCustomerExcelTemplate();
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'customer_import_template.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading template', err);
      toast.error('Failed to download template');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadExcel(file);
    event.target.value = '';
  };

  const uploadExcel = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    try {
      const result = await importCustomersFromExcel(file, (progressEvent) => {
        if (progressEvent?.total) {
          const progress = Math.round((progressEvent.loaded * 90) / progressEvent.total);
          setUploadProgress(progress);
        }
      });

      setUploadProgress(100);
      setUploadResult(result);
      setShowUploadResult(true);

      if (Array.isArray(result?.createdCustomers) && result.createdCustomers.length > 0) {
        setCustomers((prev) => [...prev, ...result.createdCustomers]);
      } else {
        fetchCustomers();
      }

      toast.success('Customer import completed');
    } catch (error: any) {
      console.error('Error uploading Excel:', error);
      const responseData = error?.response?.data;
      const message = responseData?.error || 'Failed to import customers';
      setUploadResult({
        error: message,
        errors: responseData?.errors || [],
        warnings: responseData?.warnings || [],
      });
      setShowUploadResult(true);
      toast.error(message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const closeUploadResult = () => {
    setShowUploadResult(false);
    setUploadResult(null);
  };


  const filteredCustomers = customers.filter(customer =>
    customer.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `${customer.street_address}, ${customer.city}, ${customer.province}, ${customer.country}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns: GridColDef[] = [
    { field: 'customer_name', headerName: 'Customer Name', flex: 1.5 },
    { field: 'contact_person', headerName: 'Contact Person', flex: 1 },
    { field: 'email', headerName: 'Email', flex: 1.5 },
    { field: 'phone_number', headerName: 'Phone Number', flex: 1 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(params.row.id);
          }}
        >
          <DeleteIcon />
        </IconButton>
      ),
    },
  ];

  // Export CSV for customers
  const handleExportCSV = () => {
    const csvData = filteredCustomers.map((customer) => ({
      customer_name: customer.customer_name,
      contact_person: customer.contact_person,
      email: customer.email,
      phone_number: customer.phone_number,
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'customer_list.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Export PDF for customers
  const handleExportPDF = () => {
    // Use backend PDF generation
    window.open('/api/customers/export/pdf', '_blank');
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Customer List
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => {
            setEditCustomer({
              id: '',
              customer_id: '',
              customer_name: '',
              email: '',
              phone: '',
              phone_number: '',
              address: '',
              street_address: '',
              city: '',
              state: '',
              province: '',
              country: '',
              postal_code: '',
              contact_person: '',
              website: '',
              general_notes: '',
              created_at: '',
              updated_at: ''
            });
            setIsEditMode(false);
            setOpenDialog(true);
          }}>
            New Customer
          </Button>
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={handleUploadClick}>
            Import Excel
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadTemplate}>
            Download Template
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV}>
            Export CSV
          </Button>
        </Stack>
        {/* Hidden file input for Excel upload */}
        <input
          type="file"
          accept=".xlsx,.xls"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        {/* Upload progress */}
        {uploading && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              Uploading Excel file...
            </Typography>
            <LinearProgress variant="determinate" value={uploadProgress} />
            <Typography variant="caption" color="text.secondary">
              {uploadProgress}% complete
            </Typography>
          </Paper>
        )}
        <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
          <Box sx={{ p: 2 }}>
            <TextField
              fullWidth
              variant="outlined"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
              rows={filteredCustomers}
              columns={columns}
              pageSizeOptions={[10, 25, 50]}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              getRowId={(row) => row.id}
              loading={false}
              disableRowSelectionOnClick
              onRowClick={(params) => handleViewDetails(params.row)}
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
        {/* Excel Upload Result Dialog */}
        <Dialog open={showUploadResult} onClose={closeUploadResult} maxWidth="md" fullWidth>
          <DialogTitle>
            {uploadResult?.error ? 'Import Failed' : 'Import Completed'}
          </DialogTitle>
          <DialogContent>
            {uploadResult && (
              <Box>
                {uploadResult.error ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {uploadResult.error}
                  </Alert>
                ) : (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    {uploadResult.message || 'Customers imported successfully'}
                  </Alert>
                )}

                {uploadResult.summary && (
                  <Box sx={{ mb: 3 }}>
                    <Grid container spacing={1}>
                      <Grid item xs={6} sm={3}><Chip label={`Total rows: ${uploadResult.summary.totalRows || 0}`} color="primary" /></Grid>
                      <Grid item xs={6} sm={3}><Chip label={`Accepted: ${uploadResult.summary.acceptedRows || 0}`} color="info" /></Grid>
                      <Grid item xs={6} sm={3}><Chip label={`Created: ${uploadResult.summary.created || 0}`} color="success" /></Grid>
                      <Grid item xs={6} sm={3}><Chip label={`Skipped: ${uploadResult.summary.skipped || 0}`} color="warning" /></Grid>
                    </Grid>
                  </Box>
                )}

                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" color="error" gutterBottom>
                      Errors ({uploadResult.errors.length})
                    </Typography>
                    <List dense>
                      {uploadResult.errors.map((error: string, index: number) => (
                        <ListItem key={index}>
                          <ListItemText primary={error} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}

                {uploadResult.warnings && uploadResult.warnings.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" color="warning.main" gutterBottom>
                      Warnings ({uploadResult.warnings.length})
                    </Typography>
                    <List dense>
                      {uploadResult.warnings.map((warning: string, index: number) => (
                        <ListItem key={index}>
                          <ListItemText primary={warning} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={closeUploadResult} variant="contained">
              Close
            </Button>
          </DialogActions>
        </Dialog>

        <UnifiedCustomerDialog
          open={openDialog}
          onClose={handleCloseDialog}
          onSave={async (customer: CustomerFormValues) => {
            try {
              if (isEditMode && editCustomer) {
                // Update existing customer
                await updateCustomer(editCustomer.id, customer);
                setCustomers(prev => prev.map(c => c.id === editCustomer.id ? { ...c, ...customer } : c));
                toast.success('Customer updated successfully');
              } else {
                // Create new customer
                const newCustomer = await createCustomer(customer);
                setCustomers(prev => [...prev, newCustomer]);
                toast.success('Customer created successfully');
              }
              handleCloseDialog();
            } catch (error) {
              console.error('Error saving customer:', error);
              toast.error(isEditMode ? 'Failed to update customer' : 'Failed to create customer');
            }
          }}
          initialCustomer={editCustomer || {}}
          isEditMode={isEditMode}
        />
      </Box>
    </Container>
  );
};

export default CustomerListPage; 
