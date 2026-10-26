BEGIN;

-- This index is built concurrently by deployment/ensure-ai-api-legacy-integrity-index.mjs
-- after this Prisma migration is recorded. Running CREATE INDEX CONCURRENTLY inside
-- Prisma's transactional migration path would block live AiApiRequest writes.
SELECT 1;

COMMIT;
