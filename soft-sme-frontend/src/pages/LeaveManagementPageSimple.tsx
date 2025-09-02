import React from 'react';
import { Container, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

const LeaveManagementPageSimple: React.FC = () => {
  const { user } = useAuth();

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Leave Management - Simple Test
      </Typography>
      <Typography variant="body1">
        User: {user?.email || 'Not logged in'}
      </Typography>
      <Typography variant="body1">
        Role: {user?.access_role || 'No role'}
      </Typography>
      <Typography variant="body1">
        This is a test page to verify the route is working.
      </Typography>
    </Container>
  );
};

export default LeaveManagementPageSimple;

