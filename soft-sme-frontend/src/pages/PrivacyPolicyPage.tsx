import React from 'react';
import { Box, Container, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  PRIVACY_POLICY_BODY,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_TITLE,
} from '../content/legalDocuments';

const PrivacyPolicyPage: React.FC = () => (
  <Container maxWidth="md" sx={{ py: 6 }}>
    <Typography variant="h4" sx={{ mb: 1 }}>
      {PRIVACY_POLICY_TITLE}
    </Typography>
    <Typography variant="body2" sx={{ mb: 3 }}>
      Effective Date: {PRIVACY_POLICY_EFFECTIVE_DATE}
    </Typography>
    <Typography component="div" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
      {PRIVACY_POLICY_BODY}
    </Typography>
    <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
      <Link component={RouterLink} to="/eula">
        View EULA
      </Link>
      <Link component={RouterLink} to="/login">
        Back to Sign In
      </Link>
    </Box>
  </Container>
);

export default PrivacyPolicyPage;
