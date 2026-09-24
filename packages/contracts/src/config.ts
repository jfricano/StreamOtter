import { StreamOtterError } from "./errors.ts";
import { validateLimits } from "./limits.ts";
import { IDENTIFIER_PATTERN, isPlainObject } from "./primitives.ts";
import { pointer, validateParamsSchema, validateSchemaDefinition } from "./schema.ts";
import type { ConfigIssue, ProjectConfig, Schema } from "./types.ts";

export interface ConfigValidation { valid: boolean; issues: ConfigIssue[] }

/** Keys that belong to deferred V2/V3 features; reported with a clear message. */
const DEFERRED_FEATURES: Readonly<Record<string, string>> = {
  history: "Retained history is a V2 feature and is not supported in V1.",
  recovery: "Client recovery cursors are a V2 feature and are not supported in V1.",
  retention: "Retention windows are a V2 feature and are not supported in V1.",
  acknowledgement: "Application acknowledgements are a V2 feature and are not supported in V1.",
  resume: "Resume policies are a V2 feature and are not supported in V1.",
  replay: "Replay is a V2 feature and is not supported in V1.",
  commands: "Commands are a V3 feature and are not supported in V1.",
  command: "Commands are a V3 feature and are not supported in V1.",
  gateways: "Multiple gateways are a V2 feature and are not supported in V1.",
  cluster: "Multiple gateways are a V2 feature and are not supported in V1.",
  schemaRegistry: "Schema Registry integration is a V2 feature and is not supported in V1.",
  workspaces: "Team workspaces are a V3 feature and are not supported in V1.",
  environments: "Environments are a V3 feature and are not supported in V1.",
  transports: "Only the Socket.IO transport is supported in V1.",
  transport: "Only the Socket.IO transport is supported in V1."
};

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const KAFKA_NAME_PATTERN = /^[A-Za-z0-9._-]{1,249}$/;
const BROKER_PATTERN = /^[A-Za-z0-9.-]+:[0-9]{1,5}$|^\[[0-9A-Fa-f:.]+\]:[0-9]{1,5}$/;

class Checker {
  readonly issues: ConfigIssue[] = [];

  add(path: string, code: string, message: string): void {
    this.issues.push({ path, code, message });
  }

  /** Reports unknown keys (with deferred-feature messages) and missing required keys. */
  keys(value: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []): void {
    for (const key of Object.keys(value)) {
      if (required.includes(key) || optional.includes(key)) continue;
      const deferred = DEFERRED_FEATURES[key];
      if (deferred !== undefined) this.add(pointer(path, key), "UNSUPPORTED_FEATURE", deferred);
      else this.add(pointer(path, key), "UNKNOWN_KEY", `Unknown key "${key}".`);
    }
    for (const key of required) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) this.add(pointer(path, key), "REQUIRED", `"${key}" is required.`);
    }
  }

  object(value: unknown, path: string, label: string): value is Record<string, unknown> {
    if (isPlainObject(value)) return true;
    this.add(path, "INVALID_TYPE", `${label} must be an object.`);
    return false;
  }

  identifier(value: unknown, path: string, label: string): value is string {
    if (typeof value === "string" && IDENTIFIER_PATTERN.test(value)) return true;
    this.add(path, "INVALID_IDENTIFIER", `${label} must match [A-Za-z][A-Za-z0-9_-]{0,63}.`);
    return false;
  }

  nonEmptyString(value: unknown, path: string, label: string, max = 1024): value is string {
    if (typeof value === "string" && value.length > 0 && value.length <= max) return true;
    this.add(path, "INVALID_VALUE", `${label} must be a non-empty string of at most ${max} characters.`);
    return false;
  }

  secretRef(value: unknown, path: string): void {
    if (!this.object(value, path, "A secret reference")) return;
    this.keys(value, path, ["env"]);
    if (value["env"] !== undefined && !(typeof value["env"] === "string" && ENV_NAME_PATTERN.test(value["env"]))) {
      this.add(pointer(path, "env"), "INVALID_VALUE", "env must name an environment variable.");
    }
  }
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * Structural, schema, and reference validation of a portable configuration.
 * Never resolves secrets, runs handlers, or connects to brokers.
 */
export function validateProjectConfig(input: unknown): ConfigValidation {
  const c = new Checker();
  if (!c.object(input, "", "The configuration")) return { valid: false, issues: c.issues };
  c.keys(input, "", ["configVersion", "projectId", "gateway", "connections", "sources", "schemas", "channels"], ["limits"]);

  if (input["configVersion"] !== undefined && input["configVersion"] !== 1) {
    c.add("/configVersion", "UNSUPPORTED_FEATURE", "Only configVersion 1 is supported.");
  }
  if (input["projectId"] !== undefined) c.identifier(input["projectId"], "/projectId", "projectId");

  const gateway = input["gateway"];
  if (gateway !== undefined && c.object(gateway, "/gateway", "gateway")) {
    c.keys(gateway, "/gateway", ["host", "port", "path", "allowedOrigins"]);
    if (gateway["host"] !== undefined) c.nonEmptyString(gateway["host"], "/gateway/host", "host", 253);
    const port = gateway["port"];
    if (port !== undefined && !(typeof port === "number" && Number.isInteger(port) && port >= 0 && port <= 65_535)) {
      c.add("/gateway/port", "INVALID_VALUE", "port must be an integer from 0 to 65535.");
    }
    const path = gateway["path"];
    if (path !== undefined && !(typeof path === "string" && /^\/[A-Za-z0-9._~\/-]*$/.test(path) && path.length <= 256)) {
      c.add("/gateway/path", "INVALID_VALUE", "path must be an absolute URL path without a query or fragment.");
    }
    const origins = gateway["allowedOrigins"];
    if (origins !== undefined) {
      if (!Array.isArray(origins)) {
        c.add("/gateway/allowedOrigins", "INVALID_TYPE", "allowedOrigins must be an array of exact origins.");
      } else {
        origins.forEach((origin, index) => {
          if (!isOrigin(origin)) {
            c.add(pointer("/gateway/allowedOrigins", index), "INVALID_VALUE", "Each allowed origin must be an exact http(s) origin such as https://app.example.com; wildcards are not allowed.");
          }
        });
        if (new Set(origins).size !== origins.length) c.add("/gateway/allowedOrigins", "DUPLICATE", "allowedOrigins must be unique.");
      }
    }
  }

  const connectionIds = new Set<string>();
  const connections = input["connections"];
  if (connections !== undefined && c.object(connections, "/connections", "connections")) {
    for (const [id, profile] of Object.entries(connections)) {
      const path = pointer("/connections", id);
      if (!c.identifier(id, path, "Connection profile IDs")) continue;
      connectionIds.add(id);
      if (!c.object(profile, path, "A connection profile")) continue;
      c.keys(profile, path, ["brokers", "tls"], ["sasl"]);
      const brokers = profile["brokers"];
      if (brokers !== undefined) {
        if (!Array.isArray(brokers) || brokers.length === 0) {
          c.add(pointer(path, "brokers"), "INVALID_VALUE", "brokers must be a non-empty array of host:port strings.");
        } else {
          brokers.forEach((broker, index) => {
            if (typeof broker !== "string" || !BROKER_PATTERN.test(broker)) {
              c.add(pointer(pointer(path, "brokers"), index), "INVALID_VALUE", "Each broker must be host:port.");
            }
          });
        }
      }
      const tls = profile["tls"];
      if (tls !== undefined && tls !== false) {
        if (c.object(tls, pointer(path, "tls"), "tls (false or an object)")) {
          c.keys(tls, pointer(path, "tls"), [], ["caFile"]);
          if (tls["caFile"] !== undefined) c.nonEmptyString(tls["caFile"], pointer(pointer(path, "tls"), "caFile"), "caFile", 4096);
        }
      }
      const sasl = profile["sasl"];
      if (sasl !== undefined && c.object(sasl, pointer(path, "sasl"), "sasl")) {
        const saslPath = pointer(path, "sasl");
        c.keys(sasl, saslPath, ["mechanism", "username", "password"]);
        const mechanism = sasl["mechanism"];
        if (mechanism !== undefined && mechanism !== "plain" && mechanism !== "scram-sha-256" && mechanism !== "scram-sha-512") {
          c.add(pointer(saslPath, "mechanism"), "UNSUPPORTED_FEATURE", "SASL mechanism must be plain, scram-sha-256, or scram-sha-512 (OAuth is not supported in V1).");
        }
        if (sasl["username"] !== undefined) c.secretRef(sasl["username"], pointer(saslPath, "username"));
        if (sasl["password"] !== undefined) c.secretRef(sasl["password"], pointer(saslPath, "password"));
      }
    }
  }

  const sourceIds = new Set<string>();
  const kafkaProfiles = new Set<string>();
  const consumerGroups = new Map<string, string>();
  const sources = input["sources"];
  if (sources !== undefined && c.object(sources, "/sources", "sources")) {
    for (const [id, source] of Object.entries(sources)) {
      const path = pointer("/sources", id);
      if (!c.identifier(id, path, "Source IDs")) continue;
      sourceIds.add(id);
      if (!c.object(source, path, "A source")) continue;
      const kind = source["kind"];
      if (kind === "kafka") {
        c.keys(source, path, ["kind", "generation", "connectionRef", "topics", "consumerGroup", "codec", "startFrom"]);
        if (source["generation"] !== undefined) c.identifier(source["generation"], pointer(path, "generation"), "generation");
        const ref = source["connectionRef"];
        if (ref !== undefined) {
          if (typeof ref !== "string" || !connectionIds.has(ref)) {
            c.add(pointer(path, "connectionRef"), "UNKNOWN_REFERENCE", "connectionRef must name a configured connection profile.");
          } else {
            kafkaProfiles.add(ref);
          }
        }
        const topics = source["topics"];
        if (topics !== undefined) {
          if (!Array.isArray(topics) || topics.length === 0) {
            c.add(pointer(path, "topics"), "INVALID_VALUE", "topics must be a non-empty array.");
          } else {
            topics.forEach((topic, index) => {
              if (typeof topic !== "string" || !KAFKA_NAME_PATTERN.test(topic)) {
                c.add(pointer(pointer(path, "topics"), index), "INVALID_VALUE", "Topic names may contain letters, digits, '.', '_', and '-'.");
              }
            });
            if (new Set(topics).size !== topics.length) c.add(pointer(path, "topics"), "DUPLICATE", "topics must be unique.");
          }
        }
        const group = source["consumerGroup"];
        if (group !== undefined) {
          if (typeof group !== "string" || !KAFKA_NAME_PATTERN.test(group)) {
            c.add(pointer(path, "consumerGroup"), "INVALID_VALUE", "consumerGroup may contain letters, digits, '.', '_', and '-'.");
          } else {
            const owner = consumerGroups.get(group);
            if (owner !== undefined) {
              c.add(pointer(path, "consumerGroup"), "CONSUMER_GROUP_CONFLICT", `Consumer group "${group}" is already used by source "${owner}"; each source needs a dedicated group.`);
            } else {
              consumerGroups.set(group, id);
            }
          }
        }
        if (source["codec"] !== undefined && source["codec"] !== "json") {
          c.add(pointer(path, "codec"), "UNSUPPORTED_FEATURE", "Only the json codec is supported in V1.");
        }
        const startFrom = source["startFrom"];
        if (startFrom !== undefined && startFrom !== "latest" && startFrom !== "earliest") {
          c.add(pointer(path, "startFrom"), "INVALID_VALUE", "startFrom must be latest or earliest.");
        }
      } else if (kind === "fixture") {
        c.keys(source, path, ["kind", "generation", "fixtureRef"]);
        if (source["generation"] !== undefined) c.identifier(source["generation"], pointer(path, "generation"), "generation");
        if (source["fixtureRef"] !== undefined) c.identifier(source["fixtureRef"], pointer(path, "fixtureRef"), "fixtureRef");
      } else {
        c.add(pointer(path, "kind"), "UNSUPPORTED_FEATURE", "Source kind must be kafka or fixture in V1.");
      }
    }
  }
  if (kafkaProfiles.size > 1) {
    c.add("/sources", "MULTIPLE_CONNECTIONS", "V1 supports one Kafka connection profile per project; list multiple brokers of one cluster in that profile instead.");
  }

  const schemaDefinitions = new Map<string, Schema>();
  const schemas = input["schemas"];
  if (schemas !== undefined && c.object(schemas, "/schemas", "schemas")) {
    for (const [id, schema] of Object.entries(schemas)) {
      const path = pointer("/schemas", id);
      if (!c.identifier(id, path, "Schema IDs")) continue;
      if (validateSchemaDefinition(schema, path, c.issues)) schemaDefinitions.set(id, schema);
    }
  }

  const channels = input["channels"];
  if (channels !== undefined && c.object(channels, "/channels", "channels")) {
    for (const [name, channel] of Object.entries(channels)) {
      const path = pointer("/channels", name);
      if (!c.identifier(name, path, "Channel names")) continue;
      if (!c.object(channel, path, "A channel")) continue;
      c.keys(channel, path, ["version", "source", "paramsSchema", "payloadSchema", "handlersRef", "delivery"]);
      const version = channel["version"];
      if (version !== undefined && !(typeof version === "number" && Number.isSafeInteger(version) && version > 0)) {
        c.add(pointer(path, "version"), "INVALID_VALUE", "version must be a positive integer.");
      }
      const source = channel["source"];
      if (source !== undefined && (typeof source !== "string" || !sourceIds.has(source))) {
        c.add(pointer(path, "source"), "UNKNOWN_REFERENCE", "source must name a configured source.");
      }
      for (const key of ["paramsSchema", "payloadSchema"] as const) {
        const ref = channel[key];
        if (ref === undefined) continue;
        if (typeof ref !== "string" || !(schemas !== undefined && isPlainObject(schemas) && Object.hasOwn(schemas, ref))) {
          c.add(pointer(path, key), "UNKNOWN_REFERENCE", `${key} must name a configured schema.`);
        }
      }
      const paramsRef = channel["paramsSchema"];
      if (typeof paramsRef === "string") {
        const schema = schemaDefinitions.get(paramsRef);
        if (schema !== undefined) validateParamsSchema(schema, pointer("/schemas", paramsRef), c.issues);
      }
      const handlersRef = channel["handlersRef"];
      if (handlersRef !== undefined && handlersRef !== name) {
        c.add(pointer(path, "handlersRef"), "HANDLERS_REF_MISMATCH", "handlersRef must equal the channel name in V1.");
      }
      const delivery = channel["delivery"];
      if (delivery !== undefined && c.object(delivery, pointer(path, "delivery"), "delivery")) {
        const deliveryPath = pointer(path, "delivery");
        c.keys(delivery, deliveryPath, ["kind", "overflow"]);
        if (delivery["kind"] !== undefined && delivery["kind"] !== "state") {
          c.add(pointer(deliveryPath, "kind"), "UNSUPPORTED_FEATURE",
            delivery["kind"] === "events"
              ? "Retained event channels (delivery.kind \"events\") are a V2 feature; V1 supports only \"state\"."
              : "delivery.kind must be \"state\" in V1.");
        }
        if (delivery["overflow"] !== undefined && delivery["overflow"] !== "resync") {
          c.add(pointer(deliveryPath, "overflow"), "UNSUPPORTED_FEATURE", "delivery.overflow must be \"resync\" in V1.");
        }
      }
    }
  }

  validateLimits(input["limits"], "/limits", c.issues);
  return { valid: c.issues.length === 0, issues: c.issues };
}

/** Throws CONFIG_INVALID with the issues attached when the configuration is invalid. */
export function assertValidProjectConfig(input: unknown): asserts input is ProjectConfig {
  const { valid, issues } = validateProjectConfig(input);
  if (valid) return;
  const summary = issues.slice(0, 3).map(issue => `${issue.path || "/"}: ${issue.message}`).join("; ");
  throw new StreamOtterError("CONFIG_INVALID", {
    message: `The configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}): ${summary}`,
    details: { issues: issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })) }
  });
}
