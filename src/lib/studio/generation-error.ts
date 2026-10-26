type GenerationFailurePayload = {
  error?: unknown;
  generation?: { errorMessage?: unknown } | null;
};

function safeMessage(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// The generation route returns both fields for failed work so the UI can
// surface the synchronous failure and still refresh the persisted history.
export function generationFailureMessage(result: GenerationFailurePayload) {
  return safeMessage(result.error) ?? safeMessage(result.generation?.errorMessage) ?? "Generation gagal.";
}
