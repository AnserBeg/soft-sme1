-- Agent v2 core tables
CREATE TABLE IF NOT EXISTS agent_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tool_invocations (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  tool VARCHAR(100) NOT NULL,
  input JSONB,
  output JSONB,
  success BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optional document store for RAG (can be swapped for external vector DB later)
CREATE TABLE IF NOT EXISTS agent_docs (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  section TEXT,
  chunk TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


