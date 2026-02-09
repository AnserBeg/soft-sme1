import React, { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Grid } from '@mui/material';

export interface SalesPersonFormValues {
  sales_person_id?: string;
  sales_person_name: string;
  email?: string;
  phone_number?: string;
}

interface UnifiedSalesPersonDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (person: SalesPersonFormValues) => void;
  initialSalesPerson?: Partial<SalesPersonFormValues>;
  isEditMode?: boolean;
  loading?: boolean;
}

const defaultSalesPerson: SalesPersonFormValues = {
  sales_person_id: '',
  sales_person_name: '',
  email: '',
  phone_number: '',
};

const UnifiedSalesPersonDialog: React.FC<UnifiedSalesPersonDialogProps> = ({
  open,
  onClose,
  onSave,
  initialSalesPerson,
  isEditMode = false,
  loading = false,
}) => {
  const [salesPerson, setSalesPerson] = useState<SalesPersonFormValues>(defaultSalesPerson);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSalesPerson({ ...defaultSalesPerson, ...initialSalesPerson });
      setError(null);
    }
  }, [open, initialSalesPerson]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSalesPerson((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    if (!salesPerson.sales_person_name.trim()) {
      setError('Sales person name is required');
      return;
    }
    setError(null);
    onSave(salesPerson);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Sales Person' : 'Add New Sales Person'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              name="sales_person_name"
              label="Sales Person Name"
              value={salesPerson.sales_person_name}
              onChange={handleInputChange}
              fullWidth
              required
              autoFocus
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              name="email"
              label="Email"
              type="email"
              value={salesPerson.email || ''}
              onChange={handleInputChange}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              name="phone_number"
              label="Phone Number"
              value={salesPerson.phone_number || ''}
              onChange={handleInputChange}
              fullWidth
            />
          </Grid>
        </Grid>
        {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading}>
          {isEditMode ? 'Save Changes' : 'Add Sales Person'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedSalesPersonDialog;
