-- Create profile documents system tables
-- Documents are assigned to profiles (actual people/employees)
-- Users access documents through their assigned profiles via user_profile_access

-- Profile documents table
CREATE TABLE IF NOT EXISTS profile_documents (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Profile document reads tracking
-- Tracks which profiles have read which documents
CREATE TABLE IF NOT EXISTS profile_document_reads (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES profile_documents(id) ON DELETE CASCADE,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, document_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profile_documents_profile_id ON profile_documents(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_documents_uploaded_by ON profile_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_profile_document_reads_profile_id ON profile_document_reads(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_document_reads_document_id ON profile_document_reads(document_id);

-- Add trigger to update updated_at timestamp for profile_documents
CREATE OR REPLACE FUNCTION update_profile_documents_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_profile_documents_updated_at ON profile_documents;
CREATE TRIGGER update_profile_documents_updated_at 
    BEFORE UPDATE ON profile_documents 
    FOR EACH ROW 
    EXECUTE FUNCTION update_profile_documents_updated_at_column();