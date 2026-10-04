import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Server as IoServer } from "socket.io";
import {
  MAX_CONFIG_DEPTH, assertValidProjectConfig, canonicalizeParams, canonicalJson, compareRevisions, DEFAULT_STOP_TIMEOUT_MS,
  isJsonValue, isPlainObject, isRevision, MAX_TOKEN_BYTES, parseUtcTimestamp, PREVIEW_TOKEN_TTL_MS,
  resolveLimits, resolveSourcePolicy, STARTUP_DEADLINE_MS, streamError, StreamOtterError, TransientMappingError, utf8ByteLength, validateValue, withoutUndefinedProperties,
  QUARANTINE_ELIGIBLE_CLASSES, type FailureClass, type OperatorApi,
  type ChannelMap, type ChannelSummary, type DevelopmentOptions, type DevelopmentPrincipalSummary,
  type DiagnosticStep, type ErrorCode, type Gateway, type GatewayLogger, type GatewayOptions, type HandlerRegistry, type HealthReason,
  type Json, type Page, type Principal, type ProjectConfig, type Revocation, type Schema, type SourceRecord,
  type SourceStatus, type StreamError, type StreamEvent, type Trace, type ValueIssue
} from "@streamotter/contracts";
import { JOURNAL_FILE, openJournal } from "../failures/journal.ts";
import { KafkaQuarantineReader, KafkaQuarantineWriter, type QuarantineReader, type QuarantineTopicReport } from "../failures/quarantine.ts";
import { FailureService, type AdvanceHooks } from "../failures/service.ts";
import { MemoryIncidentStore, type IncidentStore, type RawEvidence } from "../failures/store.ts";
import { assertFailureHandling, nodeSupportsJournal, usesQuarantine } from "../failures/validate.ts";
import { startOperatorSocket, type OperatorSocket } from "../operator/ipc.ts";
import { OperatorService, type OperatorHooks, type OperatorHost } from "../operator/service.ts";
import { ByteBudget } from "./budget.ts";
import { healthOptionIssues, startHealthListener, type HealthListener } from "./health.ts";
import { Router, routingKey, type ChannelRuntime, type GatewayCore, type SourceRuntime } from "./core.ts";
import {
  freezePrincipal, identityKey, matchesPrincipal, principalProblem, RevocationLog, sourceRecordId, updateEventId
} from "./identity.ts";
import { ClientSession, type SessionOwner } from "./session.ts";
import { FRAME_OVERHEAD_BYTES, type PendingFrame, type ServerSubscription } from "./subscription.ts";
import { TraceBuffer, type TraceQuery } from "./traces.ts";
import { consoleLogger, describeError, invokeHandler, newId, nowIso, Semaphore, sha256Hex } from "./util.ts";
import { FixtureSourceAdapter, type FixtureRecord } from "../sources/fixture.ts";
import { createKafkaSourceAdapter, readCommittedOffset, resolveKafkaConnection, runKafkaDiagnostics, type ResolvedKafkaConnection } from "../sources/kafka.ts";
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
  /** Extra attempts at the whole mapping after a TransientMappingError (V1.1 policy). */
  readonly transientRetries: 0 | 1 | 2;
  boundary: SourceRuntime["boundary"] = null;
  /** Serializes record processing with operator redrive, so a redrive runs at a record boundary (ADR-15C §5). */
  #lock: Promise<unknown> = Promise.resolve();

  constructor(id: string, config: ProjectConfig["sources"][string], transientRetries: 0 | 1 | 2) {
    this.id = id;
    this.config = config;
    this.transientRetries = transientRetries;
  }

  get ready(): boolean {
    return this.status === "healthy";
  }

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(work, work);
    this.#lock = run.catch(() => undefined);
    return run;
  }

  summary(): SourceStatus {
    const status: SourceStatus = { sourceId: this.id, kind: this.config.kind, status: this.status };
    if (this.reason !== undefined && this.status !== "healthy") status.reason = this.reason;
    return status;
  }
}

interface RoutedOutput { channel: ChannelRuntime; key: string; frame: PendingFrame }

/**
 * Why a mapped output was rejected, with its trusted failure class (ADR-15B §1).
 * `message` is the V1 log text; `diagnosis`, when set, replaces it where payload
 * text must not appear (incidents, evaluation and redrive results).
 */
interface OutputProblem { failureClass: FailureClass; message: string; diagnosis?: string }

interface PreviewSession { principal: Principal; expiresAtMs: number }

/** One record decoded, mapped and checked, before admission. */
type Prepared =
  | { kind: "ok"; record: SourceRecord; outputs: RoutedOutput[] }
  | { kind: "problem"; stage: "validate" | "map" | "queue"; code: ErrorCode; failureClass: FailureClass; reason: string; channel: string | null; logReason?: string }
  | { kind: "abandon" };

/** An evaluation as the operator service sees it: metadata only, never the frames themselves. */
export type OperatorPrepared =
  | { kind: "ok"; outputs: { channel: string; channelVersion: number; revision: string }[]; outputHash: string }
  | { kind: "problem"; stage: "validate" | "map" | "queue"; code: ErrorCode; failureClass: FailureClass; reason: string; channel: string | null }
  | { kind: "abandon" };

export type RedriveOutcome =
  | Exclude<OperatorPrepared, { kind: "ok" }>
  | { kind: "changed"; evaluation: Extract<OperatorPrepared, { kind: "ok" }> }
  | { kind: "admitted"; evaluation: Extract<OperatorPrepared, { kind: "ok" }>; counts: Record<"queued" | "filtered" | "inactive" | "overflow", number> };

function describePrepared(prepared: Prepared): OperatorPrepared {
  if (prepared.kind === "problem") {
    const { logReason: _logReason, ...problem } = prepared;
    return problem;
  }
  if (prepared.kind !== "ok") return prepared;
  const outputs = prepared.outputs.map(output => ({ channel: output.channel.name, channelVersion: output.channel.version, revision: output.frame.revision }));
  // The canonical mapped-output hash of the plan fingerprint (ADR-15C §5): routing key, revision and data hash of every output, in order.
  const outputHash = `sha256:${sha256Hex(prepared.outputs.map(output => [output.key, output.frame.revision, output.frame.dataHash]))}`;
  return { kind: "ok", outputs, outputHash };
}

/**
 * A map handler's error as an incident may show it: the error's name and, when
 * present, its code. Never the message, which can quote record data (a
 * JSON.parse SyntaxError quotes its input).
 */
function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return `a non-Error ${typeof error}`;
  const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : null;
  const name = token(error.name) ?? "Error";
  const code = token((error as { code?: unknown }).code);
  return code === null ? name : `${name} (code ${code})`;
}

/**
 * A value issue for an incident diagnosis. Paths name schema properties and
 * array indexes, except for a property the schema doesn't allow, whose name
 * comes from the mapped data, so that path is left out.
 */
function issueDiagnosis(prefix: string, issue: ValueIssue): string {
  return issue.message === "Property is not allowed." ? `${prefix}: a property is not allowed by the schema` : `${prefix} ${issue.path}: ${issue.message}`;
}

/** A source input rebuilt from stored original bytes, decoded the way the Kafka adapter decodes a key. */
function storedInput(raw: RawEvidence, position: SourceRecord["position"]): SourceInput {
  return {
    key: raw.key === null ? null : Buffer.from(raw.key).toString("utf8"),
    bytes: raw.value,
    keyBytes: raw.key,
    headers: raw.headers,
    position
  };
}

/** Waits before re-running a mapping that threw TransientMappingError (spec §6). */
const TRANSIENT_RETRY_DELAYS_MS = [250, 1_000] as const;

function abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(true); }, ms);
    const onAbort = () => { clearTimeout(timer); resolve(false); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Test-only instrumentation; not reachable through the public createGateway(). */
export interface InternalGatewayOptions {
  /** Awaited after a Kafka record is processed and before its offset is committed. */
  beforeCommit?: (sourceId: string, position: SourceRecord["position"]) => Promise<void>;
  /** Replaces the incident store the gateway would open, to inject faults. */
  incidentStore?: IncidentStore;
  /** Crash points around a guarded advance (slice C crash tests). */
  advanceHooks?: AdvanceHooks;
  /** Crash and lost-response points around operator operations (slice D tests). */
  operatorHooks?: OperatorHooks;
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
  /** The source-failure incident store while the gateway runs with failureHandling; null otherwise. */
  incidentStore(): IncidentStore | null;
  /** Resolves when queued failure dispositions (journal, quarantine writes) have finished. */
  failuresSettled(): Promise<void>;
  /** The operator service (ADR-15C §1) while the gateway runs with failureHandling; null otherwise. */
  operator(): OperatorApi | null;
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
      const keyOk = isPlainObject(record) && (record["key"] === null || typeof record["key"] === "string");
      const valueOk = isPlainObject(record) && (Object.hasOwn(record, "raw")
        ? typeof record["raw"] === "string" && !Object.hasOwn(record, "value")
        : isJsonValue(record["value"]));
      if (!keyOk || !valueOk) {
        issues.push(`development.fixtures.${source.fixtureRef}[${index}] must be {key: string | null, value: JSON} or {key: string | null, raw: string}`);
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
  readonly #stateDirectory: string | undefined;
  readonly #handlerBuildId: string;
  readonly #operatorSocketEnabled: boolean;
  #operatorSocket: OperatorSocket | null = null;
  readonly #healthOptions: { host: string; port: number } | null;
  #health: HealthListener | null = null;
  #failures: FailureService | null = null;
  #operator: OperatorService | null = null;
  #quarantineReport: QuarantineTopicReport | null = null;
  #quarantineReader: QuarantineReader | null = null;
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
  /** Fails an in-flight start so stop() can roll it back instead of waiting for it. */
  #cancelStart: ((error: StreamOtterError) => void) | null = null;
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
    assertFailureHandling(config, options.handlers, options);
    const healthIssues = healthOptionIssues(options.health);
    if (healthIssues.length > 0) {
      throw new StreamOtterError("CONFIG_INVALID", { message: `Invalid health listener: ${healthIssues.join("; ")}.`, details: { issues: healthIssues } });
    }
    if (options.mode === "production") validateProduction(config, options);
    else validateDevelopment(config, options.development);

    this.config = config;
    this.mode = options.mode;
    this.fingerprint = sha256Hex(config, MAX_CONFIG_DEPTH);
    this.#handlers = options.handlers;
    this.#development = options.development;
    this.#configDir = options.configDir ?? process.cwd();
    this.#stateDirectory = options.stateDirectory;
    this.#handlerBuildId = options.handlerBuildId ?? "unspecified";
    this.#operatorSocketEnabled = options.operatorSocket === true;
    this.#healthOptions = options.health === undefined ? null : { host: options.health.host ?? "127.0.0.1", port: options.health.port };
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
      gatewayBudget: new ByteBudget(limits.maxPendingBytesGateway),
      boundaryAcknowledged: (sourceId, boundaryId) => { this.#failures?.acknowledged(sourceId, boundaryId); }
    };
    for (const [id, source] of Object.entries(config.sources)) {
      const retries = config.failureHandling === undefined ? 0 : resolveSourcePolicy(config.failureHandling, id).transientMapperRetries;
      this.#sources.set(id, new SourceRuntimeImpl(id, source, retries));
    }
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
    // With failure handling, a resume is a retry of the held record and is refused while an advance is unresolved (ADR-15C §6).
    await this.#failures?.beforeRetry(sourceId, "operator retry of the held record");
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
      return { ok: true, value: { principal, previewSessionId, revocationSeq } };
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
    // A revocation can land after authentication finished but before socket.io opened the connection,
    // when the session is not yet in #sessions and revoke() can't see it.
    else if (this.core.revocations.revokedSince(result.revocationSeq, result.principal)) {
      queueMicrotask(() => session.close(streamError("UNAUTHENTICATED", { message: "Access was revoked; authenticate again.", retryable: false, requestId: newId() })));
    }
    return session;
  }

  // --- record pipeline -------------------------------------------------------------

  #sink(source: SourceRuntimeImpl): SourceSink {
    return {
      process: input => source.exclusive(() => this.#process(source, input)),
      setStatus: (status, reason) => this.#setSourceStatus(source, status, reason),
      held: (input, outcome) => { void this.#failures?.held(source, input, outcome); },
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
    const { traces } = this.core;
    const trace = (stage: Trace["stage"], outcome: Trace["outcome"], extra: Partial<Pick<Trace, "channel" | "subscriptionId" | "errorCode">> = {}) =>
      traces.record({ requestId, stage, outcome, sourceId: source.id, ...extra });
    // The operator log keeps V1's reason text; the incident gets the sanitized diagnosis.
    const pause = (stage: "validate" | "map" | "queue", code: ErrorCode, failureClass: FailureClass, diagnosis: string, channel: string | null, logReason: string): ProcessOutcome => {
      trace(stage, stage === "map" ? "failed" : "rejected", channel === null ? { errorCode: code } : { errorCode: code, channel });
      this.core.logger.warn("Source paused on an unprocessable record; it will not be committed or skipped", {
        sourceId: source.id,
        position: input.position as unknown as Json,
        code,
        failureClass,
        reason: logReason,
        ...(channel === null ? {} : { channel })
      });
      this.#setSourceStatus(source, "paused", code);
      return { kind: "pause", code, failureClass, stage, channel, diagnosis: diagnosis.slice(0, 512) };
    };
    trace("source", "ok");

    const moved = this.#failures?.positionProblem(source.id, input.position) ?? null;
    if (moved !== null) {
      trace("source", "rejected", { errorCode: "SOURCE_UNAVAILABLE" });
      this.core.logger.error("Source progress moved past a held record without a recorded advance; the source is held", {
        sourceId: source.id, position: input.position as unknown as Json, reason: moved
      });
      this.#setSourceStatus(source, "paused", "SOURCE_UNAVAILABLE");
      return { kind: "hold", code: "SOURCE_UNAVAILABLE", reason: moved };
    }

    const prepared = await this.#prepare(source, input, { requestId, trace, retries: source.transientRetries });
    if (prepared.kind === "abandon") return { kind: "abandon" };
    if (prepared.kind === "problem") {
      return pause(prepared.stage, prepared.code, prepared.failureClass, prepared.reason, prepared.channel, prepared.logReason ?? prepared.reason);
    }
    this.#admit(prepared.outputs, requestId);
    return { kind: "commit" };
  }

  /**
   * Decodes, maps and validates one record for every channel of its source, and
   * checks the outputs against current subscriber state, without admitting
   * anything. Shared by live processing, evaluation and redrive (ADR-15C §5), so
   * all three apply the same rules. Records traces only through `trace`.
   */
  async #prepare(source: SourceRuntimeImpl, input: SourceInput, options: {
    requestId: string;
    trace: (stage: Trace["stage"], outcome: Trace["outcome"], extra?: Partial<Pick<Trace, "channel" | "subscriptionId" | "errorCode">>) => void;
    retries: 0 | 1 | 2;
  }): Promise<Prepared> {
    const { limits } = this.core;
    const { requestId, trace } = options;
    type Problem = Extract<Prepared, { kind: "problem" }>;
    const problem = (stage: "validate" | "map" | "queue", code: ErrorCode, failureClass: FailureClass, reason: string, channel?: string, logReason?: string): Problem =>
      ({ kind: "problem", stage, code, failureClass, reason, channel: channel ?? null, ...(logReason === undefined || logReason === reason ? {} : { logReason }) });
    let value: Json;
    if (input.value !== undefined) {
      if (!isJsonValue(input.value)) return problem("validate", "INVALID_PAYLOAD", "invalid-json", "fixture value is not JSON data");
      if (utf8ByteLength(JSON.stringify(input.value)) > limits.maxSourceRecordBytes) {
        return problem("validate", "INVALID_PAYLOAD", "oversize", "record exceeds maxSourceRecordBytes");
      }
      value = input.value;
    } else {
      const bytes = input.bytes ?? null;
      if (bytes === null) return problem("validate", "INVALID_PAYLOAD", "tombstone", "tombstone records have no V1 meaning; represent deletion as explicit state");
      if (bytes.byteLength > limits.maxSourceRecordBytes) return problem("validate", "INVALID_PAYLOAD", "oversize", "record exceeds maxSourceRecordBytes");
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Json;
      } catch {
        return problem("validate", "INVALID_PAYLOAD", "invalid-json", "record value is not valid UTF-8 JSON");
      }
      if (!isJsonValue(value)) return problem("validate", "INVALID_PAYLOAD", "invalid-json", "record value exceeds the nesting limit");
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
    // A TransientMappingError re-runs the whole mapping, up to the source's retry budget.
    // With failure handling configured, a quarantine-eligible problem does not end the
    // evaluation: every remaining output, channel and the conflict check still run, and
    // any other problem found outranks it, so a quarantine policy never advances past an
    // integrity or mapper failure (INV-03, ADR-15B §1). Without failureHandling the first
    // problem is reported, as in V1.
    const classifyAll = this.config.failureHandling !== undefined;
    const outputs: RoutedOutput[] = [];
    let eligible: Problem | null = null;
    attempts: for (let attempt = 0; ; attempt++) {
      outputs.length = 0;
      eligible = null;
      for (const channel of source.channels) {
        const outcome = await invokeHandler(
          context => channel.handlers.map({ ...context, record }),
          { timeoutMs: limits.handlerTimeoutMs, requestId, parent: this.#stopController.signal }
        );
        if (outcome.kind === "aborted" || this.#halting()) return { kind: "abandon" };
        if (outcome.kind === "timeout") return problem("map", "TIMEOUT", "mapper-timeout", "map handler timed out", channel.name);
        if (outcome.kind === "error") {
          const transient = TransientMappingError.is(outcome.error);
          if (transient && attempt < options.retries) {
            trace("map", "failed", { channel: channel.name, errorCode: "HANDLER_FAILED" });
            this.core.logger.info("Retrying a transient mapping failure", { sourceId: source.id, channel: channel.name, attempt: attempt + 1 });
            if (!await abortableDelay(TRANSIENT_RETRY_DELAYS_MS[attempt] ?? 1_000, this.#stopController.signal) || this.#halting()) {
              return { kind: "abandon" };
            }
            await input.heartbeat?.().catch(() => undefined);
            continue attempts;
          }
          const failureClass = transient ? "mapper-transient" : "mapper-error";
          return problem("map", "HANDLER_FAILED", failureClass, `map handler threw ${errorSummary(outcome.error)}`, channel.name,
            `map handler threw ${JSON.stringify(describeError(outcome.error))}`);
        }
        const mapped: unknown = outcome.value;
        if (!Array.isArray(mapped)) return problem("map", "INVALID_PAYLOAD", "routing-invalid", "map must return an array", channel.name);
        if (mapped.length > limits.maxMapOutputs) return problem("map", "INVALID_PAYLOAD", "routing-invalid", `map returned more than ${limits.maxMapOutputs} outputs`, channel.name);
        let failed = false;
        for (let index = 0; index < mapped.length; index++) {
          const built = this.#buildOutput(channel, record, mapped[index]);
          if ("failureClass" in built) {
            const found = problem("map", "INVALID_PAYLOAD", built.failureClass, `output ${index}: ${built.diagnosis ?? built.message}`, channel.name, `output ${index}: ${built.message}`);
            if (!classifyAll || !QUARANTINE_ELIGIBLE_CLASSES.includes(built.failureClass)) return found;
            eligible ??= found;
            failed = true;
            continue;
          }
          outputs.push(built);
        }
        if (!failed) trace("map", mapped.length === 0 ? "filtered" : "ok", { channel: channel.name });
      }
      break;
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
      if (conflicting) return problem("queue", "REVISION_CONFLICT", "revision-conflict", "the same revision was mapped to different data", output.channel.name);
      if (earlier === undefined || compareRevisions(revision, earlier.revision) > 0) seen.set(output.key, { revision, dataHash });
    }
    return eligible ?? { kind: "ok", record, outputs };
  }

  /** Admits validated outputs to every capturing subscription; the revision filter drops anything at or below a subscriber's state. */
  #admit(outputs: readonly RoutedOutput[], requestId: string): Record<"queued" | "filtered" | "inactive" | "overflow", number> {
    const counts = { queued: 0, filtered: 0, inactive: 0, overflow: 0 };
    for (const output of outputs) {
      const subscriptions = this.core.router.get(output.key);
      if (subscriptions === undefined) continue;
      for (const subscription of [...subscriptions] as ServerSubscription[]) counts[subscription.admit(output.frame, requestId)]++;
    }
    return counts;
  }

  // --- operator evaluation and redrive (ADR-15C §5) --------------------------------

  /**
   * Runs stored original bytes through the live decode, map and validate path
   * without admitting anything, committing, seeking or recording traces (spec
   * §8.2, F31). Transient mapping errors are not retried.
   */
  async evaluateRecord(sourceId: string, raw: RawEvidence, position: SourceRecord["position"]): Promise<OperatorPrepared> {
    const source = this.#sources.get(sourceId);
    if (source === undefined) throw notFound(`Unknown source "${sourceId}".`);
    const prepared = await this.#prepare(source, storedInput(raw, position), { requestId: newId(), trace: () => undefined, retries: 0 });
    return describePrepared(prepared);
  }

  /**
   * Re-evaluates stored original bytes at a record boundary of the source and,
   * only if the mapped outputs still hash to what the approved plan saw, admits
   * them through the normal revision filter (ADR-15C §5, F33). Never commits,
   * seeks or publishes. Traces are recorded under one request ID.
   */
  async redriveRecord(sourceId: string, raw: RawEvidence, position: SourceRecord["position"], expectedOutputHash: string): Promise<RedriveOutcome> {
    const source = this.#sources.get(sourceId);
    if (source === undefined) throw notFound(`Unknown source "${sourceId}".`);
    if (this.#state !== "running") return { kind: "abandon" };
    return source.exclusive(async () => {
      if (this.#halting()) return { kind: "abandon" } as const;
      const requestId = newId();
      const trace = (stage: Trace["stage"], outcome: Trace["outcome"], extra: Partial<Pick<Trace, "channel" | "subscriptionId" | "errorCode">> = {}) =>
        this.core.traces.record({ requestId, stage, outcome, sourceId, ...extra });
      trace("source", "ok");
      const prepared = await this.#prepare(source, storedInput(raw, position), { requestId, trace, retries: 0 });
      const described = describePrepared(prepared);
      if (described.kind !== "ok") {
        if (described.kind === "problem") trace(described.stage, described.stage === "map" ? "failed" : "rejected", { errorCode: described.code });
        return described;
      }
      if (described.outputHash !== expectedOutputHash) return { kind: "changed", evaluation: described } as const;
      const counts = this.#admit((prepared as Extract<Prepared, { kind: "ok" }>).outputs, requestId);
      return { kind: "admitted", evaluation: described, counts } as const;
    });
  }

  /**
   * Builds one routed output. Routing checks (shape, tenant, params, revision,
   * frame size) run before the payload schema, so only a payload that fails its
   * declared schema after valid routing is classified payload-schema; everything
   * else is an integrity failure that a quarantine policy can never skip.
   */
  #buildOutput(channel: ChannelRuntime, record: SourceRecord, item: unknown): RoutedOutput | OutputProblem {
    const routing = (message: string): OutputProblem => ({ failureClass: "routing-invalid", message });
    if (!isPlainObject(item)) return routing("must be an object");
    for (const key of Object.keys(item)) {
      if (key !== "tenantId" && key !== "params" && key !== "revision" && key !== "data") {
        return { ...routing(`unexpected field "${key}"`), diagnosis: "unexpected field" };
      }
    }
    const { tenantId, params, revision } = item;
    const data = withoutUndefinedProperties(item["data"]);
    if (typeof tenantId !== "string" || tenantId.length === 0 || tenantId.length > 512) return routing("tenantId must be a non-empty string");
    const canonical = canonicalizeParams(channel.paramsSchema, params);
    if (!canonical.ok) return { ...routing(`params ${canonical.issue.path}: ${canonical.issue.message}`), diagnosis: issueDiagnosis("params", canonical.issue) };
    if (!isRevision(revision)) return routing("revision must be a canonical unsigned decimal string");
    if (!isJsonValue(data)) return routing("data must be JSON");
    const event: StreamEvent = {
      id: updateEventId(record.id, channel.name, channel.version, tenantId, canonical.canonical, revision),
      channel: channel.name,
      channelVersion: channel.version,
      kind: "update",
      data,
      revision,
      receivedAt: record.receivedAt
    };
    // Checked before the payload schema: an oversized frame is an integrity failure, never payload-schema.
    const bytes = Buffer.byteLength(JSON.stringify(event)) + FRAME_OVERHEAD_BYTES;
    if (bytes > this.core.limits.maxDataFrameBytes) return routing("the data frame exceeds maxDataFrameBytes");
    const issue = validateValue(channel.payloadSchema, data);
    if (issue !== null) return { failureClass: "payload-schema", message: `data ${issue.path}: ${issue.message}`, diagnosis: issueDiagnosis("data", issue) };
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

  #committed(source: SourceRuntimeImpl, position: SourceRecord["position"]): void {
    this.recordCommit(source.id);
    this.#failures?.committed(source.id, position);
  }

  /**
   * Opens the incident store and, when a Kafka source can quarantine, checks the
   * quarantine topic and connects its producer. Any refusal fails startup.
   */
  async #startFailures(connections: Map<string, ResolvedKafkaConnection>): Promise<void> {
    const store: IncidentStore = this.#internal.incidentStore ?? (this.#stateDirectory === undefined
      ? new MemoryIncidentStore()
      : openJournal(this.#stateDirectory, { projectId: this.config.projectId }));
    try {
      store.claim(this.config.projectId, [...this.#sources.values()].map(source => ({
        sourceId: source.id, generation: source.config.generation, kind: source.config.kind
      })));
    } catch (error) {
      store.close();
      throw error;
    }
    if (store.kind === "memory") {
      this.core.logger.warn("Source-failure incidents are kept in memory only; set stateDirectory to keep them across restarts", {});
    }
    let quarantine: KafkaQuarantineWriter | null = null;
    try {
      const quarantined = [...this.#sources.values()].filter(source => source.config.kind === "kafka" && usesQuarantine(this.config, source.id));
      const first = quarantined[0]?.config;
      const topic = this.config.failureHandling?.quarantine?.topic;
      if (first?.kind === "kafka" && topic !== undefined) {
        quarantine = new KafkaQuarantineWriter({
          topic,
          connection: connections.get(first.connectionRef) as ResolvedKafkaConnection,
          logger: this.core.logger,
          maxSourceRecordBytes: this.core.limits.maxSourceRecordBytes,
          clientId: `streamotter-${this.config.projectId}-quarantine`
        });
        const report = await quarantine.start();
        this.#quarantineReport = report;
        this.core.logger.info("Quarantine topic checked", { ...report });
        // Connects only when an operator reads evidence back; consumer groups are <clientId>-quarantine-read-<uuid>.
        this.#quarantineReader = new KafkaQuarantineReader({
          topic,
          connection: connections.get(first.connectionRef) as ResolvedKafkaConnection,
          logger: this.core.logger,
          maxSourceRecordBytes: this.core.limits.maxSourceRecordBytes,
          clientId: `streamotter-${this.config.projectId}`
        });
      }
      const failures = new FailureService({
        config: this.config,
        store,
        logger: this.core.logger,
        quarantine,
        configFingerprint: this.fingerprint,
        handlerBuildId: this.#handlerBuildId,
        maxSourceRecordBytes: this.core.limits.maxSourceRecordBytes,
        guards: this.#handlers.sources ?? {},
        onBoundary: (sourceId, boundary) => {
          const source = this.#sources.get(sourceId);
          if (source !== undefined) source.boundary = boundary === null ? null : Object.freeze({ id: boundary.id, context: boundary.context });
        },
        stopSignal: this.#stopController.signal,
        ...(this.#internal.advanceHooks === undefined ? {} : { hooks: this.#internal.advanceHooks })
      });
      const clusterId = quarantine?.report?.clusterId;
      if (clusterId !== undefined) for (const source of quarantined) failures.setClusterId(source.id, clusterId);
      await failures.start(this.#sources.values(), async (source, topic, partition) => {
        if (source.config.kind !== "kafka") return null;
        return readCommittedOffset(connections.get(source.config.connectionRef) as ResolvedKafkaConnection,
          `streamotter-${this.config.projectId}-reconcile`, source.config.consumerGroup, topic, partition, this.core.logger);
      });
      this.#failures = failures;
      this.#operator = new OperatorService(this.#operatorHost(), failures, this.#internal.operatorHooks);
    } catch (error) {
      await this.#quarantineReader?.stop().catch(() => undefined);
      this.#quarantineReader = null;
      await quarantine?.stop().catch(() => undefined);
      store.close();
      throw error;
    }
  }

  /**
   * Spec §14 and F48: removing failureHandling must not silently drop the
   * obligations a journal still holds. When stateDirectory points at a journal
   * with an open incident or a recovery boundary in force for a configured
   * source, startup is refused until they are resolved or retired with failure
   * handling still configured. A boundary from a generation other than the
   * configured one doesn't count: a generation change always retires it (ADR-15B
   * §4), as the journal does when failure handling claims it again. A journal
   * with nothing outstanding is left alone.
   */
  #refuseAbandonedJournal(): void {
    if (this.#stateDirectory === undefined || !existsSync(join(this.#stateDirectory, JOURNAL_FILE))) return;
    const refuse = (message: string, details: Record<string, Json>) => new StreamOtterError("CONFIG_INVALID", {
      message: `${message} Restore the failureHandling section, resolve the incidents and retire the boundaries, then remove it (see the V1.1 downgrade notes).`,
      details: { reason: "failure-handling-removed", ...details }
    });
    if (!nodeSupportsJournal()) throw refuse("The state directory holds a failure journal that this Node version cannot read, and failureHandling is not configured.", {});
    const store = openJournal(this.#stateDirectory, { projectId: this.config.projectId });
    try {
      const openIncidents: string[] = [];
      const boundaries: string[] = [];
      for (const [sourceId, source] of this.#sources) {
        if (store.open(sourceId).length > 0) openIncidents.push(sourceId);
        const boundary = store.boundary(sourceId);
        if (boundary !== null && boundary.generation === source.config.generation) boundaries.push(sourceId);
      }
      if (openIncidents.length > 0 || boundaries.length > 0) {
        throw refuse(
          `failureHandling was removed, but the failure journal still has ${openIncidents.length > 0 ? `open incidents on ${openIncidents.join(", ")}` : ""}${openIncidents.length > 0 && boundaries.length > 0 ? " and " : ""}${boundaries.length > 0 ? `recovery boundaries in force on ${boundaries.join(", ")}` : ""}.`,
          { openIncidentSources: openIncidents, boundarySources: boundaries }
        );
      }
    } finally {
      store.close();
    }
  }

  /** Readiness reason categories (ADR-15C §4); empty means ready. */
  #readiness(): HealthReason[] {
    if (this.#state !== "running") return ["starting"];
    const reasons: HealthReason[] = [];
    for (const source of this.#sources.values()) {
      if (source.status === "paused") reasons.push("source-held");
      else if (source.status !== "healthy") reasons.push("source-unavailable");
    }
    const failures = this.#failures;
    if (failures !== null) {
      const usage = failures.store.usage();
      if (failures.journalError !== null || usage.sizeBytes >= usage.limitBytes) reasons.push("journal");
      for (const source of this.#sources.values()) {
        if (failures.store.open(source.id).some(incident => incident.quarantine === "failed" || incident.quarantine === "unknown")) reasons.push("quarantine");
      }
    }
    return reasons;
  }

  #operatorHost(): OperatorHost {
    return {
      mode: this.mode,
      config: this.config,
      fingerprint: this.fingerprint,
      handlerBuildId: this.#handlerBuildId,
      logger: this.core.logger,
      state: () => this.#state,
      source: sourceId => this.#sources.get(sourceId)?.summary() ?? null,
      traces: query => this.core.traces.page(query),
      quarantineReport: () => this.#quarantineReport,
      quarantineReader: () => this.#quarantineReader,
      retry: async sourceId => { await this.resumeSource(sourceId); },
      evaluateRecord: (sourceId, raw, position) => this.evaluateRecord(sourceId, raw, position),
      redriveRecord: (sourceId, raw, position, hash) => this.redriveRecord(sourceId, raw, position, hash),
      setBoundary: (sourceId, boundary) => {
        const source = this.#sources.get(sourceId);
        if (source !== undefined) source.boundary = boundary === null ? null : Object.freeze({ id: boundary.id, context: boundary.context });
      }
    };
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
      // First, so readiness reports "starting" for the whole startup.
      if (this.#healthOptions !== null) {
        const { host, port } = this.#healthOptions;
        this.#health = await startHealthListener({ host, port, readiness: () => this.#readiness() }).catch((error: unknown) => {
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          throw new StreamOtterError("SOURCE_UNAVAILABLE", {
            message: code === "EADDRINUSE" ? `Health port ${host}:${port} is already in use.` : `The health listener could not start on ${host}:${port}: ${(error as Error | undefined)?.message ?? String(error)}`
          });
        });
        this.core.logger.info("Health listener started", { origin: this.#health.origin });
      }
      const connections = new Map<string, ResolvedKafkaConnection>();
      for (const source of this.#sources.values()) {
        if (source.config.kind !== "kafka" || connections.has(source.config.connectionRef)) continue;
        const profile = this.config.connections[source.config.connectionRef];
        if (profile === undefined) throw new StreamOtterError("CONFIG_INVALID", { message: `Unknown connection profile ${source.config.connectionRef}.` });
        connections.set(source.config.connectionRef, await resolveKafkaConnection(profile, this.#configDir));
      }
      if (this.config.failureHandling !== undefined) await this.#startFailures(connections);
      else this.#refuseAbandonedJournal();

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
            position => this.#committed(source, position)
          )
          : createKafkaSourceAdapter({
            projectId: this.config.projectId,
            sourceId: source.id,
            source: source.config,
            connection: connections.get(source.config.connectionRef) as ResolvedKafkaConnection,
            sink: this.#sink(source),
            onCommit: position => this.#committed(source, position),
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
          this.#cancelStart = reject;
        })
      ]).finally(() => {
        clearTimeout(timer);
        this.#cancelStart = null;
      });

      // The validator guarantees stateDirectory and failureHandling, so the operator exists here.
      if (this.#operatorSocketEnabled && this.#operator !== null && this.#stateDirectory !== undefined) {
        this.#operatorSocket = await startOperatorSocket({ stateDirectory: this.#stateDirectory, operator: this.#operator, logger: this.core.logger });
        this.core.logger.info("Operator socket listening", { path: this.#operatorSocket.path });
      }

      const address = http.address() as AddressInfo;
      const host = this.config.gateway.host === "0.0.0.0" || this.config.gateway.host === "::" ? "127.0.0.1" : this.config.gateway.host;
      this.#http = http;
      this.#io = io;
      this.#address = { origin: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`, path: this.config.gateway.path };
      this.#state = "running";
      this.core.logger.info("Gateway started", { origin: this.#address.origin, path: this.#address.path, mode: this.mode });
      return this.#address;
    } catch (error) {
      await this.#operatorSocket?.close().catch(() => undefined);
      this.#operatorSocket = null;
      await this.#health?.close().catch(() => undefined);
      this.#health = null;
      await Promise.allSettled(started.map(adapter => adapter.stop(Date.now() + 5_000)));
      await this.#failures?.stop().catch(() => undefined);
      await this.#quarantineReader?.stop().catch(() => undefined);
      this.#quarantineReader = null;
      this.#failures = null;
      this.#operator = null;
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
    const deadline = Date.now() + timeoutMs;
    if (this.#starting !== null) {
      // Roll back a start in progress rather than wait out its 30-second deadline.
      this.#cancelStart?.(new StreamOtterError("SOURCE_UNAVAILABLE", { message: "The gateway was stopped while starting." }));
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.#starting.catch(() => undefined),
        new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })
      ]).finally(() => clearTimeout(timer));
    }
    const wasRunning = this.#state === "running";
    this.#state = "stopping";
    this.#stopController.abort();
    for (const session of [...this.#sessions]) session.close();
    const work = (async () => {
      // Readiness ends first, so a load balancer stops routing before sessions close.
      await this.#health?.close().catch(() => undefined);
      this.#health = null;
      // Close the operator socket first so no mutation starts while sources drain.
      await this.#operatorSocket?.close().catch(error => {
        this.core.logger.error("The operator socket did not close cleanly", { error: (error as Error).message.slice(0, 200) });
      });
      this.#operatorSocket = null;
      await Promise.allSettled([...this.#sources.values()].map(async source => {
        await source.adapter?.stop(deadline);
        source.status = "stopped";
      }));
      await this.#failures?.stop().catch(error => {
        this.core.logger.error("The failure journal did not close cleanly", { error: (error as Error).message.slice(0, 200) });
      });
      await this.#quarantineReader?.stop().catch(() => undefined);
      await Promise.allSettled(this.#stopCallbacks.map(callback => callback()));
      const io = this.#io;
      if (io !== null) await new Promise<void>(resolve => io.close(() => resolve()));
    })();
    let timer: NodeJS.Timeout | undefined;
    const expired = await Promise.race([
      work.then(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), Math.max(0, deadline - Date.now())); })
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
      pendingBytes: () => this.core.gatewayBudget.used,
      incidentStore: () => this.#failures?.store ?? null,
      failuresSettled: async () => { await this.#failures?.settled(); },
      operator: () => this.#operator
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
