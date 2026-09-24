import { randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server as IoServer } from "socket.io";
import {
  assertValidProjectConfig, canonicalizeParams, canonicalJson, compareRevisions, DEFAULT_STOP_TIMEOUT_MS,
  isJsonValue, isPlainObject, isRevision, MAX_TOKEN_BYTES, parseUtcTimestamp, PREVIEW_TOKEN_TTL_MS,
  resolveLimits, STARTUP_DEADLINE_MS, streamError, StreamOtterError, utf8ByteLength, validateValue,
  type ChannelMap, type ChannelSummary, type DevelopmentOptions, type DevelopmentPrincipalSummary,
  type DiagnosticStep, type ErrorCode, type Gateway, type GatewayLogger, type GatewayOptions, type HandlerRegistry,
  type Json, type Page, type Principal, type ProjectConfig, type Revocation, type Schema, type SourceRecord,
  type SourceStatus, type StreamError, type StreamEvent, type Trace
} from "@streamotter/contracts";
import { ByteBudget } from "./budget.ts";
import { Router, routingKey, type ChannelRuntime, type GatewayCore, type SourceRuntime } from "./core.ts";
import {
  freezePrincipal, identityKey, matchesPrincipal, principalProblem, RevocationLog, sourceRecordId, updateEventId
} from "./identity.ts";
import { ClientSession, type SessionOwner } from "./session.ts";
import { FRAME_OVERHEAD_BYTES, type PendingFrame, type ServerSubscription } from "./subscription.ts";
import { TraceBuffer, type TraceQuery } from "./traces.ts";
import { consoleLogger, describeError, invokeHandler, newId, nowIso, Semaphore, sha256Hex } from "./util.ts";
import { FixtureSourceAdapter, type FixtureRecord } from "../sources/fixture.ts";
import { createKafkaSourceAdapter, resolveKafkaConnection, runKafkaDiagnostics, type ResolvedKafkaConnection } from "../sources/kafka.ts";
import type { ProcessOutcome, SourceAdapter, SourceInput, SourceSink } from "../sources/types.ts";
import { attachSocketIo, type HandshakeResult } from "../transport/socketio.ts";
import type { ConnectionTransport } from "../transport/types.ts";

type LifecycleState = "idle" | "starting" | "running" | "stopping" | "stopped";

class SourceRuntimeImpl implements SourceRuntime {
  readonly id: string;
  readonly config: ProjectConfig["sources"][string];
  readonly channels: ChannelRuntime[] = [];
  adapter: SourceAdapter | null = null;
  status: SourceStatus["status"] = "starting";
  reason: ErrorCode | undefined = undefined;

  constructor(id: string, config: ProjectConfig["sources"][string]) {
    this.id = id;
    this.config = config;
  }

  get ready(): boolean {
    return this.status === "healthy";
  }

  summary(): SourceStatus {
    const status: SourceStatus = { sourceId: this.id, kind: this.config.kind, status: this.status };
    if (this.reason !== undefined && this.status !== "healthy") status.reason = this.reason;
    return status;
  }
}

interface RoutedOutput { channel: ChannelRuntime; key: string; frame: PendingFrame }

interface PreviewSession { principal: Principal; expiresAtMs: number }

/** Test-only instrumentation; not reachable through the public createGateway(). */
export interface InternalGatewayOptions {
  /** Awaited after a Kafka record is processed and before its offset is committed. */
  beforeCommit?: (sourceId: string, position: SourceRecord["position"]) => Promise<void>;
}

/** Development and management access to a running gateway; never exposed to browsers. */
export interface GatewayInternals {
  readonly mode: "development" | "production";
  readonly config: ProjectConfig;
  readonly fingerprint: string;
  readonly limits: GatewayCore["limits"];
  readonly logger: GatewayLogger;
  readonly running: boolean;
  address(): { origin: string; path: string } | null;
  health(): { ready: boolean; sources: SourceStatus[] };
  sources(): SourceStatus[];
  channels(): ChannelSummary[];
  traces(query: TraceQuery): Page<Trace>;
  checkSource(sourceId: string): Promise<DiagnosticStep[]>;
  checkAllSources(): Promise<{ sourceId: string; steps: DiagnosticStep[] }[]>;
  resumeSource(sourceId: string): Promise<SourceStatus>;
  allowDevelopmentOrigin(origin: string): void;
  developmentPrincipals(): DevelopmentPrincipalSummary[];
  createPreviewSession(principalRef: string): { token: string; expiresAt: string; previewSessionId: string };
  disconnectPreviewSession(previewSessionId: string): void;
  advanceFixture(sourceId: string, count: number): Promise<number>;
  onStop(callback: () => Promise<void> | void): void;
  connectionCount(): number;
  subscriptionCount(): number;
  pendingBytes(): number;
}

const internalsRegistry = new WeakMap<Gateway, GatewayInternals>();

export function getGatewayInternals(gateway: Gateway): GatewayInternals {
  const internals = internalsRegistry.get(gateway);
  if (internals === undefined) throw new StreamOtterError("INVALID_REQUEST", { message: "Not a StreamOtter gateway instance." });
  return internals;
}

function notFound(message: string): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message, details: { status: 404 } });
}

function conflict(message: string): StreamOtterError {
  return new StreamOtterError("SOURCE_UNAVAILABLE", { message, details: { status: 409 } });
}

function validateHandlers(config: ProjectConfig, handlers: unknown): asserts handlers is HandlerRegistry<ChannelMap> {
  const issues: string[] = [];
  const registry = handlers as Partial<HandlerRegistry<ChannelMap>> | null;
  if (typeof registry !== "object" || registry === null) {
    issues.push("handlers must be an object");
  } else {
    if (typeof registry.authenticate !== "function") issues.push("handlers.authenticate must be a function");
    const channels = registry.channels as Record<string, unknown> | undefined;
    if (typeof channels !== "object" || channels === null) {
      issues.push("handlers.channels must be an object");
    } else {
      for (const [name, channel] of Object.entries(config.channels)) {
        const entry = channels[channel.handlersRef] as Record<string, unknown> | undefined;
        if (typeof entry !== "object" || entry === null) {
          issues.push(`handlers.channels.${name} is missing`);
          continue;
        }
        for (const fn of ["authorize", "map", "snapshot"]) {
          if (typeof entry[fn] !== "function") issues.push(`handlers.channels.${name}.${fn} must be a function`);
        }
      }
      for (const name of Object.keys(channels)) {
        if (!Object.hasOwn(config.channels, name)) issues.push(`handlers.channels.${name} does not match a configured channel`);
      }
    }
  }
  if (issues.length > 0) {
    throw new StreamOtterError("CONFIG_INVALID", { message: `Invalid handler registry: ${issues.join("; ")}.`, details: { issues } });
  }
}

function validateDevelopment(config: ProjectConfig, development: DevelopmentOptions | undefined): void {
  const issues: string[] = [];
  for (const [id, source] of Object.entries(config.sources)) {
    if (source.kind !== "fixture") continue;
    const records = development?.fixtures[source.fixtureRef];
    if (!Array.isArray(records)) {
      issues.push(`development.fixtures.${source.fixtureRef} is required by source ${id}`);
      continue;
    }
    records.forEach((record: unknown, index) => {
      if (!isPlainObject(record) || !(record["key"] === null || typeof record["key"] === "string") || !isJsonValue(record["value"])) {
        issues.push(`development.fixtures.${source.fixtureRef}[${index}] must be {key: string | null, value: JSON}`);
      }
    });
  }
  for (const [ref, principal] of Object.entries(development?.principals ?? {})) {
    const problem = principalProblem(principal);
    if (problem !== null) issues.push(`development.principals.${ref}: ${problem}`);
  }
  if (issues.length > 0) {
    throw new StreamOtterError("CONFIG_INVALID", { message: `Invalid development options: ${issues.join("; ")}.`, details: { issues } });
  }
}

function validateProduction(config: ProjectConfig, options: GatewayOptions<ChannelMap>): void {
  const issues: string[] = [];
  if (options.development !== undefined) issues.push("development options are rejected in production mode");
  for (const [id, source] of Object.entries(config.sources)) {
    if (source.kind === "fixture") issues.push(`source ${id} is a fixture; fixture sources are development-only`);
    if (source.kind === "kafka" && config.connections[source.connectionRef]?.tls === false) {
      issues.push(`source ${id} uses plaintext Kafka; plaintext connections are development-only`);
    }
  }
  if (issues.length > 0) {
    throw new StreamOtterError("CONFIG_INVALID", { message: `Invalid production configuration: ${issues.join("; ")}.`, details: { issues } });
  }
}

/** The V1 single-process gateway. Construct with createGateway(). */
export class GatewayRuntime implements SessionOwner {
  readonly core: GatewayCore;
  readonly config: ProjectConfig;
  readonly fingerprint: string;
  readonly mode: "development" | "production";
  readonly #handlers: HandlerRegistry<ChannelMap>;
  readonly #development: DevelopmentOptions | undefined;
  readonly #configDir: string;
  readonly #sources = new Map<string, SourceRuntimeImpl>();
  readonly #channels = new Map<string, ChannelRuntime>();
  readonly #sessions = new Set<ClientSession>();
  readonly #allowedOrigins: Set<string>;
  readonly #previews = new Map<string, PreviewSession>();
  readonly #previewTokens = new Map<string, string>();
  readonly #stopController = new AbortController();
  readonly #stopCallbacks: (() => Promise<void> | void)[] = [];
  #state: LifecycleState = "idle";
  #starting: Promise<{ origin: string; path: string }> | null = null;
  #stopping: Promise<void> | null = null;
  #address: { origin: string; path: string } | null = null;
  #http: HttpServer | null = null;
  #io: IoServer | null = null;
  #pendingHandshakes = 0;
  #activeChecks = 0;
  readonly #internal: InternalGatewayOptions;

  constructor(options: GatewayOptions<ChannelMap>, internal: InternalGatewayOptions = {}) {
    this.#internal = internal;
    if (options.mode !== "development" && options.mode !== "production") {
      throw new StreamOtterError("CONFIG_INVALID", { message: "mode must be development or production." });
    }
    assertValidProjectConfig(options.config);
    const config = options.config;
    validateHandlers(config, options.handlers);
    if (options.mode === "production") validateProduction(config, options);
    else validateDevelopment(config, options.development);

    this.config = config;
    this.mode = options.mode;
    this.fingerprint = sha256Hex(config);
    this.#handlers = options.handlers;
    this.#development = options.development;
    this.#configDir = options.configDir ?? process.cwd();
    this.#allowedOrigins = new Set(config.gateway.allowedOrigins);
    const limits = resolveLimits(config.limits);
    this.core = {
      projectId: config.projectId,
      mode: options.mode,
      limits,
      traces: new TraceBuffer(limits.maxTraceEntries, limits.maxTraceBytes),
      router: new Router(),
      snapshots: new Semaphore(limits.maxConcurrentSnapshots),
      revocations: new RevocationLog(Math.max(60_000, limits.snapshotTimeoutMs + limits.handlerTimeoutMs * 3)),
      logger: options.logger ?? consoleLogger(),
      gatewayBudget: new ByteBudget(limits.maxPendingBytesGateway)
    };
    for (const [id, source] of Object.entries(config.sources)) this.#sources.set(id, new SourceRuntimeImpl(id, source));
    for (const [name, channel] of Object.entries(config.channels)) {
      const source = this.#sources.get(channel.source);
      const handlers = this.#handlers.channels[channel.handlersRef];
      if (source === undefined || handlers === undefined) continue; // Unreachable after validation.
      const runtime: ChannelRuntime = {
        name,
        version: channel.version,
        handlers,
        paramsSchema: config.schemas[channel.paramsSchema] as Schema,
        payloadSchema: config.schemas[channel.payloadSchema] as Schema,
        source,
        subscriptions: new Set()
      };
      this.#channels.set(name, runtime);
      source.channels.push(runtime);
    }
  }

  // --- public lifecycle ------------------------------------------------------------

  start(): Promise<{ origin: string; path: string }> {
    if (this.#state === "stopping" || this.#state === "stopped") {
      return Promise.reject(new StreamOtterError("INVALID_REQUEST", { message: "A stopped gateway cannot restart; construct a new instance." }));
    }
    if (this.#state === "running" && this.#address !== null) return Promise.resolve(this.#address);
    if (this.#starting !== null) return this.#starting;
    this.#state = "starting";
    const starting = this.#doStart();
    this.#starting = starting;
    starting.then(() => { this.#starting = null; }, () => { this.#starting = null; });
    return starting;
  }

  stop(options?: { timeoutMs?: number }): Promise<void> {
    if (this.#stopping !== null) return this.#stopping;
    this.#stopping = this.#doStop(options?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    return this.#stopping;
  }

  async revoke(request: Revocation): Promise<{ closedSubscriptions: number; closedConnections: number }> {
    const selector = this.#validateRevocation(request);
    let canonicalParams: string | null = null;
    if (selector.kind === "channel" && selector.params !== undefined) {
      const channel = this.#channels.get(selector.channel);
      const canonical = channel === undefined ? null : canonicalizeParams(channel.paramsSchema, selector.params);
      canonicalParams = canonical !== null && canonical.ok ? canonical.canonical : canonicalJson(selector.params);
    }
    this.core.revocations.add(selector, canonicalParams);
    let closedSubscriptions = 0;
    let closedConnections = 0;
    const requestId = newId();
    for (const session of [...this.#sessions]) {
      if (!matchesPrincipal(selector, session.principal)) continue;
      if (selector.kind === "channel") {
        for (const subscription of [...session.subscriptions()]) {
          if (subscription.channel.name !== selector.channel || subscription.channel.version !== selector.channelVersion) continue;
          if (canonicalParams !== null && subscription.canonicalParams !== canonicalParams) continue;
          subscription.fail("FORBIDDEN", requestId, "Access to this subscription was revoked.");
          closedSubscriptions++;
        }
      } else {
        closedSubscriptions += session.subscriptionCount;
        closedConnections++;
        session.close(streamError("UNAUTHENTICATED", { message: "Access was revoked; authenticate again.", retryable: false, requestId }));
      }
    }
    this.core.logger.info("Access revoked", { kind: selector.kind, closedSubscriptions, closedConnections });
    return { closedSubscriptions, closedConnections };
  }

  async resumeSource(sourceId: string): Promise<SourceStatus> {
    const source = this.#sources.get(sourceId);
    if (source === undefined) throw notFound(`Unknown source "${sourceId}".`);
    if (this.#state !== "running" || source.adapter === null) throw conflict("The gateway is not running.");
    if (source.status === "healthy") return source.summary();
    if (source.status !== "paused") throw conflict(`Source "${sourceId}" is ${source.status}; only paused sources can be resumed.`);
    this.core.logger.info("Resuming source at its uncommitted position", { sourceId });
    await source.adapter.resume();
    return source.summary();
  }

  // --- SessionOwner ----------------------------------------------------------------

  channel(name: string): ChannelRuntime | undefined {
    return this.#channels.get(name);
  }

  sessionClosed(session: ClientSession): void {
    this.#sessions.delete(session);
  }

  // --- transport callbacks ---------------------------------------------------------

  async authenticateHandshake(input: { auth: unknown; origin: string | undefined }): Promise<{ ok: true; value: HandshakeResult } | { ok: false; error: StreamError }> {
    const requestId = newId();
    const reject = (code: ErrorCode, message?: string, retryable?: boolean) => {
      this.core.traces.record({ requestId, stage: "authorize", outcome: "rejected", errorCode: code });
      const options: { requestId: string; message?: string; retryable?: boolean } = { requestId };
      if (message !== undefined) options.message = message;
      if (retryable !== undefined) options.retryable = retryable;
      return { ok: false as const, error: streamError(code, options) };
    };
    if (this.#state !== "running") return reject("OVERLOADED", "The gateway is not accepting connections.");
    const { origin, auth } = input;
    if (origin === undefined || origin === "") {
      if (this.mode === "production") return reject("FORBIDDEN", "An Origin header is required.");
    } else if (!this.#allowedOrigins.has(origin)) {
      return reject("FORBIDDEN", "This origin is not allowed.");
    }
    if (!isPlainObject(auth)) return reject("UNAUTHENTICATED", undefined, false);
    if (Object.keys(auth).some(key => key !== "token" && key !== "protocolVersion")) {
      return reject("INVALID_REQUEST", "Only token and protocolVersion are accepted in the authentication payload.");
    }
    if (auth["protocolVersion"] !== 1) return reject("UNSUPPORTED_CAPABILITY", "This gateway requires protocol version 1.");
    const token = auth["token"];
    if (typeof token !== "string" || token.length === 0 || utf8ByteLength(token) > MAX_TOKEN_BYTES) {
      return reject("UNAUTHENTICATED", "A non-empty token of at most 8 KiB is required.", false);
    }
    if (this.#sessions.size + this.#pendingHandshakes >= this.core.limits.maxConnections) {
      return reject("OVERLOADED", "The gateway has reached its connection limit.");
    }
    this.#pendingHandshakes++;
    try {
      const revocationSeq = this.core.revocations.sequence;
      let principal: Principal;
      let previewSessionId: string | null = null;
      const previewId = this.mode === "development" ? this.#previewTokens.get(token) : undefined;
      if (previewId !== undefined) {
        const preview = this.#previews.get(previewId);
        if (preview === undefined || preview.expiresAtMs <= Date.now()) return reject("UNAUTHENTICATED", "The preview token has expired.", false);
        principal = preview.principal;
        previewSessionId = previewId;
      } else {
        const outcome = await invokeHandler(
          context => this.#handlers.authenticate({ ...context, token, origin: origin ?? "" }),
          { timeoutMs: this.core.limits.handlerTimeoutMs, requestId, parent: this.#stopController.signal }
        );
        if (outcome.kind === "aborted") return reject("OVERLOADED", "The gateway is shutting down.");
        if (outcome.kind === "timeout") {
          this.core.logger.warn("authenticate handler timed out", { requestId });
          return reject("HANDLER_FAILED", "Authentication could not be completed; try again.");
        }
        if (outcome.kind === "error") {
          this.core.logger.warn("authenticate handler failed", { requestId, error: describeError(outcome.error) });
          return reject("HANDLER_FAILED", "Authentication could not be completed; try again.");
        }
        if (outcome.value === null) return reject("UNAUTHENTICATED", undefined, false);
        const problem = principalProblem(outcome.value);
        if (problem !== null) {
          this.core.logger.warn("authenticate returned an invalid principal", { requestId, reason: problem });
          return reject(problem.includes("future") ? "UNAUTHENTICATED" : "HANDLER_FAILED",
            problem.includes("future") ? "The token has expired." : "Authentication could not be completed; try again.",
            problem.includes("future") ? false : true);
        }
        principal = freezePrincipal(outcome.value);
      }
      if (this.core.revocations.revokedSince(revocationSeq, principal)) return reject("UNAUTHENTICATED", "Access was revoked.", false);
      if (this.#state !== "running") return reject("OVERLOADED", "The gateway is not accepting connections.");
      this.core.traces.record({ requestId, stage: "authorize", outcome: "ok" });
      return { ok: true, value: { principal, previewSessionId } };
    } finally {
      this.#pendingHandshakes--;
    }
  }

  openSession(result: HandshakeResult, transport: ConnectionTransport): ClientSession {
    const session = new ClientSession({
      owner: this,
      transport,
      principal: result.principal,
      identityKey: identityKey(this.config.projectId, result.principal),
      previewSessionId: result.previewSessionId
    });
    this.#sessions.add(session);
    if (this.#state !== "running") queueMicrotask(() => session.close());
    return session;
  }

  // --- record pipeline -------------------------------------------------------------

  #sink(source: SourceRuntimeImpl): SourceSink {
    return {
      process: input => this.#process(source, input),
      setStatus: (status, reason) => this.#setSourceStatus(source, status, reason),
      logger: this.core.logger,
      stopSignal: this.#stopController.signal
    };
  }

  #setSourceStatus(source: SourceRuntimeImpl, status: SourceStatus["status"], reason?: ErrorCode): void {
    const wasReady = source.ready;
    if (source.status === status && source.reason === reason) return;
    source.status = status;
    source.reason = status === "healthy" ? undefined : reason;
    if (status !== "healthy") this.core.logger.warn("Source not ready", { sourceId: source.id, status, ...(reason === undefined ? {} : { reason }) });
    else if (!wasReady) this.core.logger.info("Source ready", { sourceId: source.id });
    if (wasReady && !source.ready) {
      for (const channel of source.channels) {
        for (const subscription of [...channel.subscriptions]) subscription.onSourceUnavailable("SOURCE_UNAVAILABLE");
      }
    } else if (!wasReady && source.ready) {
      for (const channel of source.channels) {
        for (const subscription of [...channel.subscriptions]) subscription.onSourceReady();
      }
    }
  }

  #halting(): boolean {
    return this.#state === "stopping" || this.#state === "stopped";
  }

  async #process(source: SourceRuntimeImpl, input: SourceInput): Promise<ProcessOutcome> {
    if (this.#halting()) return { kind: "abandon" };
    const requestId = newId();
    const { limits, traces } = this.core;
    const trace = (stage: Trace["stage"], outcome: Trace["outcome"], extra: Partial<Pick<Trace, "channel" | "subscriptionId" | "errorCode">> = {}) =>
      traces.record({ requestId, stage, outcome, sourceId: source.id, ...extra });
    const pause = (stage: Trace["stage"], code: ErrorCode, reason: string, channel?: string): ProcessOutcome => {
      trace(stage, stage === "map" ? "failed" : "rejected", channel === undefined ? { errorCode: code } : { errorCode: code, channel });
      this.core.logger.warn("Source paused on an unprocessable record; it will not be committed or skipped", {
        sourceId: source.id,
        position: input.position as unknown as Json,
        code,
        reason,
        ...(channel === undefined ? {} : { channel })
      });
      this.#setSourceStatus(source, "paused", code);
      return { kind: "pause", code };
    };
    trace("source", "ok");

    let value: Json;
    if (input.value !== undefined) {
      if (!isJsonValue(input.value)) return pause("validate", "INVALID_PAYLOAD", "fixture value is not JSON data");
      if (utf8ByteLength(JSON.stringify(input.value)) > limits.maxSourceRecordBytes) {
        return pause("validate", "INVALID_PAYLOAD", "record exceeds maxSourceRecordBytes");
      }
      value = input.value;
    } else {
      const bytes = input.bytes ?? null;
      if (bytes === null) return pause("validate", "INVALID_PAYLOAD", "tombstone records have no V1 meaning; represent deletion as explicit state");
      if (bytes.byteLength > limits.maxSourceRecordBytes) return pause("validate", "INVALID_PAYLOAD", "record exceeds maxSourceRecordBytes");
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Json;
      } catch {
        return pause("validate", "INVALID_PAYLOAD", "record value is not valid UTF-8 JSON");
      }
      if (!isJsonValue(value)) return pause("validate", "INVALID_PAYLOAD", "record value exceeds the nesting limit");
    }
    trace("validate", "ok");

    const record: SourceRecord = Object.freeze({
      id: sourceRecordId(this.config.projectId, source.id, source.config.generation, input.position),
      sourceId: source.id,
      key: input.key,
      value,
      receivedAt: nowIso(),
      position: Object.freeze({ ...input.position })
    });

    // Map for every channel and validate every output before admitting any of them.
    const outputs: RoutedOutput[] = [];
    for (const channel of source.channels) {
      const outcome = await invokeHandler(
        context => channel.handlers.map({ ...context, record }),
        { timeoutMs: limits.handlerTimeoutMs, requestId, parent: this.#stopController.signal }
      );
      if (outcome.kind === "aborted" || this.#halting()) return { kind: "abandon" };
      if (outcome.kind === "timeout") return pause("map", "TIMEOUT", "map handler timed out", channel.name);
      if (outcome.kind === "error") {
        return pause("map", "HANDLER_FAILED", `map handler threw ${JSON.stringify(describeError(outcome.error))}`, channel.name);
      }
      const mapped: unknown = outcome.value;
      if (!Array.isArray(mapped)) return pause("map", "INVALID_PAYLOAD", "map must return an array", channel.name);
      if (mapped.length > limits.maxMapOutputs) return pause("map", "INVALID_PAYLOAD", `map returned more than ${limits.maxMapOutputs} outputs`, channel.name);
      for (let index = 0; index < mapped.length; index++) {
        const built = this.#buildOutput(channel, record, mapped[index]);
        if (typeof built === "string") return pause("map", "INVALID_PAYLOAD", `output ${index}: ${built}`, channel.name);
        outputs.push(built);
      }
      trace("map", mapped.length === 0 ? "filtered" : "ok", { channel: channel.name });
    }

    // Equal revisions with different canonical data conflict with current state.
    const seen = new Map<string, { revision: string; dataHash: string }>();
    for (const output of outputs) {
      const { revision, dataHash } = output.frame;
      const earlier = seen.get(output.key);
      let conflicting = earlier !== undefined && earlier.revision === revision && earlier.dataHash !== dataHash;
      for (const subscription of this.core.router.get(output.key) ?? []) {
        if (conflicting) break;
        conflicting = (subscription as ServerSubscription).conflicts(revision, dataHash);
      }
      if (conflicting) return pause("queue", "REVISION_CONFLICT", "the same revision was mapped to different data", output.channel.name);
      if (earlier === undefined || compareRevisions(revision, earlier.revision) > 0) seen.set(output.key, { revision, dataHash });
    }

    for (const output of outputs) {
      const subscriptions = this.core.router.get(output.key);
      if (subscriptions === undefined) continue;
      for (const subscription of [...subscriptions] as ServerSubscription[]) subscription.admit(output.frame, requestId);
    }
    return { kind: "commit" };
  }

  #buildOutput(channel: ChannelRuntime, record: SourceRecord, item: unknown): RoutedOutput | string {
    if (!isPlainObject(item)) return "must be an object";
    for (const key of Object.keys(item)) {
      if (key !== "tenantId" && key !== "params" && key !== "revision" && key !== "data") return `unexpected field "${key}"`;
    }
    const { tenantId, params, revision, data } = item;
    if (typeof tenantId !== "string" || tenantId.length === 0 || tenantId.length > 512) return "tenantId must be a non-empty string";
    const canonical = canonicalizeParams(channel.paramsSchema, params);
    if (!canonical.ok) return `params ${canonical.issue.path}: ${canonical.issue.message}`;
    if (!isRevision(revision)) return "revision must be a canonical unsigned decimal string";
    if (!isJsonValue(data)) return "data must be JSON";
    const issue = validateValue(channel.payloadSchema, data);
    if (issue !== null) return `data ${issue.path}: ${issue.message}`;
    const event: StreamEvent = {
      id: updateEventId(record.id, channel.name, channel.version, tenantId, canonical.canonical, revision),
      channel: channel.name,
      channelVersion: channel.version,
      kind: "update",
      data,
      revision,
      receivedAt: record.receivedAt
    };
    const bytes = Buffer.byteLength(JSON.stringify(event)) + FRAME_OVERHEAD_BYTES;
    if (bytes > this.core.limits.maxDataFrameBytes) return "the data frame exceeds maxDataFrameBytes";
    return {
      channel,
      key: routingKey(channel.name, channel.version, tenantId, canonical.canonical),
      frame: { event, bytes, revision, dataHash: sha256Hex(data) }
    };
  }

  /**
   * Staged diagnostics. Works whether or not the gateway started, so a failing
   * connection profile can be diagnosed; resolves secrets without reporting them.
   */
  async checkSource(source: SourceRuntimeImpl): Promise<DiagnosticStep[]> {
    const deadline = Date.now() + 10_000;
    if (source.adapter !== null) return source.adapter.check(deadline);
    if (source.config.kind === "fixture") {
      const records = this.#development?.fixtures[source.config.fixtureRef] ?? [];
      return [
        { stage: "resolve", outcome: "ok", message: `Fixture with ${records.length} records is registered.` },
        { stage: "connect", outcome: "skipped", message: "Fixture sources have no network connection." },
        { stage: "tls", outcome: "skipped", message: "Fixture sources have no network connection." },
        { stage: "authenticate", outcome: "skipped", message: "Fixture sources have no credentials." },
        { stage: "metadata", outcome: "skipped", message: "The gateway is not running." }
      ];
    }
    const profile = this.config.connections[source.config.connectionRef];
    if (profile === undefined) throw notFound(`Unknown connection profile "${source.config.connectionRef}".`);
    let connection: ResolvedKafkaConnection;
    try {
      connection = await resolveKafkaConnection(profile, this.#configDir);
    } catch (error) {
      return [
        { stage: "resolve", outcome: "failed", message: (error as Error).message },
        ...(["connect", "tls", "authenticate", "metadata"] as const).map(stage => ({ stage, outcome: "skipped" as const, message: "Skipped because the profile could not be resolved." }))
      ];
    }
    return runKafkaDiagnostics(connection, source.config.topics, deadline);
  }

  /** Diagnostics for every source, for startup failure reports. */
  async checkAllSources(): Promise<{ sourceId: string; steps: DiagnosticStep[] }[]> {
    const results = [];
    for (const source of this.#sources.values()) results.push({ sourceId: source.id, steps: await this.checkSource(source) });
    return results;
  }

  /** Called by adapters after a commit so the trace reflects actual source progress. */
  recordCommit(sourceId: string): void {
    this.core.traces.record({ requestId: newId(), stage: "commit", outcome: "ok", sourceId });
  }

  // --- lifecycle internals ---------------------------------------------------------

  async #doStart(): Promise<{ origin: string; path: string }> {
    const deadline = Date.now() + STARTUP_DEADLINE_MS;
    const started: SourceAdapter[] = [];
    let http: HttpServer | null = null;
    let io: IoServer | null = null;
    try {
      const connections = new Map<string, ResolvedKafkaConnection>();
      for (const source of this.#sources.values()) {
        if (source.config.kind !== "kafka" || connections.has(source.config.connectionRef)) continue;
        const profile = this.config.connections[source.config.connectionRef];
        if (profile === undefined) throw new StreamOtterError("CONFIG_INVALID", { message: `Unknown connection profile ${source.config.connectionRef}.` });
        connections.set(source.config.connectionRef, await resolveKafkaConnection(profile, this.#configDir));
      }

      http = createServer((_request, response) => {
        response.statusCode = 404;
        response.setHeader("Cache-Control", "no-store");
        response.end();
      });
      io = attachSocketIo(http, {
        path: this.config.gateway.path,
        maxControlFrameBytes: this.core.limits.maxControlFrameBytes,
        callbacks: {
          authenticate: input => this.authenticateHandshake(input),
          openSession: (result, transport) => this.openSession(result, transport)
        }
      });
      await new Promise<void>((resolve, reject) => {
        http?.once("error", reject);
        http?.listen(this.config.gateway.port, this.config.gateway.host, () => {
          http?.off("error", reject);
          resolve();
        });
      });

      for (const source of this.#sources.values()) {
        source.status = "starting";
        source.reason = undefined;
        const adapter = source.config.kind === "fixture"
          ? new FixtureSourceAdapter(
            (this.#development?.fixtures[source.config.fixtureRef] ?? []) as readonly FixtureRecord[],
            this.#sink(source),
            () => this.recordCommit(source.id)
          )
          : createKafkaSourceAdapter({
            projectId: this.config.projectId,
            sourceId: source.id,
            source: source.config,
            connection: connections.get(source.config.connectionRef) as ResolvedKafkaConnection,
            sink: this.#sink(source),
            onCommit: () => this.recordCommit(source.id),
            ...(this.#internal.beforeCommit === undefined ? {} : { beforeCommit: this.#internal.beforeCommit })
          });
        source.adapter = adapter;
        started.push(adapter);
      }
      const remaining = Math.max(1, deadline - Date.now());
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(started.map(adapter => adapter.start())),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new StreamOtterError("SOURCE_UNAVAILABLE", {
            message: "Sources did not become ready within the 30-second startup deadline."
          })), remaining);
        })
      ]).finally(() => clearTimeout(timer));

      const address = http.address() as AddressInfo;
      const host = this.config.gateway.host === "0.0.0.0" || this.config.gateway.host === "::" ? "127.0.0.1" : this.config.gateway.host;
      this.#http = http;
      this.#io = io;
      this.#address = { origin: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`, path: this.config.gateway.path };
      this.#state = "running";
      this.core.logger.info("Gateway started", { origin: this.#address.origin, path: this.#address.path, mode: this.mode });
      return this.#address;
    } catch (error) {
      await Promise.allSettled(started.map(adapter => adapter.stop(Date.now() + 5_000)));
      for (const source of this.#sources.values()) {
        source.adapter = null;
        source.status = "starting";
        source.reason = undefined;
      }
      if (io !== null) await new Promise<void>(resolve => io?.close(() => resolve()));
      else if (http !== null) await new Promise<void>(resolve => http?.close(() => resolve()));
      this.#state = "idle";
      if (error instanceof StreamOtterError) throw error;
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      throw new StreamOtterError("SOURCE_UNAVAILABLE", {
        message: code === "EADDRINUSE" ? `Port ${this.config.gateway.port} is already in use.` : `A source failed to start: ${(error as Error | undefined)?.message ?? String(error)}`
      });
    }
  }

  async #doStop(timeoutMs: number): Promise<void> {
    if (this.#starting !== null) await this.#starting.catch(() => undefined);
    const wasRunning = this.#state === "running";
    this.#state = "stopping";
    this.#stopController.abort();
    for (const session of [...this.#sessions]) session.close();
    const deadline = Date.now() + timeoutMs;
    const work = (async () => {
      await Promise.allSettled([...this.#sources.values()].map(async source => {
        await source.adapter?.stop(deadline);
        source.status = "stopped";
      }));
      await Promise.allSettled(this.#stopCallbacks.map(callback => callback()));
      const io = this.#io;
      if (io !== null) await new Promise<void>(resolve => io.close(() => resolve()));
    })();
    let timer: NodeJS.Timeout | undefined;
    const expired = await Promise.race([
      work.then(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), timeoutMs); })
    ]);
    clearTimeout(timer);
    if (expired) {
      this.core.logger.warn("Stop deadline expired; forcing closure without committing incomplete records");
      this.#http?.closeAllConnections();
    }
    this.#state = "stopped";
    if (wasRunning) this.core.logger.info("Gateway stopped");
  }

  #validateRevocation(request: unknown): Revocation {
    const invalid = () => new StreamOtterError("INVALID_REQUEST", { message: "Invalid revocation selector." });
    if (!isPlainObject(request)) throw invalid();
    const text = (value: unknown) => typeof value === "string" && value.length > 0;
    switch (request["kind"]) {
      case "session":
        if (!text(request["tenantId"]) || !text(request["sessionId"])) throw invalid();
        return { kind: "session", tenantId: request["tenantId"] as string, sessionId: request["sessionId"] as string };
      case "subject":
        if (!text(request["tenantId"]) || !text(request["subject"])) throw invalid();
        return { kind: "subject", tenantId: request["tenantId"] as string, subject: request["subject"] as string };
      case "channel": {
        const version = request["channelVersion"];
        if (!text(request["tenantId"]) || !text(request["subject"]) || !text(request["channel"])
          || typeof version !== "number" || !Number.isSafeInteger(version)) throw invalid();
        const selector: Revocation = {
          kind: "channel",
          tenantId: request["tenantId"] as string,
          subject: request["subject"] as string,
          channel: request["channel"] as string,
          channelVersion: version
        };
        if (request["params"] !== undefined) {
          if (!isPlainObject(request["params"])) throw invalid();
          selector.params = request["params"] as Record<string, string | number | boolean>;
        }
        return selector;
      }
      default:
        throw invalid();
    }
  }

  // --- development and management --------------------------------------------------

  internals(): GatewayInternals {
    const runtime = this;
    return {
      mode: this.mode,
      config: this.config,
      fingerprint: this.fingerprint,
      limits: this.core.limits,
      logger: this.core.logger,
      get running() { return runtime.#state === "running"; },
      address: () => this.#address,
      health: () => {
        const sources = [...this.#sources.values()].map(source => source.summary());
        return { ready: this.#state === "running" && sources.every(source => source.status === "healthy"), sources };
      },
      sources: () => [...this.#sources.values()].map(source => source.summary()),
      channels: () => Object.entries(this.config.channels).map(([name, channel]) => ({
        name,
        version: channel.version,
        source: channel.source,
        delivery: "state" as const,
        paramsSchema: channel.paramsSchema,
        payloadSchema: channel.payloadSchema
      })),
      traces: query => this.core.traces.page(query),
      checkSource: async sourceId => {
        const source = this.#sources.get(sourceId);
        if (source === undefined) throw notFound(`Unknown source "${sourceId}".`);
        if (this.#activeChecks >= 2) throw new StreamOtterError("OVERLOADED", { message: "At most two source checks may run at once." });
        this.#activeChecks++;
        try {
          return await this.checkSource(source);
        } finally {
          this.#activeChecks--;
        }
      },
      checkAllSources: () => this.checkAllSources(),
      resumeSource: sourceId => this.resumeSource(sourceId),
      allowDevelopmentOrigin: origin => {
        if (this.mode !== "development") throw new StreamOtterError("FORBIDDEN", { message: "Development origins are rejected in production." });
        this.#allowedOrigins.add(origin);
      },
      developmentPrincipals: () => {
        this.#requireDevelopment();
        return Object.entries(this.#development?.principals ?? {}).map(([ref, principal]) => ({
          ref, tenantId: principal.tenantId, subject: principal.subject
        }));
      },
      createPreviewSession: ref => this.#createPreviewSession(ref),
      disconnectPreviewSession: previewSessionId => {
        this.#requireDevelopment();
        if (!this.#previews.has(previewSessionId)) throw notFound("Unknown preview session.");
        for (const session of [...this.#sessions]) {
          if (session.previewSessionId === previewSessionId) session.close();
        }
      },
      advanceFixture: async (sourceId, count) => {
        this.#requireDevelopment();
        const source = this.#sources.get(sourceId);
        if (source === undefined) throw notFound(`Unknown source "${sourceId}".`);
        if (!(source.adapter instanceof FixtureSourceAdapter)) {
          throw new StreamOtterError("INVALID_REQUEST", { message: "Only fixture sources can be advanced; StreamOtter never publishes to Kafka." });
        }
        if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
          throw new StreamOtterError("INVALID_REQUEST", { message: "count must be an integer from 1 to 100." });
        }
        try {
          return await source.adapter.advance(count);
        } catch (error) {
          if (error instanceof StreamOtterError && error.code === "SOURCE_UNAVAILABLE") throw conflict(error.message);
          throw error;
        }
      },
      onStop: callback => { this.#stopCallbacks.push(callback); },
      connectionCount: () => this.#sessions.size,
      subscriptionCount: () => [...this.#sessions].reduce((sum, session) => sum + session.subscriptionCount, 0),
      pendingBytes: () => this.core.gatewayBudget.used
    };
  }

  #requireDevelopment(): void {
    if (this.mode !== "development") throw new StreamOtterError("FORBIDDEN", { message: "Development operations are unavailable in production." });
  }

  #createPreviewSession(ref: string): { token: string; expiresAt: string; previewSessionId: string } {
    this.#requireDevelopment();
    const principal = typeof ref === "string" && Object.hasOwn(this.#development?.principals ?? {}, ref)
      ? this.#development?.principals[ref]
      : undefined;
    if (principal === undefined) throw notFound(`Unknown development principal "${String(ref)}".`);
    const now = Date.now();
    for (const [id, preview] of this.#previews) {
      if (preview.expiresAtMs <= now) this.#previews.delete(id);
    }
    for (const [token, id] of this.#previewTokens) {
      if (!this.#previews.has(id)) this.#previewTokens.delete(token);
    }
    const expiresAtMs = Math.min(now + PREVIEW_TOKEN_TTL_MS, parseUtcTimestamp(principal.expiresAt));
    if (!(expiresAtMs > now)) throw new StreamOtterError("UNAUTHENTICATED", { message: "The development principal has expired." });
    const expiresAt = new Date(expiresAtMs).toISOString();
    const token = `sop_${randomBytes(32).toString("base64url")}`;
    const previewSessionId = newId();
    this.#previews.set(previewSessionId, { principal: freezePrincipal({ ...principal, expiresAt }), expiresAtMs });
    this.#previewTokens.set(token, previewSessionId);
    return { token, expiresAt, previewSessionId };
  }
}

/** Constructs a gateway without opening connections. */
export function createGatewayRuntime<C extends ChannelMap>(options: GatewayOptions<C>, internal: InternalGatewayOptions = {}): { gateway: Gateway; runtime: GatewayRuntime } {
  const runtime = new GatewayRuntime(options as unknown as GatewayOptions<ChannelMap>, internal);
  const gateway: Gateway = Object.freeze({
    start: () => runtime.start(),
    stop: (stopOptions?: { timeoutMs?: number }) => runtime.stop(stopOptions),
    revoke: (request: Revocation) => runtime.revoke(request),
    resumeSource: async (sourceId: string) => { await runtime.resumeSource(sourceId); }
  });
  internalsRegistry.set(gateway, runtime.internals());
  return { gateway, runtime };
}
