import React from 'react';
import {
  Box,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import SegmentIcon from '@mui/icons-material/Segment';
import { VoiceCallArtifact } from '../types/voice';

interface Props {
  artifacts: VoiceCallArtifact[];
}

const statusColorMap: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  initiated: 'warning',
  ringing: 'warning',
  connected: 'success',
  completed: 'success',
  hangup: 'default',
  failed: 'error',
};

const VoiceCallSummaryList: React.FC<Props> = ({ artifacts }) => {
  if (!artifacts.length) return null;

  return (
    <Stack spacing={2}>
      {artifacts.map((artifact) => (
        <Paper
          key={artifact.sessionId}
          variant="outlined"
          sx={{
            p: 2.5,
            borderRadius: 2,
            bgcolor: (theme) => theme.palette.grey[50],
          }}
        >
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Vendor call #{artifact.sessionId}
              </Typography>
              <Chip
                size="small"
                color={statusColorMap[artifact.status?.toLowerCase()] ?? 'default'}
                label={artifact.status?.toUpperCase() || 'UNKNOWN'}
              />
              {artifact.purchaseNumber && (
                <Chip size="small" variant="outlined" label={`PO ${artifact.purchaseNumber}`} />
              )}
            </Stack>

            <Grid container spacing={2}>
              {artifact.vendor?.name && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="body2" color="text.secondary">
                    Vendor
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {artifact.vendor.name}
                  </Typography>
                  {artifact.vendor.phone && (
                    <Stack direction="row" alignItems="center" spacing={1} mt={0.5}>
                      <PhoneIcon fontSize="small" color="action" />
                      <Typography variant="body2">{artifact.vendor.phone}</Typography>
                    </Stack>
                  )}
                </Grid>
              )}

              {artifact.capturedEmail && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="body2" color="text.secondary">
                    Contact Email
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={1} mt={0.5}>
                    <EmailIcon fontSize="small" color="action" />
                    <Typography variant="body2">{artifact.capturedEmail}</Typography>
                  </Stack>
                </Grid>
              )}

              {artifact.pickupTime && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="body2" color="text.secondary">
                    Pickup Window
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={1} mt={0.5}>
                    <ScheduleIcon fontSize="small" color="action" />
                    <Typography variant="body2">{artifact.pickupTime}</Typography>
                  </Stack>
                </Grid>
              )}
            </Grid>

            {artifact.parts && artifact.parts.length > 0 && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Confirmed Parts
                </Typography>
                <List dense>
                  {artifact.parts.map((part, idx) => (
                    <ListItem key={`${artifact.sessionId}-part-${idx}`} disablePadding>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <SegmentIcon fontSize="small" color="action" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${part.part_number} × ${part.quantity}`}
                        secondary={part.notes || undefined}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {artifact.summary && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Call Summary
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {artifact.summary}
                </Typography>
              </Box>
            )}

            {artifact.nextSteps && artifact.nextSteps.length > 0 && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <AssignmentTurnedInIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    Next Steps
                  </Typography>
                </Stack>
                <List dense>
                  {artifact.nextSteps.map((step, idx) => (
                    <ListItem key={`${artifact.sessionId}-step-${idx}`} disablePadding>
                      <ListItemText primary={step} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {artifact.transcriptPreview && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Transcript Preview
                </Typography>
                <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                  {artifact.transcriptPreview}
                </Typography>
              </Box>
            )}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
};

export default VoiceCallSummaryList;
