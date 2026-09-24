import { canonicalJson, codePointLength, isPlainObject, MAX_NESTING_DEPTH } from "./primitives.ts";
import type { ConfigIssue, Json, Params, Schema } from "./types.ts";

const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  string: ["type", "minLength", "maxLength", "enum"],
  number: ["type", "minimum", "maximum"],
  integer: ["type", "minimum", "maximum"],
  boolean: ["type"],
  null: ["type"],
  array: ["type", "items", "maxItems"],
  object: ["type", "properties", "required", "additionalProperties"]
};

/** JSON-Pointer path segment escaping. */
export function pointer(base: string, segment: string | number): string {
  return `${base}/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates a schema definition against the V1 dialect. Unsupported keywords are
 * rejected rather than ignored. Returns true when no issues were added.
 */
export function validateSchemaDefinition(schema: unknown, path: string, issues: ConfigIssue[], depth = 1): schema is Schema {
  const before = issues.length;
  if (depth > MAX_NESTING_DEPTH) {
    issues.push({ path, code: "SCHEMA_DEPTH_EXCEEDED", message: `Schemas may nest at most ${MAX_NESTING_DEPTH} levels.` });
    return false;
  }
  if (!isPlainObject(schema)) {
    issues.push({ path, code: "INVALID_TYPE", message: "A schema must be an object." });
    return false;
  }
  const type = schema["type"];
  if (typeof type !== "string" || !Object.hasOwn(KEYWORDS, type)) {
    issues.push({
      path: pointer(path, "type"),
      code: "SCHEMA_UNSUPPORTED_TYPE",
      message: "type must be one of string, number, integer, boolean, null, array, or object (unions are not supported in V1)."
    });
    return false;
  }
  const allowed = KEYWORDS[type] ?? [];
  for (const key of Object.keys(schema)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: pointer(path, key),
        code: "SCHEMA_UNSUPPORTED_KEYWORD",
        message: `"${key}" is not supported for ${type} schemas in V1.`
      });
    }
  }
  switch (type) {
    case "string": {
      const { minLength, maxLength } = schema;
      if (minLength !== undefined && !isNonNegativeSafeInteger(minLength)) {
        issues.push({ path: pointer(path, "minLength"), code: "INVALID_VALUE", message: "minLength must be a non-negative integer." });
      }
      if (maxLength !== undefined && !isNonNegativeSafeInteger(maxLength)) {
        issues.push({ path: pointer(path, "maxLength"), code: "INVALID_VALUE", message: "maxLength must be a non-negative integer." });
      }
      if (isNonNegativeSafeInteger(minLength) && isNonNegativeSafeInteger(maxLength) && minLength > maxLength) {
        issues.push({ path: pointer(path, "minLength"), code: "INVALID_VALUE", message: "minLength must not exceed maxLength." });
      }
      const values = schema["enum"];
      if (values !== undefined) {
        if (!Array.isArray(values) || values.length === 0 || !values.every(item => typeof item === "string")) {
          issues.push({ path: pointer(path, "enum"), code: "INVALID_VALUE", message: "enum must be a non-empty array of strings." });
        } else if (new Set(values).size !== values.length) {
          issues.push({ path: pointer(path, "enum"), code: "INVALID_VALUE", message: "enum values must be unique." });
        }
      }
      break;
    }
    case "number":
    case "integer": {
      const { minimum, maximum } = schema;
      for (const [key, bound] of [["minimum", minimum], ["maximum", maximum]] as const) {
        if (bound === undefined) continue;
        if (typeof bound !== "number" || !Number.isFinite(bound) || (type === "integer" && !Number.isSafeInteger(bound))) {
          issues.push({ path: pointer(path, key), code: "INVALID_VALUE", message: `${key} must be a finite ${type === "integer" ? "safe integer" : "number"}.` });
        }
      }
      if (typeof minimum === "number" && typeof maximum === "number" && minimum > maximum) {
        issues.push({ path: pointer(path, "minimum"), code: "INVALID_VALUE", message: "minimum must not exceed maximum." });
      }
      break;
    }
    case "array": {
      if (!isNonNegativeSafeInteger(schema["maxItems"])) {
        issues.push({ path: pointer(path, "maxItems"), code: "REQUIRED", message: "Arrays require a non-negative integer maxItems bound." });
      }
      if (schema["items"] === undefined) {
        issues.push({ path: pointer(path, "items"), code: "REQUIRED", message: "Arrays require an items schema." });
      } else {
        validateSchemaDefinition(schema["items"], pointer(path, "items"), issues, depth + 1);
      }
      break;
    }
    case "object": {
      if (schema["additionalProperties"] !== false) {
        issues.push({ path: pointer(path, "additionalProperties"), code: "REQUIRED", message: "Objects must declare additionalProperties: false." });
      }
      const properties = schema["properties"];
      if (!isPlainObject(properties)) {
        issues.push({ path: pointer(path, "properties"), code: "REQUIRED", message: "Objects require a properties map." });
      } else {
        for (const [name, child] of Object.entries(properties)) {
          validateSchemaDefinition(child, pointer(pointer(path, "properties"), name), issues, depth + 1);
        }
      }
      const required = schema["required"];
      if (!Array.isArray(required) || !required.every(item => typeof item === "string")) {
        issues.push({ path: pointer(path, "required"), code: "REQUIRED", message: "Objects require a required array of property names." });
      } else {
        if (new Set(required).size !== required.length) {
          issues.push({ path: pointer(path, "required"), code: "INVALID_VALUE", message: "required names must be unique." });
        }
        if (isPlainObject(properties)) {
          for (const name of required) {
            if (!Object.hasOwn(properties, name)) {
              issues.push({ path: pointer(path, "required"), code: "UNKNOWN_REFERENCE", message: `required property "${name}" is not declared in properties.` });
            }
          }
        }
      }
      break;
    }
    default:
      break;
  }
  return issues.length === before;
}

/**
 * Parameter schemas are closed objects whose properties are all required and
 * are strings, booleans, or integers. Call after validateSchemaDefinition.
 */
export function validateParamsSchema(schema: Schema, path: string, issues: ConfigIssue[]): boolean {
  const before = issues.length;
  if (schema.type !== "object") {
    issues.push({ path, code: "INVALID_PARAMS_SCHEMA", message: "Parameter schemas must be objects." });
    return false;
  }
  const names = Object.keys(schema.properties);
  for (const name of names) {
    const child = schema.properties[name];
    if (child === undefined) continue;
    if (child.type !== "string" && child.type !== "boolean" && child.type !== "integer") {
      issues.push({
        path: pointer(pointer(path, "properties"), name),
        code: "INVALID_PARAMS_SCHEMA",
        message: "Parameters may only be strings, booleans, or integers in V1."
      });
    }
    if (!schema.required.includes(name)) {
      issues.push({
        path: pointer(pointer(path, "properties"), name),
        code: "INVALID_PARAMS_SCHEMA",
        message: "Every parameter must be required; optional parameters are not supported in V1."
      });
    }
  }
  return issues.length === before;
}

export interface ValueIssue { path: string; message: string }

/** Validates a value against a schema. Returns the first issue, or null when valid. */
export function validateValue(schema: Schema, value: unknown, path = "$", depth = 1): ValueIssue | null {
  if (depth > MAX_NESTING_DEPTH) return { path, message: `Values may nest at most ${MAX_NESTING_DEPTH} levels.` };
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return { path, message: "Expected a string." };
      if (schema.enum !== undefined && !schema.enum.includes(value)) return { path, message: "Value is not one of the allowed strings." };
      const length = (schema.minLength !== undefined || schema.maxLength !== undefined) ? codePointLength(value) : 0;
      if (schema.minLength !== undefined && length < schema.minLength) return { path, message: `Expected at least ${schema.minLength} characters.` };
      if (schema.maxLength !== undefined && length > schema.maxLength) return { path, message: `Expected at most ${schema.maxLength} characters.` };
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { path, message: "Expected a finite number." };
      if (schema.type === "integer" && !Number.isSafeInteger(value)) return { path, message: "Expected a safe integer." };
      if (schema.minimum !== undefined && value < schema.minimum) return { path, message: `Expected a value of at least ${schema.minimum}.` };
      if (schema.maximum !== undefined && value > schema.maximum) return { path, message: `Expected a value of at most ${schema.maximum}.` };
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : { path, message: "Expected a boolean." };
    case "null":
      return value === null ? null : { path, message: "Expected null." };
    case "array": {
      if (!Array.isArray(value)) return { path, message: "Expected an array." };
      if (value.length > schema.maxItems) return { path, message: `Expected at most ${schema.maxItems} items.` };
      for (let i = 0; i < value.length; i++) {
        const issue = validateValue(schema.items, value[i], `${path}[${i}]`, depth + 1);
        if (issue !== null) return issue;
      }
      return null;
    }
    case "object": {
      if (!isPlainObject(value)) return { path, message: "Expected an object." };
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) return { path: `${path}.${key}`, message: "Property is not allowed." };
      }
      for (const key of schema.required) {
        if (!Object.hasOwn(value, key)) return { path: `${path}.${key}`, message: "Required property is missing." };
      }
      for (const [key, child] of Object.entries(schema.properties)) {
        if (!Object.hasOwn(value, key)) continue;
        const issue = validateValue(child, value[key], `${path}.${key}`, depth + 1);
        if (issue !== null) return issue;
      }
      return null;
    }
    default:
      return { path, message: "Unsupported schema." };
  }
}

export type CanonicalParamsResult =
  | { ok: true; params: Params; canonical: string }
  | { ok: false; issue: ValueIssue };

/**
 * Validates parameters and produces their canonical encoding: -0 normalized to 0,
 * keys sorted, JSON encoded. String case and Unicode are not normalized.
 */
export function canonicalizeParams(schema: Schema, params: unknown): CanonicalParamsResult {
  const issue = validateValue(schema, params);
  if (issue !== null) return { ok: false, issue };
  const normalized: Record<string, string | boolean | number> = {};
  for (const key of Object.keys(params as Record<string, unknown>).sort()) {
    const value = (params as Record<string, string | boolean | number>)[key];
    if (value === undefined) continue;
    Object.defineProperty(normalized, key, {
      value: typeof value === "number" && Object.is(value, -0) ? 0 : value,
      enumerable: true, writable: true, configurable: true
    });
  }
  return { ok: true, params: normalized, canonical: canonicalJson(normalized) };
}

export function isJsonData(value: unknown): value is Json {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}
