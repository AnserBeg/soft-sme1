-- Task collaboration tables for task chat messaging
-- This migration creates a lightweight task collaboration schema with
-- participants and message tracking support.

-- Ensure base tasks table exists for assignment tracking
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  priority VARCHAR(50) DEFAULT 'medium',
  due_date TIMESTAMP WITH TIME ZONE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  is_archived BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tasks_company_id ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Keep tasks.updated_at in sync on row updates
CREATE OR REPLACE FUNCTION update_tasks_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_tasks_updated_at_column();

-- Participant mapping between tasks and users
CREATE TABLE IF NOT EXISTS task_participants (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'participant',
  is_watcher BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_read_at TIMESTAMP WITH TIME ZONE,
  last_read_message_id INTEGER,
  notification_preference VARCHAR(50) DEFAULT 'app'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_participants_unique
  ON task_participants(task_id, user_id);

CREATE INDEX IF NOT EXISTS idx_task_participants_task_id ON task_participants(task_id);
CREATE INDEX IF NOT EXISTS idx_task_participants_user_id ON task_participants(user_id);

-- Core message table referencing tasks and participants
CREATE TABLE IF NOT EXISTS task_messages (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES task_participants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  attachments JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_messages_task_created ON task_messages(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_messages_participant ON task_messages(participant_id);

-- Auto-update updated_at timestamp on message updates
CREATE OR REPLACE FUNCTION update_task_messages_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_task_messages_updated_at ON task_messages;
CREATE TRIGGER update_task_messages_updated_at
  BEFORE UPDATE ON task_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_task_messages_updated_at_column();

-- Track task touches when new messages are created
CREATE OR REPLACE FUNCTION touch_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.task_id;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS task_messages_touch_task ON task_messages;
CREATE TRIGGER task_messages_touch_task
  AFTER INSERT ON task_messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_task_updated_at();

-- Ensure participants keep a valid last_read_message_id reference
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_participants' AND column_name = 'last_read_message_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'task_participants'
        AND constraint_name = 'task_participants_last_read_message_id_fkey'
    ) THEN
      ALTER TABLE task_participants
        ADD CONSTRAINT task_participants_last_read_message_id_fkey
        FOREIGN KEY (last_read_message_id)
        REFERENCES task_messages(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Helpful view for quick reporting (optional, only create if absent)
CREATE OR REPLACE VIEW task_message_activity AS
SELECT
  tm.id AS message_id,
  tm.task_id,
  tm.participant_id,
  tm.created_at,
  tm.is_system,
  tm.metadata,
  tp.user_id,
  tp.role,
  t.company_id,
  t.status
FROM task_messages tm
JOIN task_participants tp ON tp.id = tm.participant_id
JOIN tasks t ON t.id = tm.task_id;
