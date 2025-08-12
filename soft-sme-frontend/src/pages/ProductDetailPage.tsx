import React from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Box, Container, Paper } from '@mui/material';

const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Product Detail Page
        </Typography>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Product ID: {id}</Typography>
          <Typography variant="body1">This is a placeholder for the Product Detail Page.</Typography>
        </Paper>
      </Box>
    </Container>
  );
};

export default ProductDetailPage; 