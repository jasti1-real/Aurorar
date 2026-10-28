-- The country column already exists in the production users table.
-- Keep this historical migration as a no-op so remote migration history can catch up safely.
SELECT 1;
