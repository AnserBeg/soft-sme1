import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@mui/material';
import {
  EULA_BODY,
  EULA_EFFECTIVE_DATE,
  EULA_TITLE,
  PRIVACY_POLICY_BODY,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_TITLE,
} from '../content/legalDocuments';

interface LegalAgreementDialogProps {
  open: boolean;
  loading?: boolean;
  error?: string | null;
  onAccept: () => void;
}

const LegalAgreementDialog: React.FC<LegalAgreementDialogProps> = ({
  open,
  loading = false,
  error,
  onAccept,
}) => {
  const [checked, setChecked] = useState(false);
  const disabled = loading || !checked;

  useEffect(() => {
    if (open) {
      setChecked(false);
    }
  }, [open]);

  const handleAccept = () => {
    if (!disabled) {
      onAccept();
    }
  };

  const bodyStyles = useMemo(
    () => ({
      whiteSpace: 'pre-wrap',
      fontSize: 14,
      lineHeight: 1.6,
    }),
    []
  );

  return (
    <Dialog
      open={open}
      onClose={() => {}}
      maxWidth="md"
      fullWidth
      disableEscapeKeyDown
    >
      <DialogTitle>Review and Accept</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Please read and accept the End-User License Agreement and Privacy Policy to continue.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            {EULA_TITLE}
          </Typography>
          <Typography variant="caption" sx={{ mb: 2, display: 'block' }}>
            Effective Date: {EULA_EFFECTIVE_DATE}
          </Typography>
          <Typography component="div" sx={bodyStyles}>
            {EULA_BODY}
          </Typography>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            {PRIVACY_POLICY_TITLE}
          </Typography>
          <Typography variant="caption" sx={{ mb: 2, display: 'block' }}>
            Effective Date: {PRIVACY_POLICY_EFFECTIVE_DATE}
          </Typography>
          <Typography component="div" sx={bodyStyles}>
            {PRIVACY_POLICY_BODY}
          </Typography>
        </Box>

        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Checkbox
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
          }
          label="I have read and agree to the End-User License Agreement and Privacy Policy."
        />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={handleAccept} disabled={disabled}>
          {loading ? 'Saving...' : 'Accept and Continue'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LegalAgreementDialog;
