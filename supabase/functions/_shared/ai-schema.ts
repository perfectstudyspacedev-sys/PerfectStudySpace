// Validate the JSON-schema subset used by the app's structured AI responses.
// Checks apply after provider output, before a draft or extraction can be used.
// deno-lint-ignore-file no-explicit-any
export function schemaProblem(value: any, schema: any, path = "$", depth = 0): string | null {
  if (depth > 30) return path + " exceeds schema depth";
  if (!schema || typeof schema !== "object") return null;
  if (schema.anyOf && !schema.anyOf.some((s: any) => schemaProblem(value, s, path, depth + 1) === null)) return path + " matches no allowed type";
  if (schema.enum && !schema.enum.some((x: any) => JSON.stringify(x) === JSON.stringify(value))) return path + " is outside the allowed values";
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matches = (type: string) => {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === type;
  };
  if (types.length && !types.some(matches)) return path + " has the wrong type";
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return path + "." + key + " is required";
    for (const [key, child] of Object.entries(value)) {
      const prop = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : undefined;
      if (!prop && schema.additionalProperties === false) return path + " has an unexpected property";
      const problem = schemaProblem(child, prop ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : {}), path + "." + key, depth + 1);
      if (problem) return problem;
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) return path + " has too few items";
    if (schema.maxItems != null && value.length > schema.maxItems) return path + " has too many items";
    for (let i = 0; schema.items && i < value.length; i++) {
      const problem = schemaProblem(value[i], schema.items, path + "[" + i + "]", depth + 1);
      if (problem) return problem;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) return path + " is too short";
    if (schema.maxLength != null && value.length > schema.maxLength) return path + " is too long";
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return path + " does not match its pattern";
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) return path + " is below its minimum";
    if (schema.maximum != null && value > schema.maximum) return path + " is above its maximum";
  }
  return null;
}
