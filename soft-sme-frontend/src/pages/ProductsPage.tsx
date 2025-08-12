import React, { useEffect, useState } from 'react';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import {
  Typography,
  Container,
  Box,
  Button,
  TextField,
  Paper,
  Stack,
  IconButton,
  InputAdornment,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import Papa from 'papaparse';

import api from '../api/axios';
import { getProducts } from '../services/productService';
import { Product } from '../types/product';
import { toast } from 'react-toastify';
import UnifiedProductDialog, { ProductFormValues } from '../components/UnifiedProductDialog';

const ProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getProducts();
      const sorted = [...response].sort((a, b) => Number(b.product_id) - Number(a.product_id));
      setProducts(sorted);
    } catch (err) {
      setError('Failed to fetch products');
      toast.error('Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const needle = searchTerm.toLowerCase();
    return (
      p.product_name?.toLowerCase().includes(needle) ||
      (p as any).product_description?.toLowerCase?.().includes(needle) ||
      String(p.product_id ?? '').toLowerCase().includes(needle)
    );
  });

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    try {
      await api.delete(`/api/products/${id}`);
      setProducts((prev) => prev.filter((product) => product.product_id !== id));
      toast.success('Product deleted successfully');
    } catch {
      toast.error('Failed to delete product');
    }
  };

  const handleExportCSV = () => {
    const rows = filteredProducts.map((p) => ({
      'Product ID': p.product_id,
      'Product Name': p.product_name,
      'Product Description': (p as any).product_description ?? '',
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', 'products.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setExportSuccess('Products exported to CSV.');
  };

  const handleAddProduct = () => setIsAddProductModalOpen(true);
  const handleCloseAddProductModal = () => setIsAddProductModalOpen(false);

  const columns: GridColDef[] = [
    { field: 'product_id', headerName: 'Product ID', flex: 0.8, minWidth: 110 },
    { field: 'product_name', headerName: 'Product Name', flex: 1.4, minWidth: 200 },
    {
      field: 'product_description',
      headerName: 'Product Description',
      flex: 2,
      minWidth: 250,
      valueGetter: (params) => (params.row as any).product_description ?? '',
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 90,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (params) => (
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(params.row.product_id);
          }}
        >
          <DeleteIcon />
        </IconButton>
      ),
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Product List
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Stack direction="row" spacing={2}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddProduct}>
              New Product
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV}>
              Export CSV
            </Button>
          </Stack>
        </Box>
      </Box>

      <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
        <Box sx={{ p: 2 }}>
          {/* Full-width search bar */}
          <TextField
            fullWidth
            label="Search"
            variant="outlined"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 22 }} />
                </InputAdornment>
              ),
            }}
            sx={{
              mb: 2,
              '& .MuiInputBase-input': { fontSize: 22, py: 2 },
              '& .MuiInputLabel-root': { fontSize: 20 },
            }}
            size="small"
          />

          <DataGrid
            rows={filteredProducts.map((p) => ({ ...p, id: p.product_id }))}
            columns={columns}
            loading={loading}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50]}
            getRowId={(row) => row.id}
            disableRowSelectionOnClick
            initialState={{
              sorting: { sortModel: [{ field: 'product_id', sort: 'desc' }] },
            }}
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

      {exportError && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setExportError(null)}>
          {exportError}
        </Alert>
      )}
      {exportSuccess && (
        <Alert severity="success" sx={{ mt: 2 }} onClose={() => setExportSuccess(null)}>
          {exportSuccess}
        </Alert>
      )}

      {error && <Typography color="error">{error}</Typography>}

      <UnifiedProductDialog
        open={isAddProductModalOpen}
        onClose={handleCloseAddProductModal}
        onSave={async (product: ProductFormValues) => {
          try {
            await api.post('/api/products', product);
            toast.success('Product added successfully!');
            setIsAddProductModalOpen(false);
            fetchProducts();
          } catch (err) {
            toast.error('Failed to add product');
          }
        }}
        isEditMode={false}
      />
    </Container>
  );
};

export default ProductsPage;
