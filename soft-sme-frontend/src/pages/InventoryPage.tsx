import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Typography, Box, TextField, Stack, Button, InputAdornment, Container, Paper, Alert, LinearProgress, List, ListItem, ListItemText, Chip, CircularProgress } from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridActionsColDef, GridActionsCellItem } from '@mui/x-data-grid';
import Papa from 'papaparse';
import api from '../api/axios'; // Use the custom axios instance
import { AxiosError } from 'axios'; // Import AxiosError for type checking
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import IconButton from '@mui/material/IconButton';
import { getStockInventory, cleanupInventorySpaces, previewCleanupEnforce, applyCleanupEnforce } from '../services/inventoryService';
import Grid from '@mui/material/Grid';
import UnifiedPartDialog, { PartFormValues } from '../components/UnifiedPartDialog';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { useAuth } from '../contexts/AuthContext';

// Remove Mock Inventory data
// const MOCK_INVENTORY_DATA = [
//   { id: 1, partNumber: 'P-1001', partDescription: 'Widget A', quantityOnHand: 150, unit: 'Each', reorderPoint: 50 },
//   { id: 2, partNumber: 'P-1002', partDescription: 'Widget B', quantityOnHand: 300, unit: 'cm', reorderPoint: 100 },
//   { id: 3, partNumber: 'P-1003', partDescription: 'Widget C', quantityOnHand: 75, unit: 'ft', reorderPoint: 25 },
//   { id: 4, partNumber: 'P-1004', partDescription: 'Component X', quantityOnHand: 200, unit: 'Each', reorderPoint: 75 },
//   { id: 5, partNumber: 'P-1005', partDescription: 'Material Y', quantityOnHand: 500, unit: 'kg', reorderPoint: 200 },
// ];

const InventoryPage: React.FC = () => {
  const [search, setSearch] = useState('');
  // Initialize rows as an empty array
  const [rows, setRows] = useState<any[]>([]); // Use any[] for now, can refine type later
  const [loading, setLoading] = useState(false); // Add loading state

  // State for Add/Edit Part modal
  const [openPartDialog, setOpenPartDialog] = useState(false);
  const [editingPart, setEditingPart] = useState<PartFormValues | null>(null);

  // CSV Upload states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [showUploadResult, setShowUploadResult] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup states
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const [showCleanupResult, setShowCleanupResult] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<any>(null);
  const [showCleanupPreview, setShowCleanupPreview] = useState(false);

  // v6 paginationModel state
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  const { user } = useAuth();


  // Fetch inventory data from backend (only stock items)
  const fetchInventory = async () => {
    setLoading(true);
    try {
      const response = await getStockInventory();
      console.log('Raw inventory response:', response);
      
      // Debug: Log sample data
      if (response.length > 0) {
        console.log('Sample inventory item from frontend:', {
          part_number: response[0].part_number,
          last_unit_cost: response[0].last_unit_cost,
          last_unit_cost_type: typeof response[0].last_unit_cost,
          quantity_on_hand: response[0].quantity_on_hand,
          quantity_on_hand_type: typeof response[0].quantity_on_hand
        });
      }
      
      const dataWithIds = response.map((item: any, index: number) => ({ ...item, id: item.part_number || index }));
      setRows(dataWithIds);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    fetchInventory();
    const handleInventoryUpdated = () => fetchInventory();
    window.addEventListener('inventory-updated', handleInventoryUpdated);
    return () => window.removeEventListener('inventory-updated', handleInventoryUpdated);
  }, []); // Empty dependency array means this runs once on mount

  // Filter rows by search text
  const filteredRows = rows.filter(row =>
    row.part_number?.toUpperCase().includes(search.toUpperCase()) ||
    row.part_description?.toLowerCase().includes(search.toLowerCase())
  );

  // Fix: filter(Boolean) returns (GridColDef | null)[], so cast to GridColDef[]
  const columns = ([
    { field: 'part_number', headerName: 'Part #', flex: 1, headerAlign: 'left' },
    { field: 'part_description', headerName: 'Part Description', flex: 2, headerAlign: 'left' },
    { field: 'quantity_on_hand', headerName: 'Quantity on Hand', flex: 1, type: 'number', editable: true, align: 'center', headerAlign: 'left' },
    { field: 'unit', headerName: 'UOM', flex: 0.5, headerAlign: 'left' },
    { 
      field: 'last_unit_cost', 
      headerName: 'Last Unit Cost', 
      flex: 1, 
      type: 'number', 
      editable: true, 
      align: 'center', 
      headerAlign: 'left',
      valueFormatter: (params) => {
        const value = Number(params.value) || 0;
        return `$${value.toFixed(2)}`;
      },
      valueGetter: (params) => {
        const value = Number(params.value) || 0;
        return value;
      }
    },
    { field: 'reorder_point', headerName: 'Reorder Point', flex: 0.75, type: 'number', editable: true, align: 'center', headerAlign: 'left' },
    {
      field: 'value',
      headerName: 'Value',
      flex: 1,
      type: 'number',
      valueGetter: (params) => {
        const q = Number(params.row.quantity_on_hand) || 0;
        const c = Number(params.row.last_unit_cost) || 0;
        return q * c;
      },
      valueFormatter: (params) => {
        const v = Number(params.value) || 0;
        return `$${v.toFixed(2)}`;
      },
      headerAlign: 'left',
      align: 'center',
    },
    user?.access_role !== 'Sales and Purchase' ? {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      headerAlign: 'left',
      sortable: false,
      renderCell: (params) => (
        <IconButton size="small" color="error" onClick={(e) => {
          e.stopPropagation();
          handleDeletePart(params.row.part_number);
        }}>
          <DeleteIcon fontSize="medium" sx={{ fontSize: 28 }} />
        </IconButton>
      ),
    } : null,
  ].filter(Boolean) as GridColDef[]);

  // Handle Delete Action
  const handleDeletePart = async (partNumber: string) => {
    if (window.confirm(`Are you sure you want to delete part ${partNumber}?`)) {
      try {
        // TODO: Call backend delete endpoint
        console.log(`Deleting part: ${partNumber}`);
        // After successful deletion, refresh the list
        // fetchInventory();
        const response = await api.delete(`/api/inventory/${encodeURIComponent(partNumber)}`); // Use api instead of axios
        console.log(`Part ${partNumber} deleted successfully:`, response.data);
        alert(`Part ${partNumber} deleted successfully!`);
        // Refresh the list after successful deletion
        fetchInventory();
      } catch (error) {
        console.error(`Error deleting part ${partNumber}:`, error);
        alert(`Error deleting part ${partNumber}. Please check the console.`);
      }
    }
  };

  // Handle cell edit commit (for quantity_on_hand and reorder_point)
  const processRowUpdate = async (newRow: any, oldRow: any) => {
    console.log('Attempting to update row:', newRow);

    const updatedFields: any = {};
    if (newRow.quantity_on_hand !== oldRow.quantity_on_hand) {
      const newQuantity = parseFloat(String(newRow.quantity_on_hand));
      if (isNaN(newQuantity)) {
         alert('Invalid quantity value. Please enter a valid number.');
         return Promise.reject('Invalid quantity');
      }
      updatedFields.quantity_on_hand = newQuantity;
    }
    if (newRow.reorder_point !== oldRow.reorder_point) {
      const newReorderPoint = parseFloat(String(newRow.reorder_point));
       if (isNaN(newReorderPoint)) {
         alert('Invalid reorder point value. Please enter a valid number.');
         return Promise.reject('Invalid reorder point');
      }
      updatedFields.reorder_point = newReorderPoint;
    }

    // Add handling for last_unit_cost
    if (newRow.last_unit_cost !== oldRow.last_unit_cost) {
       const newLastUnitCost = parseFloat(String(newRow.last_unit_cost));
       if (isNaN(newLastUnitCost)) {
         alert('Invalid last unit cost value. Please enter a valid number.');
         return Promise.reject('Invalid last unit cost');
       }
       updatedFields.last_unit_cost = newLastUnitCost;
    }

    if (Object.keys(updatedFields).length === 0) {
        console.log('No fields changed.');
        return newRow;
    }

    const partNumber = newRow.part_number;

    try {
      // This PUT request now sends either quantity_on_hand, reorder_point, or both
      const response = await api.put(`/api/inventory/${encodeURIComponent(partNumber)}`, updatedFields); // Use api instead of axios

      console.log(`Inventory updated for part ${partNumber}:`, response.data);
      alert(`Part ${partNumber} updated successfully!`);

      // Assuming backend returns the updated item in response.data.updatedItem
      const updatedRows = rows.map((row) =>
        row.id === response.data.updatedItem.part_number ? { ...row, ...response.data.updatedItem } : row
      );
      setRows(updatedRows);

      return response.data.updatedItem;
    } catch (error) {
      console.error(`Error updating inventory for part ${partNumber}:`, error);
      if (error instanceof AxiosError && error.response && error.response.data && (error.response.data as any).error) {
          alert(`Error updating inventory: ${(error.response.data as any).error}`);
      } else {
          alert(`Error updating inventory for part ${partNumber}. Please check the console.`);
      }
      return Promise.reject(error);
    }
  };

  const handleRefresh = () => {
    fetchInventory(); // Call fetchInventory to refresh data
  };

  const handleExportCSV = () => {
    // Add Value column to CSV
    const csvRows = filteredRows.map(row => ({
      ...row,
      value: (Number(row.quantity_on_hand) || 0) * (Number(row.last_unit_cost) || 0)
    }));
    const csv = Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'inventory_list.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
    }
  };

  const handlePrintPDF = () => {
    // Use backend PDF generation
    window.open('/api/inventory/export/pdf?partType=stock', '_blank');
  };

  // Handle Add New Part button click
  const handleAddNewPart = () => {
    setEditingPart(null);
    setOpenPartDialog(true);
  };

  // Handle Save Part (both add and edit)
  const handleSavePart = async (partData: PartFormValues) => {
    // Trim string fields and convert part number to uppercase
    const trimmedPartData = {
      ...partData,
      part_number: partData.part_number.trim().toUpperCase(),
      part_description: partData.part_description.trim(),
      unit: partData.unit.trim(),
      part_type: partData.part_type.trim()
    };
    
    try {
      if (editingPart) {
        const { part_number, ...updateData } = trimmedPartData;
        await api.put(`/api/inventory/${encodeURIComponent(part_number)}`, updateData);
      } else {
        await api.post('/api/inventory', trimmedPartData);
      }
      fetchInventory();
    } catch (error) {
      throw error; // Let the dialog handle the error
    }
  };

  const handleClosePartDialog = () => {
    setOpenPartDialog(false);
    setEditingPart(null); // Ensure editingPart is reset on close
  };



  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editPart, setEditPart] = useState<any | null>(null);

  const handleRowClick = (params: any) => {
    setEditPart({ ...params.row });
    setEditDialogOpen(true);
  };

  const handleEditField = (field: string, value: any) => {
    setEditPart((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    if (!editPart) return;
    try {
      const { part_number, ...fields } = editPart;
      
      // Trim string fields before sending to backend
      const trimmedFields = {
        ...fields,
        part_description: fields.part_description ? fields.part_description.trim() : '',
        unit: fields.unit ? fields.unit.trim() : '',
        part_type: fields.part_type ? fields.part_type.trim() : ''
      };
      
      await api.put(`/api/inventory/${encodeURIComponent(part_number.toUpperCase())}`, trimmedFields);
      setEditDialogOpen(false);
      setEditPart(null);
      fetchInventory();
    } catch (error) {
      alert('Failed to update part.');
    }
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setEditPart(null);
  };

  // CSV Upload functions
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      alert('Please select a valid CSV file');
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      return;
    }

    await uploadCSV(file);
  };

  const uploadCSV = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const response = await api.post('/api/inventory/upload-csv', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 90) / progressEvent.total);
            setUploadProgress(progress);
          }
        },
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      setUploadResult(response.data);
      setShowUploadResult(true);

      // Refresh inventory data
      setTimeout(() => {
        fetchInventory();
      }, 1000);

    } catch (error) {
      console.error('Error uploading CSV:', error);
      if (error instanceof AxiosError && error.response?.data) {
        setUploadResult({
          error: 'Upload failed',
          errors: error.response.data.errors || [error.response.data.error || 'Unknown error'],
          warnings: error.response.data.warnings || []
        });
      } else {
        setUploadResult({
          error: 'Upload failed',
          errors: ['An unexpected error occurred during upload']
        });
      }
      setShowUploadResult(true);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const downloadTemplate = async () => {
    try {
      const response = await api.get('/api/inventory/csv-template', {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'inventory_template.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Error downloading template');
    }
  };

  const closeUploadResult = () => {
    setShowUploadResult(false);
    setUploadResult(null);
  };

  // New: Enforce rules and show potential duplicates, allow merging
  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const preview = await previewCleanupEnforce('stock');
      setCleanupPreview(preview?.preview || preview);
      setShowCleanupPreview(true);
    } catch (error) {
      console.error('Error during cleanup preview:', error);
      alert('Failed to analyze inventory for cleanup.');
    } finally {
      setCleaning(false);
    }
  };

  const applyCleanup = async () => {
    if (!cleanupPreview) return;
    // Ask the user which duplicates to merge: for simplicity, auto-merge all groups using proposedKeep
    const merges = (cleanupPreview.duplicateGroups || []).map((g: any) => ({
      keepPartNumber: g.proposedKeep,
      mergePartNumbers: g.candidates.map((c: any) => c.part_number).filter((pn: string) => pn !== g.proposedKeep),
    }));
    setCleaning(true);
    try {
      const applied = await applyCleanupEnforce('stock', merges);
      setShowCleanupPreview(false);
      setCleanupResult(applied);
      setShowCleanupResult(true);
      await fetchInventory();
    } catch (error) {
      console.error('Error applying cleanup:', error);
      alert('Failed to apply cleanup.');
    } finally {
      setCleaning(false);
    }
  };

  const closeCleanupResult = () => {
    setShowCleanupResult(false);
    setCleanupResult(null);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Stock
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddNewPart}>New Part</Button>
            <Button variant="outlined" startIcon={<UploadIcon />} onClick={handleUploadClick}>Upload CSV</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadTemplate}>Download Template</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV}>Export CSV</Button>
            
            <Button 
              variant="outlined" 
              color="warning" 
              onClick={handleCleanup}
              disabled={cleaning}
              startIcon={cleaning ? <CircularProgress size={20} /> : <DeleteIcon />}
            >
              {cleaning ? 'Cleaning...' : 'Clean'}
            </Button>
          </Stack>
        </Box>

        {/* Hidden file input for CSV upload */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept=".csv"
          style={{ display: 'none' }}
        />

        {/* Upload progress */}
        {uploading && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              Uploading CSV file...
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
              placeholder="Search stock..."
              value={search}
              onChange={e => setSearch(e.target.value)}
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
              onPaginationModelChange={model => setPaginationModel(model)}
              pageSizeOptions={[10, 20, 50]}
              processRowUpdate={processRowUpdate}
              getRowId={(row) => row.id}
              onRowClick={user?.access_role === 'Sales and Purchase' ? undefined : handleRowClick}
              sx={{
                cursor: 'pointer',
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
      {/* Cleanup preview dialog */}
      <Dialog open={showCleanupPreview} onClose={() => setShowCleanupPreview(false)} maxWidth="md" fullWidth>
        <DialogTitle>Clean and Enforce Rules (Preview)</DialogTitle>
        <DialogContent>
          {cleanupPreview ? (
            <Box>
              <Typography variant="h6">Fixes</Typography>
              <List dense>
                {(cleanupPreview.fixes || []).slice(0, 200).map((f: any, idx: number) => (
                  <ListItem key={idx}>
                    <ListItemText primary={`${f.part_number} -> ${f.cleaned_part_number}`} secondary={(f.actions || []).join(', ')} />
                  </ListItem>
                ))}
              </List>
              <Typography variant="h6" sx={{ mt: 2 }}>Potential Duplicates</Typography>
              <List dense>
                {(cleanupPreview.duplicateGroups || []).map((g: any, idx: number) => (
                  <ListItem key={idx}>
                    <ListItemText
                      primary={`Keep ${g.proposedKeep} → merge ${g.candidates.map((c: any) => c.part_number).filter((pn: string) => pn !== g.proposedKeep).join(', ') || 'none'}`}
                      secondary={g.unitMismatch ? 'Unit mismatch detected - will not merge differing units' : undefined}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : (
            <Typography>Loading preview...</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCleanupPreview(false)}>Cancel</Button>
          <Button onClick={applyCleanup} variant="contained" disabled={cleaning}>Apply</Button>
        </DialogActions>
      </Dialog>
      <UnifiedPartDialog
        open={openPartDialog}
        onClose={handleClosePartDialog}
        onSave={handleSavePart}
        initialPart={editingPart || undefined}
        isEditMode={!!editingPart}
        title={editingPart ? 'Edit Inventory Part' : 'Add New Inventory Part'}
      />
      <Dialog open={editDialogOpen} onClose={handleCloseEditDialog} maxWidth="md" fullWidth>
        <DialogTitle>Edit Inventory Part</DialogTitle>
        <DialogContent>
          {editPart && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField label="Part Number" value={editPart.part_number || ''} fullWidth disabled />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Part Description" value={editPart.part_description || ''} onChange={e => handleEditField('part_description', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Unit" value={editPart.unit || ''} onChange={e => handleEditField('unit', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Last Unit Cost" type="number" value={editPart.last_unit_cost || ''} onChange={e => handleEditField('last_unit_cost', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Quantity on Hand" type="number" value={editPart.quantity_on_hand || ''} onChange={e => handleEditField('quantity_on_hand', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Reorder Point" type="number" value={editPart.reorder_point || ''} onChange={e => handleEditField('reorder_point', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Part Type" value={editPart.part_type || ''} onChange={e => handleEditField('part_type', e.target.value)} fullWidth />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog}>Cancel</Button>
          <Button onClick={handleSaveEdit} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      {/* CSV Upload Result Dialog */}
      <Dialog open={showUploadResult} onClose={closeUploadResult} maxWidth="md" fullWidth>
        <DialogTitle>
          {uploadResult?.error ? 'Upload Failed' : 'Upload Completed'}
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
                  {uploadResult.message}
                </Alert>
              )}

              {uploadResult.summary && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" gutterBottom>Summary</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} sm={3}>
                      <Chip label={`Total: ${uploadResult.summary.totalProcessed}`} color="primary" />
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Chip label={`New: ${uploadResult.summary.newItems}`} color="success" />
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Chip label={`Updated: ${uploadResult.summary.updatedItems}`} color="info" />
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Chip label={`Errors: ${uploadResult.summary.errors}`} color="error" />
                    </Grid>
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

      {/* Cleanup Result Dialog */}
      <Dialog open={showCleanupResult} onClose={closeCleanupResult} maxWidth="sm" fullWidth>
        <DialogTitle>
          {cleanupResult?.error ? 'Cleanup Failed' : 'Cleanup Completed'}
        </DialogTitle>
        <DialogContent>
          {cleanupResult && (
            <Box>
              {cleanupResult.error ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {cleanupResult.message}
                  {cleanupResult.details && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Details: {cleanupResult.details}
                    </Typography>
                  )}
                </Alert>
              ) : (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {cleanupResult.message}
                </Alert>
              )}

              {cleanupResult.summary && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" gutterBottom>Summary</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} sm={4}>
                      <Chip label={`Total: ${cleanupResult.summary.totalProcessed}`} color="primary" />
                    </Grid>
                    <Grid item xs={6} sm={4}>
                      <Chip label={`Updated: ${cleanupResult.summary.itemsUpdated}`} color="success" />
                    </Grid>
                    <Grid item xs={6} sm={4}>
                      <Chip label={`Errors: ${cleanupResult.summary.errors}`} color="error" />
                    </Grid>
                  </Grid>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCleanupResult} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default InventoryPage;
