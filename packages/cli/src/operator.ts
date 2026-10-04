import { lstat, open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  operationExitCode, StreamOtterError, toStreamError, validateOperatorRequest,
  type EvaluationResult, type IncidentDetail, type IncidentSummary, type OperationResult, type OperatorOperation, type OperatorStatus,
  type Page, type RawEvidenceView, type ReproductionBundle
} from "@streamotter/contracts";
import { callOperator } from "@streamotter/gateway/operator";
import type { CliIO } from "./cli.ts";

/**
 * The operator command groups (API §10): `status`, `failures …` and `sources …`,
 * each one request over the local operator socket of a running gateway.
 *
 * Exit codes: 0 ok, 1 runtime (gateway unreachable, operator error, failed),
 * 2 invalid usage or INVALID_REQUEST, 3 refused, 4 unknown outcome (D7).
 *
 * Everything printed in human form passes through `clean`, so text that came
 * from a record (header names, diagnoses) can never carry terminal control
 * sequences. Raw evidence is only ever shown as base64 and hex (F39).
 */

const OK = 0;
const RUNTIME = 1;
const INVALID = 2;
const UNKNOWN = 4;

/** The operations that change something; when their answer is lost, the outcome is unknown, not failed. */
const MUTATIONS: ReadonlySet<OperatorOperation> = new Set(["retryCurrent", "reassess", "reopenCircuit", "retireBoundary", "redrive"]);
/** `details.reason` the operator client puts on an error raised after the request was sent but before an answer arrived. */
const NO_ANSWER = "no-answer";

export const OPERATOR_USAGE = `  streamotter status --state-dir <dir> [--json]
  streamotter failures list --state-dir <dir> [--source <id>] [--state open|resolved|all] [--limit <n>] [--cursor <c>] [--json]
  streamotter failures show --state-dir <dir> --failure <id> [--raw] [--json]
  streamotter failures export --state-dir <dir> --failure <id> [--include-raw] [--out <file>] [--json]
  streamotter failures evaluate --state-dir <dir> --failure <id> --expected-revision <n> [--json]
  streamotter failures redrive --state-dir <dir> --failure <id> --plan <planId> --plan-fingerprint <fp> --expected-revision <n> [--operation-id <id>] [--json]
  streamotter sources retry-current --state-dir <dir> --source <id> --failure <id> --expected-revision <n> [--reason <text>] [--json]
  streamotter sources reassess --state-dir <dir> --source <id> --failure <id> --expected-revision <n> [--json]
  streamotter sources reopen-circuit --state-dir <dir> --source <id> --expected-circuit-revision <n> --reason <text> [--json]
  streamotter sources retire-boundary --state-dir <dir> --source <id> --boundary <id> --expected-revision <n> --reason <text> --confirm <boundaryId> [--json]
    (unsafe: retiring a boundary asserts that every future snapshot already reflects the quarantined record; see the warning it prints)
  streamotter sources rebaseline --config <path> --state-dir <dir> --source <id> --reason <text> --confirm <sourceId> [--json]
    (run with the gateway stopped, after changing the source's generation: closes the incidents of earlier generations)`;

/** ADR-15B §4: printed before every retire-boundary, which then requires --confirm. */
export const RETIREMENT_WARNING = [
  "WARNING: retiring a boundary tells the gateway that every future snapshot already reflects the",
  "quarantined record. StreamOtter cannot check that. If the claim is wrong, subscribers can reach",
  "live while showing state that is missing the change the quarantined record carried, and nothing",
  "downstream will flag it. Retire a boundary only when you have verified the claim yourself, and",
  "say what you checked in --reason."
].join("\n");

class UsageError extends Error {}

type Values = Record<string, unknown>;

interface Command {
  op: OperatorOperation;
  flags: readonly string[];
  build(values: Values): Record<string, unknown>;
  render(io: CliIO, data: unknown, values: Values, json: boolean): Promise<number> | number;
}

const COMMON = ["state-dir", "json"];

// --- argument helpers --------------------------------------------------------------------

function text(values: Values, name: string, required: true): string;
function text(values: Values, name: string, required: false): string | undefined;
function text(values: Values, name: string, required: boolean): string | undefined {
  const value = values[name];
  if (typeof value === "string" && value !== "") return value;
  if (required) throw new UsageError(`--${name} is required.`);
  return undefined;
}

function integer(values: Values, name: string, required: boolean): number | undefined {
  const value = required ? text(values, name, true) : text(values, name, false);
  if (value === undefined) return undefined;
  if (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new UsageError(`--${name} must be a non-negative integer.`);
  return Number(value);
}

/** Drops undefined fields, so optional flags that were not given are not sent. */
function defined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

// --- output helpers ----------------------------------------------------------------------

/** Control characters, C1 introducers, and bidirectional overrides that could rewrite or disguise terminal output. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;
/** The same, minus C0 controls, which JSON.stringify already escapes. */
const UNSAFE_JSON = /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

function escape(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/** One line of text for a terminal: every control or direction character is shown as an escape, never interpreted. */
function clean(value: unknown): string {
  return String(value).replace(UNSAFE_TEXT, escape);
}

/** JSON for stdout: the same value, with characters a terminal could act on written as \u escapes. */
function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(UNSAFE_JSON, escape);
}

function hexPreview(bytes: Buffer, limit = 64): string {
  const shown = bytes.subarray(0, limit).toString("hex").replace(/(..)(?!$)/g, "$1 ");
  return bytes.length > limit ? `${shown} … (${bytes.length - limit} more bytes)` : shown;
}

function rawBytes(io: CliIO, label: string, base64: string | null): void {
  if (base64 === null) {
    io.out(`  ${label}: none`);
    return;
  }
  const bytes = Buffer.from(base64, "base64");
  io.out(`  ${label}: ${bytes.length} bytes`);
  io.out(`    base64  ${base64.replace(/[^A-Za-z0-9+/=]/g, "")}`);
  io.out(`    hex     ${hexPreview(bytes)}`);
}

function renderRaw(io: CliIO, raw: RawEvidenceView): void {
  io.out("");
  io.out(`Raw evidence (${raw.complete ? "complete" : "incomplete"}), shown as base64 and hex only; it is never printed as text:`);
  if (raw.note !== null) io.out(`  note: ${clean(raw.note)}`);
  rawBytes(io, "key", raw.keyBase64);
  rawBytes(io, "value", raw.valueBase64);
  for (const header of raw.headers) rawBytes(io, `header ${JSON.stringify(header.name).replace(UNSAFE_JSON, escape)}`, header.valueBase64);
}

function row(io: CliIO, label: string, value: unknown): void {
  io.out(`${label.padEnd(12)}${clean(value)}`);
}

function position(incident: IncidentSummary): string {
  const where = incident.position;
  return where.kind === "kafka" ? `kafka ${where.topic}/${where.partition}/${where.offset}` : `fixture #${where.index}`;
}

// --- renderers ---------------------------------------------------------------------------

export function renderOperation(io: CliIO, data: unknown, json: boolean): number {
  const result = data as OperationResult;
  if (json) io.out(jsonText(result));
  else {
    io.out(`${clean(result.result)}: ${clean(result.outcome)}`);
    io.out(clean(result.message));
    io.out(`Operation ${clean(result.operationId)}${result.incidentRevision === null ? "" : `, incident revision ${result.incidentRevision}`}`);
  }
  return operationExitCode(result.result);
}

function renderStatus(io: CliIO, data: unknown, json: boolean): number {
  const status = data as OperatorStatus;
  if (json) {
    io.out(jsonText(status));
    return OK;
  }
  const { gateway, store, quarantine } = status;
  row(io, "Gateway", `${gateway.mode} ${gateway.version}, ${gateway.state} (config ${gateway.configFingerprint}, handler build ${gateway.handlerBuildId})`);
  row(io, "Journal", `${store.kind}${store.durable ? "" : " (not durable)"}, ${store.sizeBytes} of ${store.limitBytes} bytes, schema ${store.schemaVersion}${store.path === null ? "" : `, ${store.path}`}`);
  row(io, "Quarantine", quarantine === null || quarantine.topic === null ? "not configured"
    : `${quarantine.topic} (max message ${quarantine.maxMessageBytes ?? "?"} bytes, min.insync.replicas ${quarantine.minInsyncReplicas ?? "?"}, replication ${quarantine.replicationFactor ?? "?"})`);
  io.out("Sources");
  for (const source of status.sources) {
    io.out(`  ${clean(source.sourceId)}  ${clean(source.status)}${source.reason === undefined ? "" : ` (${clean(source.reason)})`}, ${source.openIncidents} open incident${source.openIncidents === 1 ? "" : "s"}`);
    if (source.heldIncident !== null) io.out(`    held at ${clean(source.heldIncident.failureId)} (revision ${source.heldIncident.revision})`);
    const circuit = source.circuit;
    io.out(`    circuit ${circuit.state} (revision ${circuit.revision}, ${circuit.recentIncidents}/${circuit.limit} in ${circuit.windowMs} ms)${circuit.reason === null ? "" : `: ${clean(circuit.reason)}`}`);
    if (source.boundary !== null) {
      io.out(`    boundary ${clean(source.boundary.boundaryId)} (revision ${source.boundary.revision}, ${source.boundary.retirement} retirement) since ${clean(source.boundary.since)}`);
    }
  }
  return OK;
}

function renderList(io: CliIO, data: unknown, json: boolean): number {
  const page = data as Page<IncidentSummary>;
  if (json) {
    io.out(jsonText(page));
    return OK;
  }
  if (page.items.length === 0) io.out("No failures match.");
  else {
    const rows = page.items.map(item => [item.failureId, item.sourceId, item.failureClass, item.state, item.progress, String(item.revision), item.nextAction].map(clean));
    const header = ["FAILURE", "SOURCE", "CLASS", "STATE", "PROGRESS", "REV", "NEXT"];
    const widths = header.map((title, column) => Math.max(title.length, ...rows.map(cells => cells[column]?.length ?? 0)));
    for (const cells of [header, ...rows]) io.out(cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd());
  }
  if (page.nextCursor !== null) io.out(`More: --cursor ${clean(page.nextCursor)}`);
  return OK;
}

function renderShow(io: CliIO, data: unknown, values: Values, json: boolean): number {
  const incident = data as IncidentDetail & { raw?: RawEvidenceView };
  // Raw bytes are shown only when asked for, whatever the gateway sent.
  if (values["raw"] !== true) delete incident.raw;
  if (json) {
    io.out(jsonText(incident));
    return OK;
  }
  row(io, "Failure", `${incident.failureId} (revision ${incident.revision}, ${incident.state}${incident.resolution === null ? "" : `: ${incident.resolution}`})`);
  row(io, "Source", `${incident.sourceId} generation ${incident.generation} at ${position(incident)}`);
  row(io, "Class", `${incident.failureClass} at ${incident.stage} (${incident.errorCode}), policy ${incident.policy}`);
  row(io, "Progress", `${incident.progress}; recovery ${incident.recovery}; quarantine ${incident.quarantine}`);
  const evidence = incident.evidence;
  row(io, "Evidence", `${evidence.location}, ${evidence.completeness}, value ${evidence.valueBytes ?? "?"} bytes, key ${evidence.keyBytes ?? "?"} bytes, ${evidence.headerCount} header(s)${evidence.hash === "" ? "" : `, ${evidence.hash}`}`);
  row(io, "Observed", `${incident.observations} time(s), ${incident.firstObservedAt} to ${incident.lastObservedAt}`);
  row(io, "Diagnosis", incident.diagnosis.message);
  if (incident.boundary !== null) {
    row(io, "Boundary", `${incident.boundary.boundaryId} (revision ${incident.boundary.revision}, ${incident.boundary.state}, ${incident.boundary.retirement} retirement)`);
  }
  if (incident.guard !== null) row(io, "Guard", `${incident.guard.decision}${incident.guard.reason === null ? "" : `: ${incident.guard.reason}`} at ${incident.guard.at}`);
  row(io, "Next", incident.nextAction);
  io.out("");
  row(io, "What failed", incident.explanation.whatFailed);
  row(io, "Evidence", incident.explanation.evidence);
  row(io, "Disposition", incident.explanation.disposition);
  if (incident.explanation.snapshots !== null) row(io, "Snapshots", incident.explanation.snapshots);
  row(io, "Next action", incident.explanation.nextAction);
  if (incident.history.length > 0) {
    io.out("");
    io.out("History");
    for (const event of incident.history) {
      io.out(`  ${clean(event.at)}  ${clean(event.event)}${event.detail === null ? "" : `  ${clean(event.detail)}`}${event.operationId === null ? "" : `  (operation ${clean(event.operationId)})`}`);
    }
  }
  if (incident.raw !== undefined) renderRaw(io, incident.raw);
  return OK;
}

async function renderExport(io: CliIO, data: unknown, values: Values, json: boolean): Promise<number> {
  const bundle = data as ReproductionBundle;
  const includeRaw = values["include-raw"] === true;
  if (!includeRaw) delete bundle.raw;
  const out = text(values, "out", false);
  if (out === undefined) {
    io.out(jsonText(bundle));
    return OK;
  }
  const path = resolve(out);
  let file;
  try {
    // wx: never overwrite; 0600 before a byte is written. chmod again in case the umask is unusual.
    file = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UsageError(`Refusing to overwrite ${out}; choose a new file.`);
    throw new UsageError(`Cannot create ${out}: ${(error as Error).message}`);
  }
  try {
    await file.chmod(0o600);
    await file.writeFile(`${jsonText(bundle)}\n`);
  } catch (error) {
    await file.close();
    // The file is ours (created with wx above); never leave a partial bundle behind.
    await rm(path, { force: true });
    throw error;
  }
  await file.close();
  if (json) io.out(jsonText({ path, bundleVersion: bundle.bundleVersion, rawIncluded: bundle.raw !== undefined }));
  else {
    io.out(`Wrote the reproduction bundle for ${clean(bundle.incident.failureId)} to ${clean(path)} (mode 0600).`);
    io.out(`Raw evidence ${bundle.raw === undefined ? "not included" : "included"}: ${clean(bundle.evidence.note)}`);
  }
  return OK;
}

function renderEvaluate(io: CliIO, data: unknown, values: Values, json: boolean): number {
  const evaluation = data as EvaluationResult;
  if (json) {
    io.out(jsonText(evaluation));
    return OK;
  }
  row(io, "Validation", evaluation.validation);
  row(io, "Eligible", evaluation.eligible ? "yes" : `no${evaluation.ineligibleReason === null ? "" : ` (${evaluation.ineligibleReason})`}`);
  for (const error of evaluation.errors) io.out(`  error at ${clean(error.stage)}${error.failureClass === null ? "" : ` (${clean(error.failureClass)})`}: ${clean(error.message)}`);
  for (const output of evaluation.outputs) io.out(`  output ${clean(output.channel)} v${output.channelVersion} revision ${clean(output.revision)} (${output.routing})`);
  if (evaluation.plan !== null) {
    row(io, "Plan", `${evaluation.plan.planId}, fingerprint ${evaluation.plan.fingerprint}, expires ${evaluation.plan.expiresAt}`);
    io.out("");
    io.out("To redrive this plan:");
    io.out(`  streamotter failures redrive --state-dir ${clean(values["state-dir"])} --failure ${clean(values["failure"])} --plan ${clean(evaluation.plan.planId)} ` +
      `--plan-fingerprint ${clean(evaluation.plan.fingerprint)} --expected-revision ${clean(values["expected-revision"])}`);
  }
  return OK;
}

const operation = (io: CliIO, data: unknown, _values: Values, json: boolean): number => renderOperation(io, data, json);

const COMMANDS: Readonly<Record<string, Readonly<Record<string, Command>>>> = {
  status: {
    "": { op: "status", flags: [], build: () => ({}), render: (io, data, _values, json) => renderStatus(io, data, json) }
  },
  failures: {
    list: {
      op: "listFailures", flags: ["source", "state", "limit", "cursor"],
      build: values => defined({ sourceId: text(values, "source", false), state: text(values, "state", false), limit: integer(values, "limit", false), cursor: text(values, "cursor", false) }),
      render: (io, data, _values, json) => renderList(io, data, json)
    },
    show: {
      op: "showFailure", flags: ["failure", "raw"],
      build: values => defined({ failureId: text(values, "failure", true), includeRaw: values["raw"] === true ? true : undefined }),
      render: renderShow
    },
    export: {
      op: "exportFailure", flags: ["failure", "include-raw", "out"],
      build: values => defined({ failureId: text(values, "failure", true), includeRaw: values["include-raw"] === true ? true : undefined }),
      render: renderExport
    },
    evaluate: {
      op: "evaluate", flags: ["failure", "expected-revision"],
      build: values => ({ failureId: text(values, "failure", true), expectedRevision: integer(values, "expected-revision", true) }),
      render: renderEvaluate
    },
    redrive: {
      op: "redrive", flags: ["failure", "plan", "plan-fingerprint", "expected-revision", "operation-id"],
      build: values => defined({
        failureId: text(values, "failure", true), planId: text(values, "plan", true), planFingerprint: text(values, "plan-fingerprint", true),
        expectedRevision: integer(values, "expected-revision", true), operationId: text(values, "operation-id", false)
      }),
      render: operation
    }
  },
  sources: {
    "retry-current": {
      op: "retryCurrent", flags: ["source", "failure", "expected-revision", "reason"],
      build: values => defined({
        sourceId: text(values, "source", true), failureId: text(values, "failure", true), expectedRevision: integer(values, "expected-revision", true), reason: text(values, "reason", false)
      }),
      render: operation
    },
    reassess: {
      op: "reassess", flags: ["source", "failure", "expected-revision"],
      build: values => ({ sourceId: text(values, "source", true), failureId: text(values, "failure", true), expectedRevision: integer(values, "expected-revision", true) }),
      render: operation
    },
    "reopen-circuit": {
      op: "reopenCircuit", flags: ["source", "expected-circuit-revision", "reason"],
      build: values => ({ sourceId: text(values, "source", true), expectedCircuitRevision: integer(values, "expected-circuit-revision", true), reason: text(values, "reason", true) }),
      render: operation
    },
    "retire-boundary": {
      op: "retireBoundary", flags: ["source", "boundary", "expected-revision", "reason", "confirm"],
      build: values => ({
        sourceId: text(values, "source", true), boundaryId: text(values, "boundary", true), expectedRevision: integer(values, "expected-revision", true), reason: text(values, "reason", true)
      }),
      render: operation
    }
  }
};

/** True for the commands this module runs. */
export function isOperatorCommand(command: string): boolean {
  return Object.hasOwn(COMMANDS, command);
}

/**
 * Reports an error and returns `code`. With --json, stderr gets only
 * `{"error": StreamError}`: a plain message becomes INVALID_REQUEST for usage
 * errors (exit 2) and INTERNAL otherwise. `usage` is appended in human form only.
 */
export function fail(io: CliIO, json: boolean, code: number, error: StreamOtterError | string, usage?: string): number {
  if (json) {
    const wire = typeof error === "string" ? new StreamOtterError(code === INVALID ? "INVALID_REQUEST" : "INTERNAL", { message: error }) : error;
    io.err(JSON.stringify({ error: toStreamError(wire) }).replace(UNSAFE_JSON, escape));
  } else {
    io.err(clean(typeof error === "string" ? error : `${error.code}: ${error.message}`) + (usage === undefined ? "" : `\n\n${usage}`));
  }
  return code;
}

/**
 * A mutation sent to the gateway whose answer never came (the gateway stopped,
 * the connection dropped, or TIMEOUT): it may or may not have been applied, so
 * the exit is 4 (D7), with what to check before trying again.
 */
function unknownOutcome(io: CliIO, json: boolean, label: string, error: StreamOtterError, args: Record<string, unknown>): number {
  const operationId = typeof args["operationId"] === "string" ? args["operationId"] : null;
  const failureId = typeof args["failureId"] === "string" ? args["failureId"] : null;
  const check = [
    "`streamotter status`",
    ...(failureId === null ? [] : [`\`streamotter failures show --failure ${failureId}\``])
  ].join(" and ");
  const message = `The outcome of ${label} is unknown: the gateway may have applied it, but its answer was lost (${error.code}: ${error.message}). ` +
    `Check ${check} before trying again` +
    (operationId === null ? "." : `; sending it again with --operation-id ${operationId} returns the recorded result.`);
  const details = { ...error.details, reason: NO_ANSWER, ...(operationId === null ? {} : { operationId }) };
  return fail(io, json, UNKNOWN, json ? new StreamOtterError(error.code, { message, details }) : message);
}

/** Runs `status`, `failures <sub>` or `sources <sub>` and returns the exit code. */
export async function runOperatorCommand(command: string, positionals: readonly string[], values: Values, io: CliIO, usage: string): Promise<number> {
  const group = COMMANDS[command] ?? {};
  const name = command === "status" ? "" : positionals[0] ?? "";
  const spec = Object.hasOwn(group, name) ? group[name] : undefined;
  const label = `${command}${name === "" ? "" : ` ${name}`}`;
  const json = values["json"] === true;
  if (spec === undefined || positionals.length > (command === "status" ? 0 : 1)) {
    const choices = Object.keys(group).join("|");
    return fail(io, json, INVALID, command === "status" ? `Unexpected arguments for status: ${positionals.join(" ")}` : `Usage: streamotter ${command} ${choices} ...`, usage);
  }
  const extra = Object.keys(values).filter(key => !COMMON.includes(key) && !spec.flags.includes(key));
  if (extra.length > 0) {
    return fail(io, json, INVALID, `Unexpected arguments for ${label}: ${extra.map(key => `--${key}`).join(" ")}`, usage);
  }

  let args: Record<string, unknown>;
  let stateDirectory: string;
  try {
    stateDirectory = resolve(text(values, "state-dir", true));
    args = spec.build(values);
    validateOperatorRequest(spec.op, args);
    if (spec.op === "retireBoundary") {
      // With --json, stderr carries only a JSON error; the warning goes into the refusal's details instead.
      if (!json) io.err(RETIREMENT_WARNING);
      const confirm = text(values, "confirm", false);
      if (confirm !== args["boundaryId"]) {
        const message = `${label}: Not sent: repeat the boundary ID with --confirm ${clean(args["boundaryId"])} to retire it.`;
        return fail(io, json, INVALID, json ? new StreamOtterError("INVALID_REQUEST", { message, details: { warning: RETIREMENT_WARNING } }) : message);
      }
    }
    if (spec.op === "exportFailure") {
      const out = text(values, "out", false);
      if (out !== undefined && await lstat(resolve(out)).then(() => true, () => false)) throw new UsageError(`Refusing to overwrite ${out}; choose a new file.`);
    }
  } catch (error) {
    if (error instanceof UsageError) return fail(io, json, INVALID, `${label}: ${error.message}`);
    if (error instanceof StreamOtterError) return fail(io, json, INVALID, error);
    throw error;
  }

  try {
    const data = await callOperator(stateDirectory, spec.op, args as never);
    return await spec.render(io, data, values, json);
  } catch (error) {
    if (error instanceof UsageError) return fail(io, json, INVALID, `${label}: ${error.message}`);
    if (error instanceof StreamOtterError && MUTATIONS.has(spec.op) && error.details?.["reason"] === NO_ANSWER) {
      return unknownOutcome(io, json, label, error, args);
    }
    if (error instanceof StreamOtterError) return fail(io, json, error.code === "INVALID_REQUEST" ? INVALID : RUNTIME, error);
    return fail(io, json, RUNTIME, `${label}: unexpected failure: ${(error as Error).message}`);
  }
}
