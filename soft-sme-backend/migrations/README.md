# Database Migration Instructions

## Stock vs Supply Classification Implementation

This migration adds a `part_type` column to the `inventory` table to classify items as either 'stock' or 'supply'.

### Migration Files

1. **`add_part_type_to_inventory.sql`** - Simple migration to add the part_type column to existing inventory table
2. **`create_inventory_table_with_part_type.sql`** - Comprehensive migration that creates the inventory table if it doesn't exist

### Running the Migration

#### Option 1: Using pgAdmin (Recommended)

1. Open pgAdmin and connect to your database
2. Open the Query Tool
3. Copy and paste the contents of `create_inventory_table_with_part_type.sql`
4. Execute the query

#### Option 2: Using psql command line

```bash
psql -U your_username -d your_database_name -f create_inventory_table_with_part_type.sql
```

### What the Migration Does

1. **Creates inventory table** (if it doesn't exist) with the following structure:
   - `part_number` (VARCHAR(255), PRIMARY KEY)
   - `part_description` (TEXT, NOT NULL)
   - `unit` (VARCHAR(50))
   - `last_unit_cost` (DECIMAL(10,2), DEFAULT 0)
   - `quantity_on_hand` (INTEGER, DEFAULT 0)
   - `reorder_point` (INTEGER, DEFAULT 0)
   - `part_type` (VARCHAR(10), NOT NULL, DEFAULT 'stock')
   - `created_at` (TIMESTAMP WITH TIME ZONE)
   - `updated_at` (TIMESTAMP WITH TIME ZONE)

2. **Adds part_type column** to existing inventory table (if table exists but column doesn't)

3. **Adds constraints**:
   - Check constraint ensuring `part_type` can only be 'stock' or 'supply'
   - Default value of 'stock' for existing rows

4. **Creates indexes** for better query performance

5. **Sets up triggers** for automatic timestamp updates

### Verification

After running the migration, you can verify it worked by running:

```sql
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'inventory' 
ORDER BY ordinal_position;
```

You should see the `part_type` column with:
- `data_type`: 'character varying'
- `is_nullable`: 'NO'
- `column_default`: 'stock'

### Backward Compatibility

- All existing inventory items will be automatically classified as 'stock'
- The migration is safe to run multiple times (uses `IF NOT EXISTS` and `IF EXISTS` checks)
- No data will be lost during the migration

### Frontend Changes

The frontend has been updated to:
- Show only stock items on the Inventory page
- Show only supply items on the new Supply page
- Include part_type field in add/edit forms
- Default to appropriate part_type based on the page context 
## Messaging Tables for Direct and Group Chats

### Migration Files

- **`20250301_create_messaging_tables.sql`** – creates `conversations`, `conversation_participants`, and `messages` tables with supporting indexes and constraints for multi-tenant chat.

### What the Migration Does

1. **`conversations` table** – stores chat metadata including the company, creator, type (`direct` or `group`), timestamps, and `last_message_at` to make sorting efficient.
2. **`conversation_participants` table** – links users to conversations, enforces uniqueness per conversation, and tracks whether a participant is an admin.
3. **`messages` table** – stores conversation messages with optional JSONB attachments, sender references, and indexes for quick history lookups.

### Running the Migration

You can run the migration through pgAdmin or via psql:

```bash
psql -U <user> -d <database> -f 20250301_create_messaging_tables.sql
```

The script is idempotent; unique constraints and tables are only created if they do not already exist, so it is safe to rerun if needed.

### SQL to run in pgAdmin

If you prefer to execute the raw SQL in pgAdmin's query tool, paste the following snippet which mirrors the migration file:

```sql
-- Conversations store group and direct chat metadata
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  conversation_type VARCHAR(20) NOT NULL CHECK (conversation_type IN ('direct', 'group')),
  title VARCHAR(255),
  created_by INTEGER NOT NULL REFERENCES users(id),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_company ON conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC NULLS LAST);

-- Participants connect users to conversations
CREATE TABLE IF NOT EXISTS conversation_participants (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_unique'
  ) THEN
    ALTER TABLE conversation_participants
      ADD CONSTRAINT conversation_participants_unique UNIQUE (conversation_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);

-- Messages capture chat history
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  attachments JSONB,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- Maintain updated_at timestamps automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_conversations_updated_at'
  ) THEN
    CREATE TRIGGER update_conversations_updated_at
      BEFORE UPDATE ON conversations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_messages_updated_at'
  ) THEN
    CREATE TRIGGER update_messages_updated_at
      BEFORE UPDATE ON messages
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
```
