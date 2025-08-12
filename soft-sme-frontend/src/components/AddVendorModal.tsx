import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Grid } from '@mui/material';
import api from '../api/axios';
import { toast } from 'react-toastify';

interface AddVendorModalProps {
  open: boolean;
  onClose: () => void;
  onVendorAdded: (newVendor: { id: number; label: string }) => void;
  initialVendorName?: string;
}

const AddVendorModal: React.FC<AddVendorModalProps> = ({ open, onClose, onVendorAdded, initialVendorName }) => {
  const [newVendor, setNewVendor] = useState({
    name: '',
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

  useEffect(() => {
    if (open) {
      console.log('AddVendorModal opening with initialVendorName:', initialVendorName);
      setNewVendor(prev => ({ 
        ...prev, 
        name: initialVendorName || '' 
      }));
    }
  }, [open, initialVendorName]);

  const handleCreateVendor = async () => {
    if (!newVendor.name) {
      toast.error('Vendor name is required.');
      return;
    }
    try {
      const response = await api.post('/api/vendors', { vendor_name: newVendor.name, ...newVendor });
      const createdVendor = response.data.vendor;
      toast.success('Vendor added successfully!');
      onVendorAdded({ id: createdVendor.vendor_id, label: createdVendor.vendor_name });
      onClose();
    } catch (error) {
      console.error('Error creating vendor:', error);
      toast.error('Failed to add vendor.');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewVendor({ ...newVendor, [e.target.name]: e.target.value });
  };

  const handleClose = () => {
    setNewVendor({
      name: '',
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
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add New Vendor</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              label="Vendor Name"
              name="name"
              value={newVendor.name}
              onChange={handleChange}
              fullWidth
              required
              helperText={`Current value: "${newVendor.name}"`}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Street Address"
              name="street_address"
              value={newVendor.street_address}
              onChange={handleChange}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="City" name="city" value={newVendor.city} onChange={handleChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Province" name="province" value={newVendor.province} onChange={handleChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Country" name="country" value={newVendor.country} onChange={handleChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Postal Code" name="postal_code" value={newVendor.postal_code} onChange={handleChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Contact Person"
              name="contact_person"
              value={newVendor.contact_person}
              onChange={handleChange}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Telephone Number"
              name="telephone_number"
              value={newVendor.telephone_number}
              onChange={handleChange}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Email" name="email" value={newVendor.email} onChange={handleChange} fullWidth />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Website" name="website" value={newVendor.website} onChange={handleChange} fullWidth />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleCreateVendor} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddVendorModal; 