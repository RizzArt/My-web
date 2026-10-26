const ZERO = BigInt(0);
const ONE = BigInt(1);
const TOKENS_PER_MILLION = BigInt(1_000_000);
const MAX_SIGNED_BIGINT = BigInt("9223372036854775807");

type ChargeInput = {
  promptTokens: bigint;
  completionTokens: bigint;
  inputMicrosPerMillion: bigint;
  outputMicrosPerMillion: bigint;
  minimumChargeMicros: bigint;
};

type ReservationInput = {
  inputTokenUpperBound: bigint;
  maxCompletionTokens: bigint;
  inputMicrosPerMillion: bigint;
  outputMicrosPerMillion: bigint;
  minimumChargeMicros: bigint;
};

function assertNonNegative(name: string, value: bigint) {
  if (value < ZERO) throw new Error(`${name} tidak boleh negatif.`);
  if (value > MAX_SIGNED_BIGINT) throw new Error(`${name} melampaui batas penyimpanan.`);
}

export function ceilDiv(numerator: bigint, denominator: bigint) {
  assertNonNegative("Numerator", numerator);
  if (denominator <= ZERO) throw new Error("Denominator harus positif.");
  return numerator === ZERO ? ZERO : ((numerator - ONE) / denominator) + ONE;
}

function calculate(inputTokens: bigint, outputTokens: bigint, inputRate: bigint, outputRate: bigint) {
  assertNonNegative("Input token", inputTokens);
  assertNonNegative("Output token", outputTokens);
  assertNonNegative("Tarif input", inputRate);
  assertNonNegative("Tarif output", outputRate);
  const numerator = inputTokens * inputRate + outputTokens * outputRate;
  const result = ceilDiv(numerator, TOKENS_PER_MILLION);
  if (result > MAX_SIGNED_BIGINT) throw new Error("Biaya melampaui batas penyimpanan.");
  return result;
}

export function calculateChargeMicros(input: ChargeInput) {
  const minimum = input.minimumChargeMicros;
  assertNonNegative("Minimum per request", minimum);
  const tokenCost = calculate(input.promptTokens, input.completionTokens, input.inputMicrosPerMillion, input.outputMicrosPerMillion);
  return tokenCost > minimum ? tokenCost : minimum;
}

export function calculateReservationMicros(input: ReservationInput) {
  return calculateChargeMicros({
    promptTokens: input.inputTokenUpperBound,
    completionTokens: input.maxCompletionTokens,
    inputMicrosPerMillion: input.inputMicrosPerMillion,
    outputMicrosPerMillion: input.outputMicrosPerMillion,
    minimumChargeMicros: input.minimumChargeMicros,
  });
}

export { MAX_SIGNED_BIGINT, TOKENS_PER_MILLION };
