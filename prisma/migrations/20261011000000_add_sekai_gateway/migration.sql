-- SEKAI Pixel models are deliberately staged disabled. The admin must set the
-- internal price and opt in explicitly; existing configuration is untouched.
INSERT INTO "StudioModelConfig" ("id", "provider", "model", "displayName", "isEnabled", "creditCostPerImage", "supportsReferenceImage", "supportedAspectRatios", "updatedAt") VALUES
  ('studio_sekai_gpt_image_2', 'SEKAI', 'pixel/gpt-image-2', 'GPT Image 2', false, 1, false, '["1:1"]', CURRENT_TIMESTAMP),
  ('studio_sekai_gemini_3_1_flash_image', 'SEKAI', 'pixel/gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', false, 1, false, '["1:1"]', CURRENT_TIMESTAMP),
  ('studio_sekai_gemini_2_5_flash_image', 'SEKAI', 'pixel/gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', false, 1, false, '["1:1"]', CURRENT_TIMESTAMP)
ON CONFLICT ("provider", "model") DO NOTHING;
