import React from 'react';
import { Box, Container, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { EULA_BODY, EULA_EFFECTIVE_DATE, EULA_TITLE } from '../content/legalDocuments';

const LegalEulaPage: React.FC = () => (
  <Container maxWidth="md" sx={{ py: 6 }}>
    <Typography variant="h4" sx={{ mb: 1 }}>
      {EULA_TITLE}
    </Typography>
    <Typography variant="body2" sx={{ mb: 3 }}>
      Effective Date: {EULA_EFFECTIVE_DATE}
    </Typography>
    <Typography component="div" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
      {EULA_BODY}
    </Typography>
    <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
      <Link component={RouterLink} to="/privacy-policy">
        View Privacy Policy
      </Link>
      <Link component={RouterLink} to="/login">
        Back to Sign In
      </Link>
    </Box>
  </Container>
);

export default LegalEulaPage;
