import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  canonicalJsonPretty, validateProjectConfig,
  type ConfigIssue, type DevelopmentOptions, type HandlerRegistry, type Json, type ProjectConfig
} from "@streamotter/contracts";
import { createGateway, type Gateway, type GatewayLogger } from "@streamotter/gateway";
import { startManagementServer } from "@streamotter/gateway/management";
import { getGatewayInternals } from "@streamotter/gateway/internals";
import { fingerprint, generateFiles, GENERATED_MARKER } from "./generate.ts";
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
  streamotter validate --config <path>
  streamotter generate --config <path> --out <directory>
  streamotter dev --config <path> --handlers <module> [--management-port <port>]
  streamotter start --config <path> --handlers <module>`;

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

async function commandInit(positionals: string[], io: CliIO): Promise<number> {
  const directory = positionals[0];
  if (directory === undefined || positionals.length > 1) throw new CliError(EXIT.invalid, "Usage: streamotter init <directory>");
  const target = resolve(directory);
  if (existsSync(target) && !(await stat(target)).isDirectory()) throw new CliError(EXIT.invalid, `${directory} exists and is not a directory.`);
  const projectId = basename(target).replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, "") || "streamotter-app";
  const files = scaffoldFiles(projectId.slice(0, 64));
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
  if (canonicalJsonPretty(config) !== await readFile(path, "utf8")) {
    io.out("Note: the file is not in canonical form (workbench exports use sorted keys and two-space indentation); the fingerprint is unaffected.");
  }
  return EXIT.ok;
}

async function commandGenerate(values: Record<string, unknown>, io: CliIO): Promise<number> {
  const { config } = await loadConfig(values["config"] as string | undefined);
  const out = values["out"] as string | undefined;
  if (out === undefined) throw new CliError(EXIT.invalid, "--out <directory> is required.");
  const target = resolve(out);
  const files = generateFiles(config);
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
      ...(development === undefined ? {} : { development })
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
    gateway = createGateway({ config, handlers, mode: "production", configDir: dirname(path), logger: cliLogger(io) });
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

/** Runs the CLI and returns its exit code: 0 success, 2 invalid input/configuration, 1 startup/runtime failure. */
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
        "management-port": { type: "string" }
      }
    });
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${USAGE}`);
    return EXIT.invalid;
  }
  const { values, positionals } = parsed;
  const allowed: Record<string, readonly string[]> = {
    init: [], validate: ["config"], generate: ["config", "out"], dev: ["config", "handlers", "management-port"], start: ["config", "handlers"]
  };
  const permitted = allowed[command];
  if (permitted === undefined) {
    io.err(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT.invalid;
  }
  const extra = Object.keys(values).filter(key => !permitted.includes(key));
  if (extra.length > 0 || (command !== "init" && positionals.length > 0)) {
    io.err(`Unexpected arguments for ${command}: ${[...extra.map(key => `--${key}`), ...(command === "init" ? [] : positionals)].join(" ")}\n\n${USAGE}`);
    return EXIT.invalid;
  }
  try {
    switch (command) {
      case "init": return await commandInit(positionals, io);
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
