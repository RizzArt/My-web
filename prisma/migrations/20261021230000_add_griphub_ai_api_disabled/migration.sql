-- Griphub chat models are staged disabled. Public IDs are provider-prefixed so
-- historic SEKAI requests and immutable pricing evidence remain untouched.
-- Griphub only exposed max_output_tokens in the authenticated model catalog;
-- Riezz99 applies a conservative 32K input cap until a context limit is published.
INSERT INTO "AiApiModel" ("id", "publicId", "provider", "upstreamModelId", "displayName", "enabled", "maxInputTokens", "maxOutputTokens", "privateBetaMaxOutputTokens", "maxRequestBytes", "maxExecutionSeconds", "createdAt", "updatedAt") VALUES
  ('ai-model-griphub-minimax-m3', 'griphub/minimax-m3', 'GRIPHUB', 'minimax-m3', 'MiniMax M3 via Griphub', false, 32768, 512000, 8192, 983040, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ai-model-griphub-gpt-56-terra', 'griphub/gpt-5.6-terra', 'GRIPHUB', 'gpt-5.6-terra', 'GPT-5.6 Terra via Griphub', false, 32768, 128000, 8192, 983040, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ai-model-griphub-gpt-56-sol', 'griphub/gpt-5.6-sol', 'GRIPHUB', 'gpt-5.6-sol', 'GPT-5.6 Sol via Griphub', false, 32768, 128000, 8192, 983040, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("provider", "upstreamModelId") DO NOTHING;

INSERT INTO "AiApiPriceVersion" ("id", "modelId", "version", "currency", "upstreamInputMicrosPerMillion", "upstreamOutputMicrosPerMillion", "retailInputMicrosPerMillion", "retailOutputMicrosPerMillion", "calculatorVersion", "sourceVersion", "verifiedAt", "effectiveFrom", "createdAt") VALUES
  ('ai-price-griphub-minimax-m3-v1', 'ai-model-griphub-minimax-m3', 1, 'IDR', 150000000, 150000000, 225000000, 225000000, 'text-token-v1', 'GRIPHUB-catalog-and-contract-2026-10-21', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ai-price-griphub-gpt-56-terra-v1', 'ai-model-griphub-gpt-56-terra', 1, 'IDR', 600000000, 600000000, 900000000, 900000000, 'text-token-v1', 'GRIPHUB-catalog-and-contract-2026-10-21', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ai-price-griphub-gpt-56-sol-v1', 'ai-model-griphub-gpt-56-sol', 1, 'IDR', 1050000000, 1050000000, 1575000000, 1575000000, 'text-token-v1', 'GRIPHUB-catalog-and-contract-2026-10-21', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "AiApiProviderHealth" ("id", "modelId", "breakerState", "consecutiveFailures", "safeReasonCode", "updatedAt") VALUES
  ('ai-health-griphub-minimax-m3', 'ai-model-griphub-minimax-m3', 'OPEN', 0, 'GRIPHUB_BALANCE_AND_IDEMPOTENCY_UNVERIFIED', CURRENT_TIMESTAMP),
  ('ai-health-griphub-gpt-56-terra', 'ai-model-griphub-gpt-56-terra', 'OPEN', 0, 'GRIPHUB_BALANCE_AND_IDEMPOTENCY_UNVERIFIED', CURRENT_TIMESTAMP),
  ('ai-health-griphub-gpt-56-sol', 'ai-model-griphub-gpt-56-sol', 'OPEN', 0, 'GRIPHUB_BALANCE_AND_IDEMPOTENCY_UNVERIFIED', CURRENT_TIMESTAMP);
