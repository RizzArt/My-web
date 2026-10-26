-- Griphub Image rows are staged disabled. They cannot be enabled until the
-- provider's request identity/idempotency and financially safe settlement
-- contract are verified separately. SEKAI rows and historical generations stay unchanged.
INSERT INTO "StudioModelConfig" ("id", "provider", "model", "displayName", "isEnabled", "creditCostPerImage", "supportsReferenceImage", "supportedAspectRatios", "updatedAt") VALUES
  ('studio_griphub_gpt_image', 'GRIPHUB', 'gpt-image', 'GPT Image', false, 17, false, '["1:1", "3:2", "2:3"]', CURRENT_TIMESTAMP),
  ('studio_griphub_gemini_3_1_flash_image', 'GRIPHUB', 'gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', false, 13, false, '["1:1", "3:2", "2:3"]', CURRENT_TIMESTAMP)
ON CONFLICT ("provider", "model") DO NOTHING;
