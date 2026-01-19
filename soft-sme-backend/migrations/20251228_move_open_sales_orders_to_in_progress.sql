-- Move existing Open sales orders to In Progress
UPDATE salesorderhistory
SET status = 'In Progress'
WHERE LOWER(status) = 'open';
