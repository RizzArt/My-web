import Ajv, { type ValidateFunction } from "ajv";

const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 4_096;
const validators = new WeakMap<object, ValidateFunction>();
const ajv = new Ajv({
  addUsedSchema: false,
  allErrors: false,
  allowUnionTypes: true,
  strict: true,
  validateFormats: false,
});

function assertBoundedSchema(value: unknown) {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (node: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) throw new Error("Schema tool strict terlalu kompleks.");
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) throw new Error("Schema tool strict tidak valid.");
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const item of Object.values(node as Record<string, unknown>)) visit(item, depth + 1);
  };
  visit(value, 0);
}

export function compileStrictToolSchema(schema: Record<string, unknown>) {
  const cached = validators.get(schema);
  if (cached) return cached;
  assertBoundedSchema(schema);
  let validator: ValidateFunction;
  try {
    validator = ajv.compile(schema);
  } catch {
    throw new Error("Schema tool strict tidak valid.");
  }
  validators.set(schema, validator);
  return validator;
}

export function strictToolArgumentsMatch(schema: Record<string, unknown>, value: unknown) {
  return compileStrictToolSchema(schema)(value) === true;
}
