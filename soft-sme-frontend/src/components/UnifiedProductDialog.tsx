import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Grid } from '@mui/material';
import { useDebounce } from '../hooks/useDebounce';

export interface ProductFormValues {
  product_name: string;
}

interface UnifiedProductDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (product: ProductFormValues) => void;
  initialProduct?: Partial<ProductFormValues>;
  isEditMode?: boolean;
  loading?: boolean;
}

const defaultProduct: ProductFormValues = {
  product_name: '',
};

const UnifiedProductDialog: React.FC<UnifiedProductDialogProps> = ({
  open,
  onClose,
  onSave,
  initialProduct,
  isEditMode = false,
  loading = false,
}) => {
  const [product, setProduct] = useState<ProductFormValues>(defaultProduct);
  const [error, setError] = useState<string | null>(null);
  const debouncedProduct = useDebounce(product, 300);

  useEffect(() => {
    if (open) {
      setProduct({ ...defaultProduct, ...initialProduct });
      setError(null);
    }
  }, [open, initialProduct]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProduct((prev) => ({ ...prev, [name]: value }));
  };

  const validate = () => {
    if (!product.product_name.trim()) {
      setError('Product name is required');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(product);
  };

  // Example debounced side-effect: basic duplicate product name hint (optional, placeholder)
  useEffect(() => {
    if (!open) return;
    // Placeholder for async validations or lookups based on debouncedProduct
  }, [debouncedProduct, open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Product' : 'Add New Product'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField 
              name="product_name" 
              label="Product Name" 
              value={product.product_name} 
              onChange={handleInputChange} 
              fullWidth 
              required 
              autoFocus
            />
          </Grid>
        </Grid>
        {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading}>
          {isEditMode ? 'Save Changes' : 'Add Product'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedProductDialog; 