-- Create part_tokens and token_stats tables for faceted search system
-- This migration adds typed token storage and usage statistics

-- Create part_tokens table for storing typed tokens per part
CREATE TABLE IF NOT EXISTS part_tokens (
  part_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (part_id, type, value),
  FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_part_tokens_type_value ON part_tokens(type, value);
CREATE INDEX IF NOT EXISTS idx_part_tokens_part ON part_tokens(part_id);

-- Create token_stats table for tracking usage statistics
CREATE TABLE IF NOT EXISTS token_stats (
  token TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  shows BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  orders BIGINT DEFAULT 0,
  last_selected TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for token_stats queries
CREATE INDEX IF NOT EXISTS idx_token_stats_type ON token_stats(type);
CREATE INDEX IF NOT EXISTS idx_token_stats_last_selected ON token_stats(last_selected);

-- Add comment to document the purpose
COMMENT ON TABLE part_tokens IS 'Stores typed tokens extracted from part numbers and descriptions for faceted search';
COMMENT ON TABLE token_stats IS 'Tracks usage statistics for tokens to improve search relevance';




