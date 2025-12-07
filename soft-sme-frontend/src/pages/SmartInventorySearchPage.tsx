import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import InsightsIcon from '@mui/icons-material/Insights';
import InventoryIcon from '@mui/icons-material/Inventory';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import { getInventory } from '../services/inventoryService';
import { analyzeQuery, indexInventoryForSmartSearch, smartSearchInventory, SmartSearchHit } from '../utils/smartInventorySearch';
import { PART_SEARCH_DICTIONARY } from '../utils/partSearchDictionary';

type InventoryItem = {
  part_number: string;
  part_description: string;
  category?: string;
  part_type?: string;
  quantity_on_hand?: number;
  unit?: string;
  last_unit_cost?: number;
};

type PartTypeFilter = 'all' | 'stock' | 'supply' | 'service';

const SmartInventorySearchPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [partType, setPartType] = useState<PartTypeFilter>('all');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SmartSearchHit<InventoryItem>[]>([]);
  const [queryUnderstanding, setQueryUnderstanding] = useState(() => analyzeQuery(''));

  const indexedItems = useMemo(() => indexInventoryForSmartSearch(inventory), [inventory]);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getInventory(partType === 'all' ? undefined : partType);
      setInventory(data || []);
    } catch (err: any) {
      console.error('Failed to load inventory for smart search', err);
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'Could not load inventory. Check your connection and try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [partType]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  useEffect(() => {
    const handleInventoryUpdated = () => fetchInventory();
    window.addEventListener('inventory-updated', handleInventoryUpdated);
    return () => window.removeEventListener('inventory-updated', handleInventoryUpdated);
  }, [fetchInventory]);

  useEffect(() => {
    const id = setTimeout(() => {
      setQueryUnderstanding(analyzeQuery(query));
      setResults(smartSearchInventory(indexedItems, query));
    }, 180);
    return () => clearTimeout(id);
  }, [query, indexedItems]);

  const renderBadgeRow = (label: string, values: string[], placeholder?: string) => (
    <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 120, fontWeight: 600 }}>
        {label}
      </Typography>
      {values.length === 0 && placeholder ? (
        <Typography variant="caption" color="text.disabled">
          {placeholder}
        </Typography>
      ) : (
        values.slice(0, 24).map((value) => <Chip key={`${label}-${value}`} label={value} size="small" />)
      )}
    </Stack>
  );

  const summaryTokens = useMemo(() => {
    const expandedSet = new Set(queryUnderstanding.expandedTokens);
    queryUnderstanding.tokens.forEach((t) => expandedSet.delete(t));
    return Array.from(expandedSet);
  }, [queryUnderstanding]);

  return (
    <Box>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 3,
          background: 'linear-gradient(120deg, #0f172a, #0b5dab)',
          color: 'white',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <AutoAwesomeIcon fontSize="small" />
              <Typography variant="body2" sx={{ letterSpacing: 0.5 }}>
                Dictionary-driven search • v{PART_SEARCH_DICTIONARY.version}
              </Typography>
            </Stack>
            <Typography variant="h4" fontWeight={800}>
              Smart Inventory Search
            </Typography>
            <Typography variant="body1" sx={{ opacity: 0.8, maxWidth: 720, mt: 1 }}>
              Find parts using abbreviations, grades, finishes, or full descriptions. The search engine expands synonyms,
              grades, and dimensions from the truck/trailer fabrication dictionary before matching against your inventory.
            </Typography>
          </Box>
          <Stack spacing={1.5} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
            <Chip icon={<InventoryIcon />} label={`${inventory.length} parts indexed`} variant="filled" color="default" sx={{ bgcolor: 'rgba(255,255,255,0.12)', color: 'white' }} />
            <Chip icon={<InsightsIcon />} label={`Domain: ${PART_SEARCH_DICTIONARY.domain}`} variant="outlined" sx={{ borderColor: 'rgba(255,255,255,0.4)', color: 'white' }} />
          </Stack>
        </Stack>
      </Paper>

      <Paper elevation={1} sx={{ p: 2.5, mb: 2.5, borderRadius: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box sx={{ flex: 1, position: 'relative' }}>
              <TextField
                fullWidth
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Try "gr8 hex bolt 3/8 x 1 galvanized" or "2in sch40 pipe"'
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            </Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <FilterAltIcon color="action" />
              <ToggleButtonGroup
                value={partType}
                exclusive
                onChange={(_, next) => next && setPartType(next)}
                size="small"
                color="primary"
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="stock">Stock</ToggleButton>
                <ToggleButton value="supply">Supply</ToggleButton>
                <ToggleButton value="service">Service</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Stack>
          <Divider />
          <Stack spacing={1}>
            <Typography variant="subtitle2" color="text.secondary" fontWeight={700}>
              How your query is interpreted
            </Typography>
            {renderBadgeRow('Normalized', queryUnderstanding.normalized ? [queryUnderstanding.normalized] : [], 'No query yet')}
            {renderBadgeRow('Part # form', queryUnderstanding.normalizedPartNumber ? [queryUnderstanding.normalizedPartNumber] : [], 'Waiting for part # text')}
            {renderBadgeRow('Tokens', queryUnderstanding.tokens, 'No tokens extracted')}
            {renderBadgeRow('Synonyms added', summaryTokens, 'No synonym expansions yet')}
            {renderBadgeRow('Dimensions', queryUnderstanding.dimensions, 'No dimensional pattern found')}
          </Stack>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid #e5e7eb', mb: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
          <Typography variant="h6" fontWeight={800}>
            Results {results.length > 0 ? `• ${results.length} matches` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Matching uses abbreviations, finishes, grades, thread types, units, and dimensional patterns from the dictionary.
          </Typography>
        </Stack>
      </Paper>

      {results.length === 0 && !loading ? (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <SearchIcon color="action" />
            <Typography variant="body2" color="text.secondary">
              Start typing to see smart matches. Use abbreviations like "GR8", "UNC", "SCH40", or material names like "A36", "HSS".
            </Typography>
          </Stack>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {results.map((hit) => (
            <Grid item xs={12} md={6} lg={4} key={hit.item.part_number}>
              <Paper
                elevation={1}
                sx={{
                  p: 2,
                  height: '100%',
                  borderRadius: 3,
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Typography variant="h6" fontWeight={800} sx={{ wordBreak: 'break-all' }}>
                    {hit.item.part_number}
                  </Typography>
                  <Chip label={`Score ${hit.score}`} size="small" color="primary" />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ minHeight: 48 }}>
                  {hit.item.part_description || 'No description'}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {hit.item.category && <Chip label={hit.item.category} size="small" />}
                  {hit.item.part_type && <Chip label={hit.item.part_type} size="small" variant="outlined" />}
                  {typeof hit.item.quantity_on_hand === 'number' && (
                    <Chip
                      label={`On hand: ${hit.item.quantity_on_hand} ${hit.item.unit || ''}`.trim()}
                      size="small"
                      variant="outlined"
                    />
                  )}
                  {typeof hit.item.last_unit_cost === 'number' && (
                    <Chip label={`Last cost: ${hit.item.last_unit_cost}`} size="small" variant="outlined" />
                  )}
                </Stack>
                <Divider />
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    Match reasons
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    {hit.partNumberMatched && <Chip label="Part #" size="small" color="success" variant="outlined" />}
                    {hit.descriptionMatched && <Chip label="Description" size="small" color="success" variant="outlined" />}
                    {hit.matchedTokens.slice(0, 6).map((tok) => (
                      <Chip key={`${hit.item.part_number}-tok-${tok}`} label={tok} size="small" />
                    ))}
                    {hit.matchedDimensions.slice(0, 4).map((dim) => (
                      <Chip key={`${hit.item.part_number}-dim-${dim}`} label={dim} size="small" variant="outlined" />
                    ))}
                    {hit.matchedCategory && <Chip label={`Category: ${hit.matchedCategory}`} size="small" color="secondary" variant="outlined" />}
                  </Stack>
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      {loading && results.length > 0 && (
        <Box display="flex" justifyContent="center" mt={2}>
          <CircularProgress size={24} />
        </Box>
      )}
    </Box>
  );
};

export default SmartInventorySearchPage;
