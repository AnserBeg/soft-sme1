import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Container,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Grid,
  Card,
  CardContent,
  LinearProgress
} from '@mui/material';
import FacetSearch from '../components/FacetSearch';
import { rebuildPartTokens, getTokenCoverage } from '../api/tokens';

export default function FacetedSearchPage() {
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [showPartDialog, setShowPartDialog] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState<string>('');
  const [coverageStats, setCoverageStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const loadCoverageStats = async () => {
    try {
      setLoadingStats(true);
      const stats = await getTokenCoverage();
      setCoverageStats(stats);
    } catch (error) {
      console.error('Error loading coverage stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    loadCoverageStats();
  }, []);

  const handlePartSelect = (part: any) => {
    setSelectedPart(part);
    setShowPartDialog(true);
  };

  const handleRebuildTokens = async () => {
    try {
      setRebuildStatus('Rebuilding tokens...');
      const result = await rebuildPartTokens();
      setRebuildStatus(`Successfully rebuilt tokens for ${result.count} parts`);
      // Reload stats after rebuild
      await loadCoverageStats();
      setTimeout(() => setRebuildStatus(''), 5000);
    } catch (error) {
      setRebuildStatus('Error rebuilding tokens');
      console.error('Error rebuilding tokens:', error);
    }
  };

  return (
    <Container maxWidth="lg">
      <Box py={4}>
        <Typography variant="h4" gutterBottom>
          Faceted Part Search
        </Typography>
        
                            <Typography variant="body1" color="text.secondary" mb={3}>
                      Use the facets below to search for parts. Click on tokens to narrow your search.
                    </Typography>

                    {rebuildStatus && (
                      <Alert severity={rebuildStatus.includes('Error') ? 'error' : 'success'} sx={{ mb: 2 }}>
                        {rebuildStatus}
                      </Alert>
                    )}

                    {/* Coverage Statistics */}
                    {coverageStats && (
                      <Grid container spacing={2} mb={3}>
                        <Grid item xs={12} md={4}>
                          <Card>
                            <CardContent>
                              <Typography variant="h6" gutterBottom>
                                Token Coverage
                              </Typography>
                              <Typography variant="h4" color="primary">
                                {coverageStats.coverage.parts_with_tokens}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                of {coverageStats.coverage.total_parts} parts have tokens
                              </Typography>
                              <LinearProgress 
                                variant="determinate" 
                                value={(coverageStats.coverage.parts_with_tokens / coverageStats.coverage.total_parts) * 100}
                                sx={{ mt: 1 }}
                              />
                            </CardContent>
                          </Card>
                        </Grid>
                        <Grid item xs={12} md={4}>
                          <Card>
                            <CardContent>
                              <Typography variant="h6" gutterBottom>
                                Total Tokens
                              </Typography>
                              <Typography variant="h4" color="secondary">
                                {coverageStats.coverage.total_tokens}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                tokens extracted from inventory
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                        <Grid item xs={12} md={4}>
                          <Card>
                            <CardContent>
                              <Typography variant="h6" gutterBottom>
                                Token Origins
                              </Typography>
                              {coverageStats.origins?.slice(0, 3).map((origin: any) => (
                                <Typography key={origin.origin} variant="body2" color="text.secondary">
                                  {origin.origin}: {origin.tokens} tokens
                                </Typography>
                              ))}
                            </CardContent>
                          </Card>
                        </Grid>
                      </Grid>
                    )}

                    <Box mb={3}>
                      <Button
                        variant="outlined"
                        onClick={handleRebuildTokens}
                        disabled={rebuildStatus.includes('Rebuilding')}
                      >
                        Rebuild Token Index
                      </Button>
                    </Box>

        <Paper elevation={2} sx={{ p: 3 }}>
          <FacetSearch onPartSelect={handlePartSelect} />
        </Paper>

        {/* Part Details Dialog */}
        <Dialog 
          open={showPartDialog} 
          onClose={() => setShowPartDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Part Details</DialogTitle>
          <DialogContent>
            {selectedPart && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {selectedPart.part_number}
                </Typography>
                <Typography variant="body1" color="text.secondary" paragraph>
                  {selectedPart.part_description}
                </Typography>
                <Typography variant="body2">
                  Part ID: {selectedPart.part_id}
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowPartDialog(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Container>
  );
}
