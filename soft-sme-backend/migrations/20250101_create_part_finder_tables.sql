-- Sales Order Part Finder preferences (SO-scoped recents/favorites/usage)
CREATE TABLE IF NOT EXISTS sales_order_part_prefs (
  sales_order_id INTEGER NOT NULL,
  part_number TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('line','pto')),
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  last_used_at TIMESTAMP NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sales_order_id, part_number, context)
);

-- Global usage of parts across the system
CREATE TABLE IF NOT EXISTS part_usage_global (
  part_number TEXT PRIMARY KEY,
  last_used_at TIMESTAMP NULL,
  use_count INTEGER NOT NULL DEFAULT 0
);


