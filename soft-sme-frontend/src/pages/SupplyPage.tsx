import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Typography, Box, TextField, Stack, Button, InputAdornment, Container, Paper, Alert, LinearProgress, List, ListItem, ListItemText, Chip } from '@mui/material';
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
import { getSupplyInventory, previewCleanupEnforce, applyCleanupEnforce } from '../services/inventoryService';
import Grid from '@mui/material/Grid';
import UnifiedPartDialog, { PartFormValues } from '../components/UnifiedPartDialog';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import MenuItem from '@mui/material/MenuItem';
import CategorySelect from '../components/CategorySelect';

const SupplyPage: React.FC = () => {
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

  // v6 paginationModel state
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  // Cleanup states
  const [cleaning, setCleaning] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<any>(null);
  const [showCleanupPreview, setShowCleanupPreview] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const [showCleanupResult, setShowCleanupResult] = useState(false);


  // Fetch inventory data from backend (only supply items)
  const fetchInventory = async () => {
    setLoading(true);
    try {
      const response = await getSupplyInventory();
      const dataWithIds = response.map((item: any, index: number) => ({ ...item, id: item.part_number || index }));
      setRows(dataWithIds);
    } catch (error) {
      console.error('Error fetching supply inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    fetchInventory();
    const handleSupplyUpdated = () => fetchInventory();
    window.addEventListener('supply-updated', handleSupplyUpdated);
    return () => window.removeEventListener('supply-updated', handleSupplyUpdated);
  }, []); // Empty dependency array means this runs once on mount

  // Filter rows by search text
  const filteredRows = rows.filter(row =>
    row.part_number?.toUpperCase().includes(search.toUpperCase()) ||
    row.part_description?.toLowerCase().includes(search.toLowerCase())
  );

  const columns: GridColDef[] = [
    { field: 'part_number', headerName: 'Part #', flex: 1, headerAlign: 'left', editable: true },
    { field: 'part_description', headerName: 'Part Description', flex: 2, headerAlign: 'left' },
    { field: 'category', headerName: 'Category', flex: 1, headerAlign: 'left' },
    { field: 'unit', headerName: 'UOM', flex: 0.5, headerAlign: 'left' },
    { field: 'last_unit_cost', headerName: 'Last Unit Cost', flex: 1, type: 'number', editable: true, align: 'center', headerAlign: 'left' },
    { field: 'reorder_point', headerName: 'Reorder Point', flex: 0.75, type: 'number', editable: true, align: 'center', headerAlign: 'left' },
    { field: 'part_type', headerName: 'Type', flex: 0.5, headerAlign: 'left' },
    {
      field: 'value',
      headerName: 'Value',
      flex: 1,
      type: 'number',
      valueGetter: (params) => {
        // For supply items, quantity_on_hand is "NA", so value is 0
        const q = params.row.quantity_on_hand === 'NA' ? 0 : (Number(params.row.quantity_on_hand) || 0);
        const c = Number(params.row.last_unit_cost) || 0;
        return q * c;
      },
      valueFormatter: (params) => {
        const v = Number(params.value) || 0;
        return `$${v.toFixed(2)}`;
      },
      headerAlign: 'center',
      align: 'center',
    },
    {
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
    },
  ];

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

  // Handle cell edit commit (for reorder_point, last_unit_cost, and part_number)
  const processRowUpdate = async (newRow: any, oldRow: any) => {
    console.log('Attempting to update row:', newRow);

    const updatedFields: any = {};
    
    // Handle part number changes
    if (newRow.part_number !== oldRow.part_number) {
      const newPartNumber = String(newRow.part_number).trim().toUpperCase();
      if (!newPartNumber) {
        alert('Part number cannot be empty.');
        return Promise.reject('Invalid part number');
      }
      updatedFields.part_number = newPartNumber;
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

    // Add handling for category
    if (newRow.category !== oldRow.category) {
      updatedFields.category = newRow.category;
    }

    if (Object.keys(updatedFields).length === 0) {
        console.log('No fields changed.');
        return newRow;
    }

    // Use the old part number for the API call URL, but include the new part number in the request body if it changed
    const apiPartNumber = updatedFields.part_number ? oldRow.part_number : newRow.part_number;

    try {
      // This PUT request now sends the updated fields including part_number if it changed
      const response = await api.put(`/api/inventory/${encodeURIComponent(apiPartNumber)}`, updatedFields);

      console.log(`Supply inventory updated for part ${apiPartNumber}:`, response.data);
      alert(`Part ${apiPartNumber} updated successfully!`);

      // Refresh the entire inventory list to handle part number changes properly
      await fetchInventory();

      return response.data.updatedItem || newRow;
    } catch (error) {
      console.error(`Error updating supply inventory for part ${apiPartNumber}:`, error);
      if (error instanceof AxiosError && error.response && error.response.data && (error.response.data as any).error) {
          alert(`Error updating inventory: ${(error.response.data as any).error}`);
      } else {
          alert(`Error updating inventory for part ${apiPartNumber}. Please check the console.`);
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
      value: (row.quantity_on_hand === 'NA' ? 0 : (Number(row.quantity_on_hand) || 0)) * (Number(row.last_unit_cost) || 0)
    }));
    const csv = Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'supply_list.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
    }
  };

  const handlePrintPDF = () => {
    // Use backend PDF generation
    window.open('/api/inventory/export/pdf?partType=supply', '_blank');
  };

  // Handle Add New Part button click
  const handleAddNewPart = () => {
    setEditingPart({
      part_number: '',
      part_description: '',
      unit: '',
      last_unit_cost: '',
      quantity_on_hand: 'NA',
      reorder_point: '',
      part_type: 'supply',
      category: 'Uncategorized'
    });
    setOpenPartDialog(true);
  };

  // New: Enforce rules and show potential duplicates, allow merging (supply)
  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const preview = await previewCleanupEnforce('supply');
      setCleanupPreview(preview?.preview || preview);
      setShowCleanupPreview(true);
    } catch (error) {
      console.error('Error during cleanup preview:', error);
      alert('Failed to analyze supply for cleanup.');
    } finally {
      setCleaning(false);
    }
  };

  const applyCleanup = async () => {
    if (!cleanupPreview) return;
    const merges = (cleanupPreview.duplicateGroups || []).map((g: any) => ({
      keepPartNumber: g.proposedKeep,
      mergePartNumbers: g.candidates.map((c: any) => c.part_number).filter((pn: string) => pn !== g.proposedKeep),
    }));
    setCleaning(true);
    try {
      const applied = await applyCleanupEnforce('supply', merges);
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



  const handleRowClick = (params: any) => {
    setEditingPart({
      part_id: params.row.part_id,
      part_number: params.row.part_number,
      part_description: params.row.part_description || '',
      unit: params.row.unit || 'Each',
      last_unit_cost: params.row.last_unit_cost || '',
      quantity_on_hand: params.row.quantity_on_hand || '',
      reorder_point: params.row.reorder_point || '',
      part_type: params.row.part_type || 'supply',
      category: params.row.category || 'Uncategorized'
    });
    setOpenPartDialog(true);
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
      link.setAttribute('download', 'supply_template.csv');
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

  return (
    <Container maxWidth="xl" sx={{ mt: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Supply List
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddNewPart}>New Part</Button>
            <Button variant="outlined" startIcon={<UploadIcon />} onClick={handleUploadClick}>Upload CSV</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadTemplate}>Download Template</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV}>Export CSV</Button>
            <Button variant="outlined" color="warning" onClick={handleCleanup} disabled={cleaning} startIcon={<DeleteIcon />}>
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
              placeholder="Search supply..."
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
              onRowClick={(params, event) => {
                // Only open dialog if clicking on non-editable cells or if not in editing mode
                const target = event.target as HTMLElement;
                const isEditableCell = target.closest('.MuiDataGrid-cell[data-field="part_number"]') ||
                                      target.closest('.MuiDataGrid-cell[data-field="last_unit_cost"]') ||
                                      target.closest('.MuiDataGrid-cell[data-field="reorder_point"]');
                
                if (!isEditableCell) {
                  handleRowClick(params);
                }
              }}
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
      <UnifiedPartDialog
        open={openPartDialog}
        onClose={handleClosePartDialog}
        onSave={handleSavePart}
        initialPart={editingPart || undefined}
        isEditMode={!!editingPart}
        title={editingPart ? 'Edit Supply Part' : 'Add New Supply Part'}
      />


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
                    <Grid item xs={6} sm={2}>
                      <Chip label={`Total: ${uploadResult.summary.totalProcessed}`} color="primary" />
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Chip label={`New: ${uploadResult.summary.newItems}`} color="success" />
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Chip label={`Updated: ${uploadResult.summary.updatedItems}`} color="info" />
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Chip label={`Vendor Mappings: ${uploadResult.summary.vendorMappings || 0}`} color="secondary" />
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Chip label={`Errors: ${uploadResult.summary.errors}`} color="error" />
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Chip label={`Warnings: ${uploadResult.summary.warnings}`} color="warning" />
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

      {/* Cleanup result dialog */}
      <Dialog open={showCleanupResult} onClose={() => setShowCleanupResult(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cleanup Completed</DialogTitle>
        <DialogContent>
          {cleanupResult ? (
            <Box>
              <Alert severity="success" sx={{ mb: 2 }}>Cleanup applied successfully.</Alert>
              <Typography variant="body2">Fixes applied: {cleanupResult?.applied?.fixesApplied || 0}</Typography>
              <Typography variant="body2">Fixes skipped: {cleanupResult?.applied?.fixesSkipped || 0}</Typography>
              <Typography variant="body2">Merged groups: {cleanupResult?.applied?.mergedGroups || 0}</Typography>
              <Typography variant="body2">Merged items: {cleanupResult?.applied?.mergedItems || 0}</Typography>
            </Box>
          ) : (
            <Typography>Loading...</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCleanupResult(false)} variant="contained">Close</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default SupplyPage; 