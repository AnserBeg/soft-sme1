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
import VoiceSearchButton from './VoiceSearchButton';

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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');

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
  const [prefix, setPrefix] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [soUsage, setSoUsage] = useState<UsageMap>({});
  const [globalUsage, setGlobalUsage] = useState<UsageMap>({});
  const [voiceSearchTerms, setVoiceSearchTerms] = useState<string[]>([]);
  const [voiceSearchStrategy, setVoiceSearchStrategy] = useState<{searchInPartNumbers: boolean, searchInDescriptions: boolean} | null>(null);

  useEffect(() => {
    if (!open) return;
    setFavorites(readList('favorites', salesOrderId, context));
    setRecents(readList('recents', salesOrderId, context));
    setSoUsage(readUsageSO(salesOrderId, context));
    setGlobalUsage(readUsageGlobal());
  }, [open, salesOrderId, context]);

  // Items that match current selections (prefix + selected tokens + voice search terms)
  const candidateItems = useMemo(() => {
    const p = prefix.toUpperCase();
    const tokens = new Set(selectedTokens.map(t => t.toUpperCase()));
    const voiceTokens = new Set(voiceSearchTerms.map(t => t.toUpperCase()));
    const q = query.trim().toUpperCase();
    return inventoryItems.filter(it => {
      const num = (it.part_number || '').toUpperCase();
      const desc = (it.part_description || '').toUpperCase();
      if (p && !num.startsWith(p)) return false;
      if (q && !(num.includes(q) || desc.includes(q))) return false;
      for (const t of tokens) {
        if (!(num.includes(t) || desc.includes(t))) return false;
      }
      // Apply voice search terms with strategy
      if (voiceSearchTerms.length > 0 && voiceSearchStrategy) {
        let voiceMatch = false;
        for (const t of voiceTokens) {
          if (voiceSearchStrategy.searchInPartNumbers && num.includes(t)) {
            voiceMatch = true;
            break;
          }
          if (voiceSearchStrategy.searchInDescriptions && desc.includes(t)) {
            voiceMatch = true;
            break;
          }
        }
        if (!voiceMatch) return false;
      }
      return true;
    });
  }, [inventoryItems, prefix, selectedTokens, query, voiceSearchTerms, voiceSearchStrategy]);

  // Dynamic description/dimension tokens derived from candidates
  const dynamicTokens = useMemo(() => {
    const counts: Record<string, number> = {};
    const selectedSet = new Set(selectedTokens.map(t => t.toUpperCase()));
    const favoriteSet = new Set(favorites);
    const recentSet = new Set(recents);
    const synonymMap: Record<string, string> = { SS:'STAINLESS', STAIN:'STAINLESS', STAINLESS:'STAINLESS', AL:'ALUMINUM', ALUM:'ALUMINUM', GALV:'GALVANIZED', GALVANIZED:'GALVANIZED', SQ:'SQUARE', RECT:'RECTANGULAR', TUBE:'TUBING' };
    const shapeSet = new Set(['TUBING','PIPE','ANGLE','BAR','FLAT','BEAM','CHANNEL','SHEET','PLATE','ROUND','SQUARE','RECTANGULAR']);

    const normalizeToken = (w: string) => synonymMap[w] || w;
    const add = (t: string, w: number) => { const tok = t.trim(); if (!tok || selectedSet.has(tok)) return; counts[tok] = (counts[tok] || 0) + w; };
    const makeDecimal = (f: string) => { const [a,b] = f.split('/').map(Number); if(!a||!b) return null; return (a/b).toFixed(4).replace(/0+$/,'').replace(/\.$/,''); };
    const parseDims = (pn: string) => { const out: string[] = []; if(!pn) return out; let s = pn.toUpperCase().replace(/[\s-]+/g,'').replace(/×/g,'X').replace(/[()]/g,''); const fr = s.match(/\d+\/\d+/g)||[]; if(s.includes('X')){ const seg=s.split('X'); if(seg.length>=2&&seg.length<=4){ out.push(seg.slice(0,2).join('X')); out.push(seg.join('X')); } } fr.forEach(f=>{ out.push(f); const dec=makeDecimal(f); if(dec) out.push(dec); }); (s.match(/(\d+)GA/g)||[]).forEach(g=>out.push(g)); (s.match(/SCH\s*\d+/g)||[]).forEach(m=>out.push(m.replace(/\s+/g,''))); (s.match(/OD\d+(?:\.\d+)?/g)||[]).forEach(v=>out.push(v)); (s.match(/ID\d+(?:\.\d+)?/g)||[]).forEach(v=>out.push(v)); (s.match(/\d+(?:\.\d+)?/g)||[]).slice(0,3).forEach(d=>out.push(d)); return Array.from(new Set(out)); };

    for (const it of candidateItems) {
      const wordsRaw = String(it.part_description || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w=>w.length>=2 && !selectedSet.has(w));
      const words = wordsRaw.map(normalizeToken);
      const usageSo = soUsage[it.part_number]?.count || 0;
      const usageGlobal = globalUsage[it.part_number]?.count || 0;
      const lastSo = soUsage[it.part_number]?.last || 0;
      const now = Date.now();
      const days = lastSo ? (now-lastSo)/(1000*60*60*24) : 365;
      const recencyBoost = days<=7?1:days<=30?0.5:0;
      let base = 1 + usageSo*0.5 + usageGlobal*0.25 + recencyBoost;
      if (favoriteSet.has(it.part_number)) base += 3;
      if (recentSet.has(it.part_number)) base += 1;
      const q = query.trim().toUpperCase();
      const num = (it.part_number||'').toUpperCase();
      const desc = (it.part_description||'').toUpperCase();
      const itemBoost = q && (num.startsWith(q) || desc.includes(q)) ? 0.5 : 0;

      // Material/shape tokens
      const ms: string[] = [];
      words.forEach(w=>{ if(shapeSet.has(w)) ms.push(w); add(w, base*(1+itemBoost+(q&&w.includes(q)?0.5:0))); });
      // Bigrams (shape+material combos)
      const uniq = Array.from(new Set(words));
      uniq.forEach(a=>uniq.forEach(b=>{ if(a!==b && (shapeSet.has(a)||shapeSet.has(b))) add(`${a} ${b}`, base*1.2); }));
      // Dimension tokens from part number
      const dims = parseDims(num);
      dims.forEach(d=>add(d, base*1.3));
      // Cross tokens
      if (dims[0]) ms.slice(0,2).forEach(m=>add(`${m} ${dims[0]}`, base*1.5));
    }
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,24).map(([w])=>w);
  }, [candidateItems, selectedTokens, favorites, recents, soUsage, globalUsage, query]);

  // Apply filters
  const filtered = candidateItems;

  const topResults = useMemo(() => filtered.slice(0, 200), [filtered]);

  const toggleToken = (t: string) => {
    setSelectedTokens(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const clearAll = () => { 
    setPrefix(''); 
    setSelectedTokens([]); 
    setVoiceSearchTerms([]);
    setVoiceSearchStrategy(null);
  };

  const isFav = (partNumber: string) => favorites.includes(partNumber);
  const toggleFavorite = (partNumber: string) => {
    setFavorites(prev => {
      const next = prev.includes(partNumber) ? prev.filter(p => p !== partNumber) : [partNumber, ...prev];
      writeList('favorites', salesOrderId, context, next);
      // fire-and-forget server update
      try {
        fetch(`/api/part-finder/${salesOrderId}/favorite`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ part_number: partNumber, context, value: !prev.includes(partNumber) })
        }).catch(() => {});
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
      fetch(`/api/part-finder/${salesOrderId}/use`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ part_number: part.part_number, context })
      }).catch(() => {});
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
            <VoiceSearchButton
              onSearchTerms={(terms, strategy) => {
                setVoiceSearchTerms(terms);
                setVoiceSearchStrategy(strategy);
              }}
              disabled={false}
            />
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
          {!!prefix && (
            <Chip label={`Prefix: ${prefix}`} color="primary" onDelete={() => setPrefix('')} 
              sx={{ height: 40, borderRadius: 2, '& .MuiChip-label': { px: 2, py: 1, fontSize: 16, fontWeight: 600 } }}
            />
          )}
          {selectedTokens.map(t => (
            <Chip key={t} label={t} color="secondary" onDelete={() => toggleToken(t)}
              sx={{ height: 38, borderRadius: 2, '& .MuiChip-label': { px: 2, py: 1, fontSize: 15, fontWeight: 600 } }}
            />
          ))}
                     {voiceSearchTerms.length > 0 && (
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
               <Typography variant="caption" color="text.secondary">Voice:</Typography>
               {voiceSearchTerms.map(t => (
                 <Chip key={t} label={t} color="success" variant="outlined" size="small"
                   sx={{ height: 32, '& .MuiChip-label': { px: 1.5, py: 0.5, fontSize: 12 } }}
                 />
               ))}
               {voiceSearchStrategy && (
                 <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                   ({voiceSearchStrategy.searchInPartNumbers ? 'Part#' : ''}
                   {voiceSearchStrategy.searchInPartNumbers && voiceSearchStrategy.searchInDescriptions ? ' + ' : ''}
                   {voiceSearchStrategy.searchInDescriptions ? 'Desc' : ''})
                 </Typography>
               )}
             </Box>
           )}
          {(!!prefix || selectedTokens.length > 0 || voiceSearchTerms.length > 0) && (
            <Button onClick={clearAll}>Clear All</Button>
          )}
        </Box>

        {/* Quick selectors */}
        <Box display="flex" gap={2} mb={2} flexWrap="wrap">
          <Box>
            <Typography variant="subtitle2" gutterBottom>Part # Starts With</Typography>
            <Box display="flex" flexWrap="wrap" gap={1.5}>
              {LETTERS.map(ch => (
                <Chip
                  key={ch}
                  label={ch}
                  variant={prefix.startsWith(ch) ? 'filled' : 'outlined'}
                  onClick={() => setPrefix(ch)}
                  sx={{ height: 44, borderRadius: 2, '& .MuiChip-label': { px: 2.25, py: 1.25, fontSize: 18, fontWeight: 700 } }}
                />
              ))}
              {DIGITS.map(ch => (
                <Chip
                  key={ch}
                  label={ch}
                  variant={prefix.startsWith(ch) ? 'filled' : 'outlined'}
                  onClick={() => setPrefix(ch)}
                  sx={{ height: 44, borderRadius: 2, '& .MuiChip-label': { px: 2.25, py: 1.25, fontSize: 18, fontWeight: 700 } }}
                />
              ))}
            </Box>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>Description Tokens</Typography>
            <Box display="flex" flexWrap="wrap" gap={1.5}>
              {dynamicTokens.map(tok => (
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
          </Box>
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


