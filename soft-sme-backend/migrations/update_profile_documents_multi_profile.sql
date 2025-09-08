-- Update profile documents system to support multiple profiles per document
-- This migration adds a new table to handle document visibility to multiple profiles

-- Create document profile visibility table
CREATE TABLE IF NOT EXISTS document_profile_visibility (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES profile_documents(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, profile_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_document_profile_visibility_document_id ON document_profile_visibility(document_id);
CREATE INDEX IF NOT EXISTS idx_document_profile_visibility_profile_id ON document_profile_visibility(profile_id);

-- Migrate existing data: create visibility entries for existing documents
INSERT INTO document_profile_visibility (document_id, profile_id)
SELECT id, profile_id 
FROM profile_documents 
WHERE NOT EXISTS (
  SELECT 1 FROM document_profile_visibility dpv 
  WHERE dpv.document_id = profile_documents.id 
  AND dpv.profile_id = profile_documents.profile_id
);

-- Update profile_document_reads to reference the visibility table
-- This ensures reads are only tracked for profiles that have visibility to the document
-- We'll keep the existing structure but add a constraint
ALTER TABLE profile_document_reads 
ADD CONSTRAINT fk_profile_document_reads_visibility 
FOREIGN KEY (document_id, profile_id) 
REFERENCES document_profile_visibility(document_id, profile_id) 
ON DELETE CASCADE;

-- Add a comment to explain the new structure
COMMENT ON TABLE document_profile_visibility IS 'Tracks which profiles can see which documents. Each document can be visible to multiple profiles.';
COMMENT ON TABLE profile_document_reads IS 'Tracks which profiles have read which documents. Only profiles with visibility can have read records.';
