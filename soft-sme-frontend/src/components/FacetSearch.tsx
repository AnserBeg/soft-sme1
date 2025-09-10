import React, { useEffect, useState } from "react";
import { Box, Chip, Stack, Typography, Paper, CircularProgress, Tooltip } from "@mui/material";
import { FACET_ORDER, splitToken, getTokenDisplayName, TOKEN_WEIGHTS } from "../utils/tokenTypes";
import { fetchFacetSuggestions, postClick, postShow } from "../api/tokens";

interface FacetSearchProps {
  onPartSelect?: (part: any) => void;
}

export default function FacetSearch({ onPartSelect }: FacetSearchProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const result = await fetchFacetSuggestions(selected);
        setData(result);
        
        // Record shows for all visible tokens
        const allTokens: string[] = [];
        Object.values(result.suggestions || {}).forEach((tokens: any) => {
          allTokens.push(...tokens);
        });
        if (allTokens.length > 0) {
          await postShow(allTokens);
        }
      } catch (error) {
        console.error('Error loading facet suggestions:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selected]);

  const onClickToken = async (tok: string) => {
    try {
      await postClick(tok);
      setSelected([...selected, tok]);
    } catch (error) {
      console.error('Error recording token click:', error);
    }
  };

  const removeToken = (tokenToRemove: string) => {
    setSelected(selected.filter(t => t !== tokenToRemove));
  };

  const handlePartClick = (part: any) => {
    if (onPartSelect) {
      onPartSelect(part);
    }
  };

  return (
    <Box>
      {/* Selected tokens */}
      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap">
        {selected.map(t => (
          <Tooltip key={t} title={`${splitToken(t)[0]}: ${splitToken(t)[1]}`}>
            <Chip 
              label={getTokenDisplayName(t)} 
              onDelete={() => removeToken(t)}
              color="primary"
              variant="filled"
              size="small"
            />
          </Tooltip>
        ))}
      </Stack>

      {loading && (
        <Box display="flex" justifyContent="center" mb={2}>
          <CircularProgress />
        </Box>
      )}

            {/* Facet suggestions */}
      {FACET_ORDER.map(facet =>
        data?.suggestions?.[facet]?.length ? (
          <Box key={facet} mb={2}>
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              {facet} ({data.suggestions[facet].length})
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {data.suggestions[facet].map((tok: string) => {
                const [type, value] = splitToken(tok);
                const weight = TOKEN_WEIGHTS[type] || 50;
                const confidenceColor = weight >= 80 ? 'success' : weight >= 60 ? 'warning' : 'default';
                
                return (
                  <Tooltip key={tok} title={`${type}: ${value} (confidence: ${weight})`}>
                    <Chip
                      label={getTokenDisplayName(tok)}
                      onClick={() => onClickToken(tok)}
                      variant="outlined"
                      size="small"
                      color={confidenceColor}
                    />
                  </Tooltip>
                );
              })}
            </Stack>
          </Box>
        ) : null
      )}

      {/* Results count */}
      {data?.count !== undefined && (
        <Typography variant="body2" color="text.secondary" mb={2}>
          Found {data.count} parts
        </Typography>
      )}

      {/* Parts list */}
      {data?.parts?.length > 0 && (
        <Paper elevation={1}>
          {data.parts.map((p: any) => (
            <Box 
              key={p.part_id} 
              p={2} 
              borderBottom="1px solid #eee"
              sx={{ cursor: 'pointer', '&:hover': { backgroundColor: '#f5f5f5' } }}
              onClick={() => handlePartClick(p)}
            >
              <Typography variant="body1" fontWeight="medium">
                {p.part_number}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {p.part_description}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}

      {/* No results */}
      {data?.parts?.length === 0 && data?.count === 0 && !loading && (
        <Paper elevation={1} sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No parts found matching the selected criteria
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
