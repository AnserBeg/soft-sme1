-- Create overhead_expense_distribution table for multiple expense accounts
CREATE TABLE IF NOT EXISTS overhead_expense_distribution (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  expense_account_id VARCHAR(64) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  description VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_overhead_expense_distribution_company_id 
ON overhead_expense_distribution(company_id);

-- Add comments
COMMENT ON TABLE overhead_expense_distribution IS 'Distribution of overhead costs across multiple expense accounts';
COMMENT ON COLUMN overhead_expense_distribution.company_id IS 'Company ID for multi-tenant support';
COMMENT ON COLUMN overhead_expense_distribution.expense_account_id IS 'QuickBooks expense account ID';
COMMENT ON COLUMN overhead_expense_distribution.percentage IS 'Percentage of overhead to allocate to this account (0-100)';
COMMENT ON COLUMN overhead_expense_distribution.description IS 'Description of the expense account for display purposes';
COMMENT ON COLUMN overhead_expense_distribution.is_active IS 'Whether this distribution is active'; 