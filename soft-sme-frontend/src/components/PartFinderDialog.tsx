import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Grid,
  Button,
  Chip,
  Typography,
  IconButton,
  Tooltip,
  Divider,
  TextField,
  InputAdornment
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import StarIcon from '@mui/icons-material/Star';

import { fetchFacetSuggestions, postClick, postShow } from '../api/tokens';
import VoiceSearchButton from './VoiceSearchButton';
import api from '../api/axios';

export interface PartLite {
  part_number: string;
  part_description: string;
}

type FinderContext = 'line' | 'pto';

interface PartFinderDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (part: PartLite) => void;
  salesOrderId: number;
  context: FinderContext;
  inventoryItems: PartLite[];
}



function storageKey(kind: 'recents' | 'favorites', salesOrderId: number, context: FinderContext) {
  return `so:${salesOrderId}:${kind}:${context}`;
}

function readList(kind: 'recents' | 'favorites', salesOrderId: number, context: FinderContext): string[] {
  try {
    const raw = localStorage.getItem(storageKey(kind, salesOrderId, context));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeList(kind: 'recents' | 'favorites', salesOrderId: number, context: FinderContext, values: string[]) {
  try { localStorage.setItem(storageKey(kind, salesOrderId, context), JSON.stringify(values.slice(0, 50))); } catch {}
}

type UsageMap = Record<string, { count: number; last: number }>;
function usageKeyGlobal() { return 'partFinder:usage:global'; }
function usageKeySO(salesOrderId: number, context: FinderContext) { return `partFinder:usage:so:${salesOrderId}:${context}`; }
function readUsageGlobal(): UsageMap {
  try { const raw = localStorage.getItem(usageKeyGlobal()); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function writeUsageGlobal(map: UsageMap) { try { localStorage.setItem(usageKeyGlobal(), JSON.stringify(map)); } catch {} }
function readUsageSO(salesOrderId: number, context: FinderContext): UsageMap {
  try { const raw = localStorage.getItem(usageKeySO(salesOrderId, context)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function writeUsageSO(salesOrderId: number, context: FinderContext, map: UsageMap) {
  try { localStorage.setItem(usageKeySO(salesOrderId, context), JSON.stringify(map)); } catch {}
}

export default function PartFinderDialog(props: PartFinderDialogProps) {
  const { open, onClose, onSelect, salesOrderId, context, inventoryItems } = props;

  // UI state
  const [query, setQuery] = useState<string>('');
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [soUsage, setSoUsage] = useState<UsageMap>({});
  const [globalUsage, setGlobalUsage] = useState<UsageMap>({});
  
  // New faceted search state
  const [facetData, setFacetData] = useState<any>(null);
  const [loadingFacets, setLoadingFacets] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFavorites(readList('favorites', salesOrderId, context));
    setRecents(readList('recents', salesOrderId, context));
    setSoUsage(readUsageSO(salesOrderId, context));
    setGlobalUsage(readUsageGlobal());
    setQuery('');
    setSelectedTokens([]);
  }, [open, salesOrderId, context]);

  // Fetch facet data when dialog opens or tokens change
  useEffect(() => {
    if (!open) return;
    
    const fetchFacets = async () => {
      setLoadingFacets(true);
      try {
        // Only fetch facet suggestions when no tokens are selected
        if (selectedTokens.length === 0) {
          const data = await fetchFacetSuggestions([]);
          setFacetData(data);
          
          // Record token shows for analytics
          if (data.suggestions) {
            const allTokens = Object.values(data.suggestions).flat().map((t: any) => ({
              token_type: 'GENERIC',
              token_value: t.value
            }));
            await postShow(allTokens);
          }
        }
      } catch (error) {
        console.error('Error fetching facets:', error);
      } finally {
        setLoadingFacets(false);
      }
    };

    fetchFacets();
  }, [open, selectedTokens]);

  // Search for parts when tokens are selected
  useEffect(() => {
    console.log('🔍 Search useEffect triggered:', { open, selectedTokensLength: selectedTokens.length });
    
    if (!open || selectedTokens.length === 0) {
      console.log('🔍 Skipping search - dialog not open or no tokens selected');
      return;
    }
    
    const searchParts = async () => {
      console.log('🔍 Starting search for parts with tokens:', selectedTokens);
      setLoadingFacets(true);
      
      try {
        const response = await api.post('/api/voice-search/search-by-tokens', { tokens: selectedTokens });
        
        console.log('🔍 Search response received:', response);
        
        if (response.status !== 200) {
          throw new Error(`Search failed: ${response.status}`);
        }
        
        const data = response.data;
        console.log('🔍 Search results data:', data);
        console.log('🔍 Number of parts found:', data.parts?.length || 0);
        
        // Update facet data with search results
        const newFacetData = {
          parts: data.parts || [],
          suggestions: generateSuggestionsFromParts(data.parts || [])
        };
        
        console.log('🔍 Setting new facet data:', newFacetData);
        setFacetData(newFacetData);
        
      } catch (error) {
        console.error('❌ Error searching parts:', error);
        // Fallback to empty results
        setFacetData({
          parts: [],
          suggestions: generateSuggestionsFromParts([])
        });
      } finally {
        setLoadingFacets(false);
      }
    };

    searchParts();
  }, [open, selectedTokens]);

  // Items from faceted search backend
  const candidateItems = useMemo(() => {
    console.log('🔍 Building candidate items from facet data:', facetData);
    
    // Use facet data from backend if available
    if (facetData?.parts && facetData.parts.length > 0) {
      console.log('✅ Using facet data parts:', facetData.parts.length);
      return facetData.parts.map((p: any) => ({
        part_number: p.part_number,
        part_description: p.part_description
      }));
    }
    
    // Fallback to empty array if no facet data
    console.log('⚠️ No facet data parts, returning empty array');
    return [];
  }, [facetData]);

  // Get tokens from facet data instead of old dynamic generation
  const facetTokens = useMemo(() => {
    console.log('🔍 Building facet tokens from facet data:', facetData);
    
    if (!facetData?.suggestions) {
      console.log('⚠️ No facet suggestions available');
      return [];
    }
    
    const allTokens: Array<{type: string, value: string, count: number}> = [];
    Object.entries(facetData.suggestions).forEach(([type, tokens]: [string, any]) => {
      tokens.forEach((token: any) => {
        allTokens.push({
          type,
          value: token.value,
          count: token.count
        });
      });
    });
    
    // Sort by count, remove duplicates, and return top tokens
    const uniqueTokens = allTokens
      .sort((a, b) => b.count - a.count)
      .filter((token, index, self) => 
        index === self.findIndex(t => t.value === token.value)
      )
      .slice(0, 24)
      .map(t => t.value);
    
    console.log('✅ Generated facet tokens:', uniqueTokens.length);
    return uniqueTokens;
  }, [facetData]);

  // Apply filters
  const filtered = candidateItems;

  const topResults = useMemo(() => {
    console.log('🔍 Calculating top results from filtered items:', filtered.length);
    const results = filtered.slice(0, 200);
    console.log('🔍 Top results count:', results.length);
    return results;
  }, [filtered]);

  const toggleToken = async (t: string) => {
    setSelectedTokens(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
    
    // Record token click for analytics
    try {
      await postClick(t);
    } catch (error) {
      console.error('Error recording token click:', error);
    }
  };

  const clearAll = () => { 
    setSelectedTokens([]); 
  };

  // Generate token suggestions from parts
  const generateSuggestionsFromParts = (parts: any[]) => {
    if (!parts || parts.length === 0) return {};
    
    const suggestions: Record<string, Array<{value: string, count: number}>> = {
      'MATERIALS': [],
      'TYPES': [],
      'DIMENSIONS': [],
      'SPECIFICATIONS': []
    };
    
    const materialTokens = new Set<string>();
    const typeTokens = new Set<string>();
    const dimensionTokens = new Set<string>();
    const specTokens = new Set<string>();
    
    parts.forEach(part => {
      // Extract tokens from part numbers
      if (part.part_number) {
        const tokens = part.part_number.split(/[^A-Z0-9]+/).filter(t => t.length >= 2);
        tokens.forEach(token => {
          if (/^\d+$/.test(token)) {
            dimensionTokens.add(token);
          } else if (token.includes('X') || token.includes('GA') || token.includes('SCH')) {
            dimensionTokens.add(token);
          } else {
            specTokens.add(token);
          }
        });
      }
      
      // Extract tokens from descriptions
      if (part.part_description) {
        const words = part.part_description.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 2);
        words.forEach(word => {
          if (['STEEL', 'ALUMINUM', 'AL', 'STAINLESS', 'SS', 'GALVANIZED', 'GALV'].includes(word)) {
            materialTokens.add(word);
          } else if (['TUBE', 'TUBING', 'PIPE', 'ANGLE', 'BAR', 'PLATE', 'SHEET', 'ROUND', 'SQUARE'].includes(word)) {
            typeTokens.add(word);
          } else if (word.length >= 2) {
            specTokens.add(word);
          }
        });
      }
    });
    
    // Convert sets to arrays with counts
    suggestions.MATERIALS = Array.from(materialTokens).map(value => ({ value, count: 1 }));
    suggestions.TYPES = Array.from(typeTokens).map(value => ({ value, count: 1 }));
    suggestions.DIMENSIONS = Array.from(dimensionTokens).map(value => ({ value, count: 1 }));
    suggestions.SPECIFICATIONS = Array.from(specTokens).map(value => ({ value, count: 1 }));
    
    return suggestions;
  };

  // Handle voice search terms
  const handleVoiceSearchTerms = (terms: string[], strategy: {searchInPartNumbers: boolean, searchInDescriptions: boolean}) => {
    console.log('Voice search terms received:', terms, strategy);
    
    // Add the extracted terms to selected tokens
    setSelectedTokens(prev => {
      const newTokens = [...prev];
      terms.forEach(term => {
        if (!newTokens.includes(term)) {
          newTokens.push(term);
        }
      });
      return newTokens;
    });
    
    // Clear the text query since we're using voice search
    setQuery('');
  };

  const isFav = (partNumber: string) => favorites.includes(partNumber);
  const toggleFavorite = (partNumber: string) => {
    setFavorites(prev => {
      const next = prev.includes(partNumber) ? prev.filter(p => p !== partNumber) : [partNumber, ...prev];
      writeList('favorites', salesOrderId, context, next);
      // fire-and-forget server update
      try {
        api.post(`/part-finder/${salesOrderId}/favorite`, { part_number: partNumber, context, value: !prev.includes(partNumber) });
      } catch {}
      return next;
    });
  };

  const handleSelect = (part: PartLite) => {
    // update recents
    setRecents(prev => {
      const next = [part.part_number, ...prev.filter(p => p !== part.part_number)].slice(0, 20);
      writeList('recents', salesOrderId, context, next);
      return next;
    });
    // update usage (SO + global)
    setSoUsage(prev => {
      const next: UsageMap = { ...prev };
      const ent = next[part.part_number] || { count: 0, last: 0 };
      ent.count += 1; ent.last = Date.now();
      next[part.part_number] = ent;
      writeUsageSO(salesOrderId, context, next);
      return next;
    });
    setGlobalUsage(prev => {
      const next: UsageMap = { ...prev };
      const ent = next[part.part_number] || { count: 0, last: 0 };
      ent.count += 1; ent.last = Date.now();
      next[part.part_number] = ent;
      writeUsageGlobal(next);
      return next;
    });
    onSelect(part);
    // notify server (usage)
    try {
      api.post(`/part-finder/${salesOrderId}/use`, { part_number: part.part_number, context });
    } catch {}
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth fullScreen={false} aria-labelledby="part-finder-title">
      <DialogTitle id="part-finder-title">Find Part</DialogTitle>
      <DialogContent dividers>
        <Box mb={2}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              placeholder="Search by part # or description"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              InputProps={{ startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              ) }}
            />
            <VoiceSearchButton onSearchTerms={handleVoiceSearchTerms} />
          </Box>
        </Box>
        {/** Larger, touch-friendly chip style */}
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {(() => null)()}
        
        {/* Common chip styles */}
        {/* Using inline const to keep file simple */}
        {/* selectorChipSx applies bigger height and label padding/font */}
        {/* tokenChipSx similar but slightly lighter weight */}
        
        {/* Active filters */}
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={2}>
          {selectedTokens.map(t => (
            <Chip key={t} label={t} color="secondary" onDelete={() => toggleToken(t)}
              sx={{ height: 38, borderRadius: 2, '& .MuiChip-label': { px: 2, py: 1, fontSize: 15, fontWeight: 600 } }}
            />
          ))}
          {selectedTokens.length > 0 && (
            <Button onClick={clearAll}>Clear All</Button>
          )}
        </Box>

        {/* Faceted search tokens */}
        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom>
            Available Tokens {loadingFacets ? '(Loading...)' : ''}
          </Typography>
          {loadingFacets ? (
            <Typography variant="body2" color="text.secondary">Loading tokens...</Typography>
          ) : facetTokens.length > 0 ? (
            <Box display="flex" flexWrap="wrap" gap={1.5}>
              {facetTokens.map(tok => (
                <Chip
                  key={tok}
                  label={tok}
                  clickable
                  color={selectedTokens.includes(tok) ? 'secondary' : 'default'}
                  onClick={() => toggleToken(tok)}
                  sx={{ height: 40, borderRadius: 2, '& .MuiChip-label': { px: 2, py: 1, fontSize: 16, fontWeight: 600 } }}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No tokens available. {facetData ? `Facet data: ${JSON.stringify(facetData).substring(0, 100)}...` : 'No facet data loaded.'}
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Favorites and Recents chips (SO-specific) */}
        <Box mb={2}>
          {favorites.length > 0 && (
            <Box mb={1}>
              <Typography variant="subtitle2" gutterBottom>Favorites for this Sales Order</Typography>
              <Box display="flex" flexWrap="wrap" gap={1.25}>
                {favorites.map(pn => {
                  const item = inventoryItems.find(i => i.part_number === pn);
                  if (!item) return null;
                  return (
                    <Chip
                      key={pn}
                      label={`${item.part_number}`}
                      onClick={() => handleSelect(item)}
                      title={item.part_description}
                      sx={{ height: 38, borderRadius: 2, '& .MuiChip-label': { px: 2, py: 1, fontSize: 15, fontWeight: 600 } }}
                    />
                  );
                })}
              </Box>
            </Box>
          )}
          {recents.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Recents for this Sales Order</Typography>
              <Box display="flex" flexWrap="wrap" gap={1.25}>
                {recents.map(pn => {
                  const item = inventoryItems.find(i => i.part_number === pn);
                  if (!item) return null;
                  return (
                    <Chip
                      key={pn}
                      variant="outlined"
                      label={`${item.part_number}`}
                      onClick={() => handleSelect(item)}
                      title={item.part_description}
                      sx={{ height: 38, borderRadius: 2, '& .MuiChip-label': { px: 2, py: 1, fontSize: 15, fontWeight: 600 } }}
                    />
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>

        {/* Results grid */}
        <Grid container spacing={2}>
          {topResults.map((it) => (
            <Grid key={it.part_number} item xs={12} sm={6} md={4} lg={3}>
              <Box
                sx={{
                  border: '1px solid #ddd',
                  borderRadius: 1,
                  p: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  height: '100%',
                }}
              >
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{it.part_number}</Typography>
                  <Tooltip title={isFav(it.part_number) ? 'Remove favorite' : 'Add favorite'}>
                    <IconButton size="small" onClick={() => toggleFavorite(it.part_number)}>
                      {isFav(it.part_number) ? <StarIcon color="warning" fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
                  {it.part_description || '—'}
                </Typography>
                <Box mt="auto" display="flex" gap={1}>
                  <Button variant="contained" size="small" onClick={() => handleSelect(it)}>Add</Button>
                  <Button variant="outlined" size="small" onClick={() => { handleSelect(it); /* keep open */ }}>Add & Keep Open</Button>
                </Box>
              </Box>
            </Grid>
          ))}
          {topResults.length === 0 && (
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">No parts match the current filters.</Typography>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}


