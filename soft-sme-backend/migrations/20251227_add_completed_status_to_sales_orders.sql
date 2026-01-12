-- Normalize sales order status values to include Completed
UPDATE salesorderhistory
SET status = CASE
  WHEN LOWER(status) = 'open' THEN 'Open'
  WHEN LOWER(status) = 'closed' THEN 'Closed'
  WHEN LOWER(status) = 'completed' THEN 'Completed'
  ELSE status
END
WHERE status IS NOT NULL;
