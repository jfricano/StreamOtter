import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  MAX_CONFIG_DEPTH, canonicalJsonPretty, StreamOtterError, validateProjectConfig,
  type ConfigIssue, type DevelopmentOptions, type HandlerRegistry, type Json, type ProjectConfig
} from "@streamotter/contracts";
import { createGateway, type Gateway, type GatewayLogger } from "@streamotter/gateway";
import { startManagementServer } from "@streamotter/gateway/management";
import { getGatewayInternals, initJournal, rebaselineSource } from "@streamotter/gateway/internals";
import { detectPackageStyle, fingerprint, generateFiles, GENERATED_MARKER } from "./generate.ts";
import { fail, isOperatorCommand, OPERATOR_USAGE, renderOperation, runOperatorCommand } from "./operator.ts";
import { scaffoldFiles } from "./templates.ts";

export const EXIT = { ok: 0, runtime: 1, invalid: 2 } as const;

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  /** Resolves when the process should shut down (SIGINT/SIGTERM). */
  shutdownSignal: Promise<string>;
}

class CliError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

const USAGE = `Usage:
  streamotter init <directory>
  streamotter init --failures --config <path> --state-dir <directory>
  streamotter validate --config <path>
  streamotter generate --config <path> --out <directory>
  streamotter dev --config <path> --handlers <module> [--management-port <port>] [--state-dir <directory>] [--operator-socket]
  streamotter start --config <path> --handlers <module> [--state-dir <directory>] [--operator-socket] [--handler-build-id <id>] [--health <host:port>]

Operator commands, sent to the gateway serving <dir>/run/operator.sock (start it with --operator-socket):
${OPERATOR_USAGE}

Exit codes: 0 ok, 1 runtime failure or failed operation, 2 invalid usage or request, 3 refused, 4 unknown outcome.`;

function formatIssues(issues: readonly ConfigIssue[]): string {
  return issues.map(issue => `  ${issue.path || "/"}  ${issue.code}: ${issue.message}`).join("\n");
}

async function loadConfig(path: string | undefined): Promise<{ config: ProjectConfig; path: string }> {
  if (path === undefined) throw new CliError(EXIT.invalid, "--config <path> is required.");
  const absolute = resolve(path);
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    throw new CliError(EXIT.invalid, `Cannot read configuration file ${path}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(EXIT.invalid, `${path} is not valid JSON: ${(error as Error).message}`);
  }
  const { valid, issues } = validateProjectConfig(parsed);
  if (!valid) throw new CliError(EXIT.invalid, `${path} is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${formatIssues(issues)}`);
  return { config: parsed as ProjectConfig, path: absolute };
}

async function loadHandlers(path: string | undefined): Promise<{ handlers: HandlerRegistry<never>; development: DevelopmentOptions | undefined }> {
  if (path === undefined) throw new CliError(EXIT.invalid, "--handlers <module> is required.");
  const absolute = resolve(path);
  const extension = extname(absolute);
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) {
    throw new CliError(EXIT.invalid, `${path} is TypeScript. StreamOtter loads compiled JavaScript modules; compile your handlers and pass the .js output.`);
  }
  if (!existsSync(absolute)) throw new CliError(EXIT.invalid, `Handler module ${path} does not exist.`);
  let module: Record<string, unknown>;
  try {
    module = await import(pathToFileURL(absolute).href) as Record<string, unknown>;
  } catch (error) {
    throw new CliError(EXIT.runtime, `Failed to load handler module ${path}: ${(error as Error).message}`);
  }
  if (typeof module["handlers"] !== "object" || module["handlers"] === null) {
    throw new CliError(EXIT.invalid, `${path} must export \`handlers\` (a HandlerRegistry).`);
  }
  return {
    handlers: module["handlers"] as HandlerRegistry<never>,
    development: module["development"] as DevelopmentOptions | undefined
  };
}

function cliLogger(io: CliIO): GatewayLogger {
  const line = (level: string, message: string, fields?: Readonly<Record<string, Json>>) =>
    `${new Date().toISOString()} ${level.padEnd(5)} ${message}${fields !== undefined && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ""}`;
  return {
    info: (message, fields) => io.out(line("info", message, fields)),
    warn: (message, fields) => io.err(line("warn", message, fields)),
    error: (message, fields) => io.err(line("error", message, fields))
  };
}

function workbenchDirectory(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve("@streamotter/workbench/package.json");
    const dir = join(dirname(manifest), "dist");
    return existsSync(join(dir, "index.html")) ? dir : null;
  } catch {
    return null;
  }
}

async function reportStartupFailure(io: CliIO, gateway: Gateway, error: unknown): Promise<never> {
  io.err(`Gateway startup failed: ${(error as Error).message}`);
  try {
    for (const { sourceId, steps } of await getGatewayInternals(gateway).checkAllSources()) {
      io.err(`Source "${sourceId}" diagnostics:`);
      for (const step of steps) io.err(`  ${step.outcome === "ok" ? "✓" : step.outcome === "failed" ? "✗" : "-"} ${step.stage.padEnd(12)} ${step.message}`);
    }
  } catch {
    // Diagnostics are best effort.
  }
  await gateway.stop({ timeoutMs: 2_000 }).catch(() => undefined);
  const code = (error as { code?: string }).code;
  throw new CliError(code === "CONFIG_INVALID" ? EXIT.invalid : EXIT.runtime, "The gateway did not start.");
}

async function runUntilSignal(io: CliIO, gateway: Gateway): Promise<number> {
  const signal = await io.shutdownSignal;
  io.out(`Received ${signal}; shutting down gracefully.`);
  await gateway.stop({ timeoutMs: 10_000 });
  return EXIT.ok;
}

/** Gateway options shared by dev and start: the failure journal directory, the handler build ID and the operator socket. */
function failureOptions(values: Record<string, unknown>): { stateDirectory?: string; handlerBuildId?: string; operatorSocket?: boolean } {
  const options: { stateDirectory?: string; handlerBuildId?: string; operatorSocket?: boolean } = {};
  if (typeof values["state-dir"] === "string") options.stateDirectory = resolve(values["state-dir"]);
  if (typeof values["handler-build-id"] === "string") options.handlerBuildId = values["handler-build-id"];
  if (values["operator-socket"] === true) options.operatorSocket = true;
  return options;
}

/** Parses --health: "host:port", "[ipv6]:port", or a bare port on 127.0.0.1. */
function parseHealth(value: string): { host: string; port: number } {
  const match = /^(?:(\[[0-9a-fA-F:.]+\]|[^:\s\[\]]+):)?(\d{1,5})$/.exec(value);
  const port = Number(match?.[2]);
  if (match === null || !Number.isInteger(port) || port > 65_535) {
    throw new CliError(EXIT.invalid, "--health must be host:port, [ipv6]:port or a port, for example 127.0.0.1:7402.");
  }
  const host = match[1] === undefined ? "127.0.0.1" : match[1].replace(/^\[|\]$/g, "");
  return { host, port };
}

/**
 * `sources rebaseline` (spec §14, ADR-15B §4): offline, with the gateway stopped.
 * After the source's generation changed, closes the incidents of earlier
 * generations and retires their boundary. It opens the journal itself, so a
 * running gateway's lock refuses it; it never moves a consumer group.
 */
async function commandRebaseline(positionals: readonly string[], values: Record<string, unknown>, io: CliIO): Promise<number> {
  const permitted = ["config", "state-dir", "source", "reason", "confirm", "json"];
  const extra = Object.keys(values).filter(key => !permitted.includes(key));
  const json = values["json"] === true;
  if (extra.length > 0 || positionals.length > 1) {
    const message = `Unexpected arguments for sources rebaseline: ${[...extra.map(key => `--${key}`), ...positionals.slice(1)].join(" ")}`;
    if (json) return fail(io, json, EXIT.invalid, message);
    io.err(`${message}\n\n${USAGE}`);
    return EXIT.invalid;
  }
  try {
    const { config } = await loadConfig(values["config"] as string | undefined);
    const stateDir = values["state-dir"];
    const sourceId = values["source"];
    const reason = values["reason"];
    if (typeof stateDir !== "string" || stateDir === "") throw new CliError(EXIT.invalid, "--state-dir <directory> is required.");
    if (typeof sourceId !== "string" || sourceId === "") throw new CliError(EXIT.invalid, "--source <id> is required.");
    if (typeof reason !== "string" || reason.trim() === "") throw new CliError(EXIT.invalid, "--reason <text> is required: say why the old generation's incidents can be closed.");
    if (values["confirm"] !== sourceId) throw new CliError(EXIT.invalid, `Not done: repeat the source ID with --confirm ${sourceId} to close its incidents from earlier generations.`);
    const result = rebaselineSource({ stateDirectory: resolve(stateDir), config, sourceId, reason });
    return renderOperation(io, result, json);
  } catch (error) {
    if (error instanceof CliError) {
      if (json) return fail(io, json, error.exitCode, error.message);
      io.err(error.message);
      return error.exitCode;
    }
    const code = (error as { code?: string }).code;
    const exitCode = code === "INVALID_REQUEST" || code === "CONFIG_INVALID" ? EXIT.invalid : EXIT.runtime;
    // With --json, stderr carries only {"error": StreamError} (API §10).
    if (json) return fail(io, json, exitCode, error instanceof StreamOtterError ? error : (error as Error).message);
    io.err(`${code ?? "ERROR"}: ${(error as Error).message}`);
    return exitCode;
  }
}

/**
 * Creates the failure journal for an existing project (ADR-15A §2). Ordinary
 * startup never creates one, so a missing journal is always a visible error.
 */
async function commandInitFailures(values: Record<string, unknown>, io: CliIO): Promise<number> {
  const { config } = await loadConfig(values["config"] as string | undefined);
  const stateDir = values["state-dir"];
  if (typeof stateDir !== "string" || stateDir === "") throw new CliError(EXIT.invalid, "--state-dir <directory> is required with --failures.");
  if (config.failureHandling === undefined) {
    throw new CliError(EXIT.invalid, "The configuration has no failureHandling section; add one before creating a failure journal.");
  }
  let path: string;
  try {
    path = initJournal(resolve(stateDir), config.projectId, Object.entries(config.sources).map(([sourceId, source]) => ({
      sourceId, generation: source.generation, kind: source.kind
    })));
  } catch (error) {
    throw new CliError(EXIT.invalid, (error as Error).message);
  }
  io.out(`Created the failure journal at ${path}`);
  io.out("It holds incident decisions for this project. Keep it out of version control and back it up with the gateway stopped.");
  return EXIT.ok;
}

async function commandInit(positionals: string[], io: CliIO): Promise<number> {
  const directory = positionals[0];
  if (directory === undefined || positionals.length > 1) throw new CliError(EXIT.invalid, "Usage: streamotter init <directory>");
  const target = resolve(directory);
  if (existsSync(target) && !(await stat(target)).isDirectory()) throw new CliError(EXIT.invalid, `${directory} exists and is not a directory.`);
  const projectId = basename(target).replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, "") || "streamotter-app";
  const files = scaffoldFiles(projectId.slice(0, 64), { packages: detectPackageStyle(target) });
  const conflicts = files.filter(file => existsSync(join(target, file.path))).map(file => file.path);
  if (conflicts.length > 0) throw new CliError(EXIT.invalid, `Refusing to overwrite existing files: ${conflicts.join(", ")}`);
  for (const file of files) {
    await mkdir(dirname(join(target, file.path)), { recursive: true });
    await writeFile(join(target, file.path), file.content, { flag: "wx" });
    io.out(`  created ${join(directory, file.path)}`);
  }
  io.out(`\nNext:\n  cd ${directory}\n  streamotter dev --config streamotter.json --handlers server/handlers.mjs`);
  return EXIT.ok;
}

async function commandValidate(values: Record<string, unknown>, io: CliIO): Promise<number> {
  const { config, path } = await loadConfig(values["config"] as string | undefined);
  io.out(`${path} is valid.`);
  io.out(`Fingerprint: sha256:${fingerprint(config)}`);
  if (canonicalJsonPretty(config, MAX_CONFIG_DEPTH) !== await readFile(path, "utf8")) {
    io.out("Note: the file is not in canonical form (workbench exports use sorted keys and two-space indentation); the fingerprint is unaffected.");
  }
  return EXIT.ok;
}

async function commandGenerate(values: Record<string, unknown>, io: CliIO): Promise<number> {
  const { config } = await loadConfig(values["config"] as string | undefined);
  const out = values["out"] as string | undefined;
  if (out === undefined) throw new CliError(EXIT.invalid, "--out <directory> is required.");
  const target = resolve(out);
  const files = generateFiles(config, { packages: detectPackageStyle(target) });
  const blocked: string[] = [];
  for (const file of files) {
    const path = join(target, file.path);
    if (existsSync(path) && !(await readFile(path, "utf8")).startsWith(GENERATED_MARKER)) blocked.push(file.path);
  }
  if (blocked.length > 0) {
    throw new CliError(EXIT.invalid, `Refusing to overwrite files that were not created by the generator: ${blocked.join(", ")}`);
  }
  await mkdir(target, { recursive: true });
  for (const file of files) {
    await writeFile(join(target, file.path), file.content);
    io.out(`  wrote ${join(out, file.path)}`);
  }
  return EXIT.ok;
}

async function commandDev(values: Record<string, unknown>, io: CliIO): Promise<number> {
  const { config, path } = await loadConfig(values["config"] as string | undefined);
  const { handlers, development } = await loadHandlers(values["handlers"] as string | undefined);
  const managementPort = values["management-port"] === undefined ? 7401 : Number(values["management-port"]);
  if (!Number.isInteger(managementPort) || managementPort < 0 || managementPort > 65_535) throw new CliError(EXIT.invalid, "--management-port must be a port number.");
  let gateway: Gateway;
  try {
    gateway = createGateway({
      config, handlers, mode: "development", configDir: dirname(path), logger: cliLogger(io),
      ...(development === undefined ? {} : { development }),
      ...failureOptions(values)
    });
  } catch (error) {
    throw new CliError(EXIT.invalid, (error as Error).message);
  }
  let address: { origin: string; path: string };
  try {
    address = await gateway.start();
  } catch (error) {
    return reportStartupFailure(io, gateway, error);
  }
  const workbenchDir = workbenchDirectory();
  let management;
  try {
    management = await startManagementServer({ gateway, port: managementPort, workbenchDir });
  } catch (error) {
    await gateway.stop();
    throw new CliError(EXIT.runtime, `The management server could not start: ${(error as Error).message}`);
  }
  const internals = getGatewayInternals(gateway);
  io.out("");
  io.out("StreamOtter development gateway");
  io.out(`  Gateway      ${address.origin}  (Socket.IO path ${address.path})`);
  io.out(`  Workbench    ${workbenchDir === null ? "(not built; run pnpm build)" : `${management.origin}/`}`);
  io.out(`  Management   ${management.origin}/management/v1  (local only)`);
  io.out(`  Token        ${management.token}`);
  io.out(`  Config       ${path}  sha256:${internals.fingerprint.slice(0, 16)}…`);
  io.out(`  Sources      ${internals.sources().map(source => `${source.sourceId} (${source.kind}, ${source.status})`).join(", ")}`);
  const principals = development === undefined ? [] : Object.keys(development.principals ?? {});
  io.out(`  Principals   ${principals.length === 0 ? "(none registered)" : principals.join(", ")}`);
  io.out("");
  io.out("Enter the token in the workbench. It is valid only for this run. Configuration edits in the");
  io.out("workbench are candidates: export them and restart this command to apply. Press Ctrl+C to stop.");
  return runUntilSignal(io, gateway);
}

async function commandStart(values: Record<string, unknown>, io: CliIO): Promise<number> {
  const { config, path } = await loadConfig(values["config"] as string | undefined);
  const { handlers } = await loadHandlers(values["handlers"] as string | undefined);
  let gateway: Gateway;
  try {
    // The module's development export is deliberately ignored in production.
    gateway = createGateway({
      config, handlers, mode: "production", configDir: dirname(path), logger: cliLogger(io), ...failureOptions(values),
      ...(typeof values["health"] === "string" ? { health: parseHealth(values["health"]) } : {})
    });
  } catch (error) {
    throw new CliError(EXIT.invalid, (error as Error).message);
  }
  let address: { origin: string; path: string };
  try {
    address = await gateway.start();
  } catch (error) {
    return reportStartupFailure(io, gateway, error);
  }
  io.out(`StreamOtter gateway (production) listening on ${address.origin} path ${address.path}. No management or development endpoints are exposed.`);
  return runUntilSignal(io, gateway);
}

/**
 * Runs the CLI as this process: stdio, SIGINT/SIGTERM as the shutdown signal, and the exit code.
 * The `streamotter` bins of @streamotter/cli and of the all-in-one streamotter package both call it.
 */
export async function runProcess(argv: readonly string[] = process.argv.slice(2)): Promise<never> {
  const shutdownSignal = new Promise<string>(resolveSignal => {
    process.once("SIGINT", () => resolveSignal("SIGINT"));
    process.once("SIGTERM", () => resolveSignal("SIGTERM"));
  });
  const code = await runCli(argv, {
    out: line => { process.stdout.write(`${line}\n`); },
    err: line => { process.stderr.write(`${line}\n`); },
    shutdownSignal
  });
  // Flush output, then exit even if a dependency left a handle open.
  return new Promise<never>(() => {
    process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
  });
}

/**
 * Runs the CLI and returns its exit code: 0 success, 2 invalid input/configuration, 1 startup/runtime failure;
 * operator commands add 3 (refused) and 4 (unknown outcome).
 */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return command === undefined ? EXIT.invalid : EXIT.ok;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: "string" },
        handlers: { type: "string" },
        out: { type: "string" },
        "management-port": { type: "string" },
        "state-dir": { type: "string" },
        "handler-build-id": { type: "string" },
        "operator-socket": { type: "boolean" },
        health: { type: "string" },
        failures: { type: "boolean" },
        json: { type: "boolean" },
        source: { type: "string" },
        failure: { type: "string" },
        "expected-revision": { type: "string" },
        "expected-circuit-revision": { type: "string" },
        boundary: { type: "string" },
        plan: { type: "string" },
        "plan-fingerprint": { type: "string" },
        "operation-id": { type: "string" },
        reason: { type: "string" },
        state: { type: "string" },
        limit: { type: "string" },
        cursor: { type: "string" },
        raw: { type: "boolean" },
        "include-raw": { type: "boolean" },
        confirm: { type: "string" }
      }
    });
  } catch (error) {
    // An operator command run with --json reports even an unknown flag as {"error": StreamError} (API §10).
    if (isOperatorCommand(command) && rest.includes("--json")) return fail(io, true, EXIT.invalid, (error as Error).message);
    io.err(`${(error as Error).message}\n\n${USAGE}`);
    return EXIT.invalid;
  }
  const { values, positionals } = parsed;
  if (command === "sources" && positionals[0] === "rebaseline") return commandRebaseline(positionals, values, io);
  if (isOperatorCommand(command)) return runOperatorCommand(command, positionals, values, io, USAGE);
  const allowed: Record<string, readonly string[]> = {
    init: values["failures"] === true ? ["failures", "config", "state-dir"] : [],
    validate: ["config"],
    generate: ["config", "out"],
    dev: ["config", "handlers", "management-port", "state-dir", "operator-socket"],
    start: ["config", "handlers", "state-dir", "handler-build-id", "operator-socket", "health"]
  };
  const permitted = allowed[command];
  if (permitted === undefined) {
    io.err(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT.invalid;
  }
  const extra = Object.keys(values).filter(key => !permitted.includes(key));
  const takesPositionals = command === "init" && values["failures"] !== true;
  if (extra.length > 0 || (!takesPositionals && positionals.length > 0)) {
    io.err(`Unexpected arguments for ${command}: ${[...extra.map(key => `--${key}`), ...(takesPositionals ? [] : positionals)].join(" ")}\n\n${USAGE}`);
    return EXIT.invalid;
  }
  if (values["operator-socket"] === true && typeof values["state-dir"] !== "string") {
    io.err("--operator-socket requires --state-dir <directory>: the socket lives in <directory>/run/.");
    return EXIT.invalid;
  }
  try {
    switch (command) {
      case "init": return values["failures"] === true ? await commandInitFailures(values, io) : await commandInit(positionals, io);
      case "validate": return await commandValidate(values, io);
      case "generate": return await commandGenerate(values, io);
      case "dev": return await commandDev(values, io);
      case "start": return await commandStart(values, io);
      default: return EXIT.invalid;
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return error.exitCode;
    }
    io.err(`Unexpected failure: ${(error as Error).stack ?? String(error)}`);
    return EXIT.runtime;
  }
}
