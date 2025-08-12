import React from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Box, Container, Paper } from '@mui/material';

const VendorDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Vendor Detail Page
        </Typography>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Vendor ID: {id}</Typography>
          {/* Add postal code display if available in the future */}
          {/* <Typography variant="body1">Postal Code: {vendor?.postal_code}</Typography> */}
          <Typography variant="body1">This is a placeholder for the Vendor Detail Page.</Typography>
        </Paper>
      </Box>
    </Container>
  );
};

export default VendorDetailPage; 