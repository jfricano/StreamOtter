import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import {
  asStreamOtterError, isOperatorOperation, isPlainObject, isStreamError, OPERATOR_IPC_MAX_REQUEST_BYTES, OPERATOR_IPC_VERSION, OPERATOR_SOCKET_FILE,
  OPERATOR_TOKEN_FILE, StreamOtterError, toStreamError, validateOperatorRequest,
  type GatewayLogger, type Json, type OperatorApi, type OperatorIpcResponse, type OperatorOperation, type OperatorRequests, type StreamError
} from "@streamotter/contracts";
import { RUN_DIRECTORY } from "../failures/journal.ts";

/**
 * The local operator socket (API §7, ADR-15C §3): a Unix-domain socket at
 * `<stateDirectory>/run/operator.sock` and the token file next to it.
 *
 * Protection is filesystem permissions plus the token. Node has no portable way
 * to read the peer's credentials, so a caller is only ever "a local caller with
 * the token", never a verified uid, and is logged as exactly that.
 *
 * Framing (D9): one UTF-8 JSON line per connection, one JSON line back, then the
 * server closes. Request data is validated and handed to the operator; nothing
 * in a request or in the evidence it returns is ever interpreted here.
 */

/** Random token bytes; base64url-encoded to 43 characters. */
const TOKEN_BYTES = 32;
const DEFAULT_RATE_PER_SECOND = 10;
const DEFAULT_BURST = 20;
const DEFAULT_IDLE_MS = 5_000;
/** How long a connection stays open after its answer is flushed, waiting for the caller to end its side. */
const REPLY_LINGER_MS = 1_000;
const DEFAULT_MAX_CONNECTIONS = 16;
const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;
/** How long close() lets answers already being computed be written before it drops their connections. */
const DEFAULT_DRAIN_MS = 5_000;
/** Longest request ID echoed back. */
const MAX_REQUEST_ID = 128;
/** sun_path is 108 bytes on Linux and 104 on macOS, including the terminator. */
const MAX_SOCKET_PATH_BYTES = 103;
/** How long a probe of an existing socket waits before treating it as live. */
const PROBE_TIMEOUT_MS = 1_000;
/** Largest response the client buffers; a bundle with raw evidence can be large, but not unbounded. */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const REQUEST_FIELDS = ["v", "id", "token", "op", "args"];

export interface OperatorSocketOptions {
  stateDirectory: string;
  operator: OperatorApi;
  logger: GatewayLogger;
  /** Requests per second per server (token bucket refill). Default 10. */
  ratePerSecond?: number;
  /** Token bucket size. Default 20. */
  burst?: number;
  /** A connection that has not sent a complete line by then is closed. Default 5000. */
  idleMs?: number;
  /** Concurrent connections; more are answered OVERLOADED. Default 16. */
  maxConnections?: number;
  /** How long close() waits for answers already in progress to be written. Default 5000. */
  drainMs?: number;
}

export interface OperatorSocket {
  path: string;
  /**
   * Stops accepting connections at once and answers a request not yet handed to
   * the operator with "closing"; a request already handed over is answered when
   * it finishes, for at most `drainMs`. Then removes the socket and the token
   * file. Idempotent.
   */
  close(): Promise<void>;
}

export interface OperatorClientOptions {
  /** How long to wait for the answer. Default 30000: evaluate and redrive can take time. */
  timeoutMs?: number;
}

export type OperatorResult<O extends OperatorOperation> = Awaited<ReturnType<OperatorApi[O]>>;

// --- filesystem checks ---------------------------------------------------------------

function refuse(reason: string, message: string, details: Record<string, Json> = {}): StreamOtterError {
  return new StreamOtterError("CONFIG_INVALID", { message, details: { reason, ...details } });
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Refuses a path other local users could tamper with or read: a symlink, the
 * wrong kind of file, anything not owned by this user, or anything whose mode
 * grants more than `allowed`. The state directory gets the journal's rule (not
 * group- or world-writable); the run directory and the token file hold a
 * credential, so they must not be accessible to anyone else at all.
 */
function checkProtected(path: string, stats: Stats, label: string, kind: "directory" | "file", forbidden: number, reason: string): void {
  if (stats.isSymbolicLink()) throw refuse(reason, `${label} ${path} is a symbolic link; use the real path.`, { path });
  if (kind === "directory" ? !stats.isDirectory() : !stats.isFile()) throw refuse(reason, `${label} ${path} is not a ${kind}.`, { path });
  if ((stats.mode & forbidden) !== 0) {
    const fix = forbidden === 0o022 ? "chmod go-w" : `chmod ${kind === "directory" ? "700" : "600"}`;
    const what = forbidden === 0o022 ? "group- or world-writable" : "accessible to group or others";
    throw refuse(reason, `${label} ${path} is ${what} (mode ${(stats.mode & 0o777).toString(8)}); run ${fix} on it.`, { path });
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    throw refuse(reason, `${label} ${path} is owned by uid ${stats.uid}, not this process's uid ${uid}.`, { path });
  }
}

function requirePosix(): void {
  if (process.platform === "win32") {
    throw new StreamOtterError("UNSUPPORTED_CAPABILITY", { message: "The operator socket needs Unix-domain sockets and POSIX permissions; it is not available on Windows." });
  }
}

/** Checks the state directory and its run/ directory; returns the run directory's path. */
function checkRunDirectory(stateDirectory: string, missing: (path: string) => StreamOtterError): string {
  const state = lstatOrNull(stateDirectory);
  if (state === null) throw missing(stateDirectory);
  checkProtected(stateDirectory, state, "State directory", "directory", 0o022, "state-dir-insecure");
  const runDirectory = join(stateDirectory, RUN_DIRECTORY);
  const run = lstatOrNull(runDirectory);
  if (run === null) throw missing(runDirectory);
  checkProtected(runDirectory, run, "Run directory", "directory", 0o077, "run-dir-insecure");
  return runDirectory;
}

function removeIfSame(path: string, ino: number | null): void {
  if (ino === null) return;
  const stats = lstatOrNull(path);
  if (stats === null || stats.ino !== ino) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }
}

/**
 * Writes a fresh token beside the socket and returns the token file's inode. The
 * token goes to a new file created with O_EXCL (which never follows a symlink)
 * and mode 0600, then is renamed over the old path, so the previous token, or
 * anything planted at that path, is replaced rather than written through.
 */
function writeToken(runDirectory: string, token: string): number {
  const path = join(runDirectory, OPERATOR_TOKEN_FILE);
  const temporary = join(runDirectory, `.${OPERATOR_TOKEN_FILE}.${randomBytes(6).toString("hex")}`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let ino: number;
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${token}\n`);
    fsyncSync(fd);
    ino = fstatSync(fd).ino;
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(temporary); } catch { /* already failing */ }
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* already failing */ }
    throw error;
  }
  return ino;
}

/** True when something accepts connections on the socket path. */
function probe(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => { socket.destroy(); resolve(true); }, PROBE_TIMEOUT_MS);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error", error => {
      clearTimeout(timer);
      const code = errnoCode(error);
      if (code === "ECONNREFUSED" || code === "ENOENT") resolve(false);
      else reject(refuse("socket-unusable", `Cannot check the existing operator socket at ${path} (${code ?? "error"}).`, { path }));
    });
  });
}

/** Removes a stale socket nobody answers; refuses a live one and anything that is not a socket. */
async function clearSocketPath(path: string): Promise<void> {
  const stats = lstatOrNull(path);
  if (stats === null) return;
  if (!stats.isSocket()) {
    throw refuse("socket-path-occupied", `${path} exists and is not a socket; it is never replaced. Remove it if nothing uses it.`, { path });
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    throw refuse("socket-path-occupied", `The socket at ${path} is owned by uid ${stats.uid}, not this process's uid ${uid}.`, { path });
  }
  if (await probe(path)) {
    throw refuse("socket-in-use", `Another gateway serves this state directory: ${path} is answering. Stop it first.`, { path });
  }
  try {
    unlinkSync(path);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }
}

// --- server --------------------------------------------------------------------------

class TokenBucket {
  readonly #rate: number;
  readonly #burst: number;
  #tokens: number;
  #last: number;

  constructor(rate: number, burst: number) {
    this.#rate = rate;
    this.#burst = burst;
    this.#tokens = burst;
    this.#last = performance.now();
  }

  take(): boolean {
    const now = performance.now();
    this.#tokens = Math.min(this.#burst, this.#tokens + ((now - this.#last) / 1000) * this.#rate);
    this.#last = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new StreamOtterError("CONFIG_INVALID", { message: `${name} must be a positive number.` });
  return value;
}

function invalid(message: string): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message });
}

function failure(id: string, error: unknown): OperatorIpcResponse {
  const wire: StreamError = error instanceof StreamOtterError ? toStreamError(error) : toStreamError(new StreamOtterError("INTERNAL"));
  return { v: OPERATOR_IPC_VERSION, id, ok: false, error: wire };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** What a log line records about a successful answer: the operation's result, never its data. */
function outcomeOf(data: unknown): string {
  if (isPlainObject(data) && typeof data["result"] === "string" && typeof data["outcome"] === "string") {
    return `${data["result"]}:${data["outcome"].slice(0, 64)}`;
  }
  return "ok";
}

/**
 * Serves the operator API on `<stateDirectory>/run/operator.sock`. Refuses to
 * start (CONFIG_INVALID with `details.reason`) when the state or run directory
 * is missing or could be tampered with, when another gateway answers on the
 * socket, or when something other than a socket occupies its path.
 */
export async function startOperatorSocket(options: OperatorSocketOptions): Promise<OperatorSocket> {
  requirePosix();
  const { operator, logger } = options;
  const bucket = new TokenBucket(positive(options.ratePerSecond, DEFAULT_RATE_PER_SECOND, "ratePerSecond"), positive(options.burst, DEFAULT_BURST, "burst"));
  const idleMs = positive(options.idleMs, DEFAULT_IDLE_MS, "idleMs");
  const maxConnections = positive(options.maxConnections, DEFAULT_MAX_CONNECTIONS, "maxConnections");
  const drainMs = positive(options.drainMs, DEFAULT_DRAIN_MS, "drainMs");

  const runDirectory = checkRunDirectory(options.stateDirectory, path => refuse(path === options.stateDirectory ? "state-dir-missing" : "run-dir-missing",
    `${path} does not exist. Run \`streamotter init --failures\` to create the state directory.`, { path }));
  const socketPath = join(runDirectory, OPERATOR_SOCKET_FILE);
  const tokenPath = join(runDirectory, OPERATOR_TOKEN_FILE);
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
    throw refuse("socket-path-too-long", `The operator socket path ${socketPath} is longer than ${MAX_SOCKET_PATH_BYTES} bytes; use a shorter state directory.`, { path: socketPath });
  }
  await clearSocketPath(socketPath);

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expected = digest(token);
  const tokenIno = writeToken(runDirectory, token);
  /** Each open connection, with what refuses its request if close() comes before the request was handed over. */
  const connections = new Map<Socket, () => void>();
  let closing = false;
  let drained: (() => void) | null = null;
  let lastOverloadLog = 0;

  const tokenMatches = (candidate: string): boolean => timingSafeEqual(digest(candidate), expected);

  const overloaded = (message: string): StreamOtterError => {
    const now = Date.now();
    if (now - lastOverloadLog >= 1_000) {
      lastOverloadLog = now;
      logger.warn("operator socket over its limits", { caller: "local caller", outcome: "OVERLOADED" });
    }
    return new StreamOtterError("OVERLOADED", { message });
  };

  async function answer(line: Buffer): Promise<OperatorIpcResponse> {
    let request: unknown;
    try {
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
    } catch {
      return failure("", invalid("The request is not a UTF-8 JSON line."));
    }
    if (!isPlainObject(request)) return failure("", invalid("The request must be a JSON object."));
    const rawId = request["id"];
    if (typeof rawId !== "string" || rawId.length > MAX_REQUEST_ID) return failure("", invalid(`id must be a string of at most ${MAX_REQUEST_ID} characters.`));
    const id = rawId;
    if (!bucket.take()) return failure(id, overloaded("Too many operator requests; try again shortly."));
    const unknown = Object.keys(request).find(key => !REQUEST_FIELDS.includes(key));
    if (unknown !== undefined) return failure(id, invalid(`Unknown request field "${unknown.slice(0, 64)}".`));
    if (request["v"] !== OPERATOR_IPC_VERSION) return failure(id, invalid(`Unsupported protocol version; this gateway speaks v ${OPERATOR_IPC_VERSION}.`));
    const candidate = request["token"];
    if (typeof candidate !== "string" || !tokenMatches(candidate)) {
      logger.warn("operator request refused", { caller: "local caller without a valid token", outcome: "UNAUTHENTICATED" });
      return failure(id, new StreamOtterError("UNAUTHENTICATED", { message: "The operator token is missing or stale; read it again from the state directory." }));
    }
    const op = request["op"];
    if (!isOperatorOperation(op)) return failure(id, invalid("Unknown operator operation."));
    if (!isPlainObject(request["args"])) return failure(id, invalid("args must be a JSON object."));
    try {
      const args = validateOperatorRequest(op, request["args"]);
      const method = operator[op] as (input: unknown) => Promise<unknown>;
      const data = await method.call(operator, args);
      // Serialize here so data that is not JSON fails as INTERNAL rather than a dropped connection.
      JSON.stringify(data);
      logger.info("operator request", { caller: "local caller with token", op, outcome: outcomeOf(data) });
      return { v: OPERATOR_IPC_VERSION, id, ok: true, data };
    } catch (error) {
      const code = error instanceof StreamOtterError ? error.code : "INTERNAL";
      const fields = { caller: "local caller with token", op, outcome: code };
      if (code === "INTERNAL") logger.error("operator request", fields);
      else logger.info("operator request", fields);
      return failure(id, error);
    }
  }

  /**
   * Writes the answer and closes. With `linger`, used when input may still be
   * arriving, the connection keeps reading (and discarding) after the answer:
   * closing with unread input resets the connection on some platforms (macOS),
   * and a caller still writing would lose the answer. It then closes when the
   * caller ends its side, or after REPLY_LINGER_MS, so a caller that keeps
   * sending cannot hold it open. Otherwise it is destroyed once flushed.
   */
  function reply(socket: Socket, response: OperatorIpcResponse, linger = false): void {
    if (socket.destroyed) return;
    let line: string;
    try {
      line = JSON.stringify(response);
    } catch {
      line = JSON.stringify(failure(response.id, new StreamOtterError("INTERNAL")));
    }
    if (!linger) {
      socket.end(`${line}\n`, () => socket.destroy());
      return;
    }
    socket.resume();
    socket.end(`${line}\n`, () => {
      const timer = setTimeout(() => socket.destroy(), REPLY_LINGER_MS);
      socket.once("close", () => clearTimeout(timer));
    });
  }

  const closingError = (): StreamOtterError => new StreamOtterError("UNSUPPORTED_CAPABILITY", { message: "The operator socket is closing; the request was not run." });

  function serve(socket: Socket): void {
    if (closing || connections.size >= maxConnections) {
      socket.on("error", () => undefined);
      reply(socket, failure("", closing ? closingError() : overloaded("Too many operator connections; try again shortly.")));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const idle = setTimeout(() => { done = true; socket.destroy(); }, idleMs);
    const finish = (response: OperatorIpcResponse | Promise<OperatorIpcResponse>, linger = false): void => {
      done = true;
      clearTimeout(idle);
      void Promise.resolve(response).then(value => reply(socket, value, linger), () => reply(socket, failure("", new StreamOtterError("INTERNAL")), linger));
    };
    // Before its request is handed over, a connection is refused by close(); after, it is left to finish.
    connections.set(socket, () => { if (!done) finish(failure("", closingError())); });
    socket.on("close", () => {
      clearTimeout(idle);
      connections.delete(socket);
      if (connections.size === 0) drained?.();
    });
    socket.on("error", () => { done = true; clearTimeout(idle); socket.destroy(); });
    socket.on("data", (chunk: Buffer) => {
      if (done) return;
      const newline = chunk.indexOf(0x0a);
      if (newline === -1 ? size + chunk.length >= OPERATOR_IPC_MAX_REQUEST_BYTES : size + newline + 1 > OPERATOR_IPC_MAX_REQUEST_BYTES) {
        // The caller may still be writing the rest of the line.
        finish(failure("", invalid(`The request line is longer than ${OPERATOR_IPC_MAX_REQUEST_BYTES} bytes.`)), true);
        return;
      }
      if (newline === -1) {
        chunks.push(chunk);
        size += chunk.length;
        return;
      }
      chunks.push(chunk.subarray(0, newline));
      finish(answer(Buffer.concat(chunks)));
    });
    socket.on("end", () => {
      if (!done) finish(failure("", invalid("The request must be one JSON line terminated by a newline.")));
    });
  }

  const server = createServer({ allowHalfOpen: true }, serve);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    removeIfSame(tokenPath, tokenIno);
    throw refuse("socket-listen", `The operator socket could not listen at ${socketPath} (${errnoCode(error) ?? "error"}).`, { path: socketPath });
  }
  let socketIno: number | null = null;
  try {
    // run/ is 0700, so nobody else could reach the socket before this narrows it to 0600.
    chmodSync(socketPath, 0o600);
    socketIno = lstatSync(socketPath).ino;
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    removeIfSame(tokenPath, tokenIno);
    throw error;
  }
  server.on("error", error => logger.error("operator socket error", { code: errnoCode(error) ?? "error" }));
  logger.info("operator socket listening", { path: socketPath });

  let closed: Promise<void> | null = null;
  return {
    path: socketPath,
    close(): Promise<void> {
      closed ??= (async () => {
        closing = true;
        const stopped = new Promise<void>(resolve => server.close(() => resolve()));
        for (const refuse of [...connections.values()]) refuse();
        // A mutation already running is answered rather than cut off, so the caller learns its outcome.
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          new Promise<void>(resolve => { drained = resolve; if (connections.size === 0) resolve(); }),
          new Promise<void>(resolve => { timer = setTimeout(resolve, drainMs); })
        ]);
        clearTimeout(timer);
        if (connections.size > 0) {
          logger.warn("operator socket closed before every answer was written", { unanswered: connections.size, drainMs });
        }
        for (const socket of connections.keys()) socket.destroy();
        await stopped;
        removeIfSame(socketPath, socketIno);
        removeIfSame(tokenPath, tokenIno);
      })();
      return closed;
    }
  };
}

// --- client --------------------------------------------------------------------------

function notRunning(stateDirectory: string, detail: string): StreamOtterError {
  return new StreamOtterError("UNSUPPORTED_CAPABILITY", {
    message: `No gateway is serving the operator socket for ${stateDirectory}: ${detail}. ` +
      "Start the gateway with --state-dir pointing here and --operator-socket.",
    details: { reason: "operator-not-running" }
  });
}

/**
 * Reads the current token from `run/operator.token`. Refuses when the state
 * directory, run/ or the token file is a symlink, not owned by this user, or
 * accessible to others; the token is never taken from anywhere else.
 */
function readToken(stateDirectory: string): string {
  const runDirectory = checkRunDirectory(stateDirectory, path => notRunning(stateDirectory, `${path} does not exist`));
  const path = join(runDirectory, OPERATOR_TOKEN_FILE);
  const stats = lstatOrNull(path);
  if (stats === null) throw notRunning(stateDirectory, `there is no token at ${path}`);
  checkProtected(path, stats, "Operator token file", "file", 0o077, "token-insecure");
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") throw notRunning(stateDirectory, `there is no token at ${path}`);
    throw refuse("token-insecure", `Cannot open the operator token file ${path} (${errnoCode(error) ?? "error"}).`, { path });
  }
  try {
    const opened = fstatSync(fd);
    // The path could have been swapped between the check and the open; check what was actually opened.
    if (opened.ino !== stats.ino || opened.dev !== stats.dev) throw refuse("token-insecure", `The operator token file ${path} changed while it was read; try again.`, { path });
    checkProtected(path, opened, "Operator token file", "file", 0o077, "token-insecure");
    const buffer = Buffer.alloc(256);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    const token = buffer.subarray(0, length).toString("utf8").trim();
    if (!/^[A-Za-z0-9_-]{43,200}$/.test(token)) throw refuse("token-malformed", `The operator token file ${path} does not hold a token.`, { path });
    return token;
  } finally {
    closeSync(fd);
  }
}

function badResponse(message: string): StreamOtterError {
  return new StreamOtterError("INTERNAL", { message: `The gateway's operator socket answered unexpectedly: ${message}.` });
}

/**
 * `details.reason` of a client error raised after the request was sent but
 * before a usable answer arrived (a TIMEOUT, a dropped connection, an unreadable
 * answer): the gateway may have run the request, so its outcome is unknown.
 */
const NO_ANSWER = "no-answer";

function unanswered(error: StreamOtterError): StreamOtterError {
  return new StreamOtterError(error.code, { message: error.message, details: { ...error.details, reason: NO_ANSWER } });
}

/** Rebuilds the error a response carries; anything that is not a StreamError becomes INTERNAL. */
function responseError(value: unknown): StreamOtterError {
  return isStreamError(value) ? asStreamOtterError(toStreamError(value)) : badResponse("an error without a valid shape");
}

/**
 * Sends one request over the local socket and resolves to its data, or rejects
 * with the StreamOtterError the gateway returned. Arguments are validated before
 * anything is sent.
 */
export async function callOperator<O extends OperatorOperation>(
  stateDirectory: string, op: O, args: OperatorRequests[O], options: OperatorClientOptions = {}
): Promise<OperatorResult<O>> {
  requirePosix();
  const timeoutMs = positive(options.timeoutMs, DEFAULT_CLIENT_TIMEOUT_MS, "timeoutMs");
  if (!isOperatorOperation(op)) throw invalid("Unknown operator operation.");
  const validated = validateOperatorRequest(op, args);
  const token = readToken(stateDirectory);
  const socketPath = join(stateDirectory, RUN_DIRECTORY, OPERATOR_SOCKET_FILE);
  // No gateway can listen there (it refuses at startup), and connecting would fail with a bare EINVAL.
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) throw notRunning(stateDirectory, `the socket path ${socketPath} is longer than ${MAX_SOCKET_PATH_BYTES} bytes`);
  const id = randomUUID();
  const line = `${JSON.stringify({ v: OPERATOR_IPC_VERSION, id, token, op, args: validated })}\n`;
  if (Buffer.byteLength(line) > OPERATOR_IPC_MAX_REQUEST_BYTES) throw invalid(`The request is longer than ${OPERATOR_IPC_MAX_REQUEST_BYTES} bytes.`);

  return new Promise<OperatorResult<O>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let sent = false;
    const socket = createConnection(socketPath);
    const settle = (error: StreamOtterError | null, data?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === null) resolve(data as OperatorResult<O>);
      else reject(error);
    };
    /** Fails a request that may have reached the gateway: the error says its outcome is unknown. */
    const lost = (error: StreamOtterError): void => settle(sent ? unanswered(error) : error);
    const timer = setTimeout(() => lost(new StreamOtterError("TIMEOUT", { message: `The gateway did not answer ${op} within ${timeoutMs} ms.` })), timeoutMs);
    socket.once("connect", () => { sent = true; socket.end(line); });
    const complete = (): void => {
      const text = Buffer.concat(chunks).toString("utf8");
      const newline = text.indexOf("\n");
      if (newline === -1) {
        lost(badResponse("the connection closed before a complete answer"));
        return;
      }
      let response: unknown;
      try {
        response = JSON.parse(text.slice(0, newline));
      } catch {
        lost(badResponse("not JSON"));
        return;
      }
      if (!isPlainObject(response) || response["v"] !== OPERATOR_IPC_VERSION || typeof response["ok"] !== "boolean") {
        lost(badResponse("not a v1 response"));
        return;
      }
      if (response["ok"] === true) {
        if (response["id"] !== id) lost(badResponse("an answer to a different request"));
        else settle(null, response["data"]);
        return;
      }
      // An error the server could not tie to a request carries id "".
      if (response["id"] !== id && response["id"] !== "") lost(badResponse("an answer to a different request"));
      else settle(responseError(response["error"]));
    };
    socket.on("error", error => {
      const code = errnoCode(error);
      if (code === "ENOENT" || code === "ECONNREFUSED") settle(notRunning(stateDirectory, `nothing answers at ${socketPath}`));
      // The server closes right after answering; a reset after a complete answer is not a failure.
      else if (code === "EPIPE" || code === "ECONNRESET") complete();
      else lost(new StreamOtterError("INTERNAL", { message: `Cannot reach the operator socket at ${socketPath} (${code ?? "error"}).` }));
    });
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) lost(badResponse(`a response larger than ${MAX_RESPONSE_BYTES} bytes`));
      else chunks.push(chunk);
    });
    socket.on("close", () => { if (!settled) complete(); });
  });
}

/** The operator API of the gateway serving `<stateDirectory>/run/operator.sock`. */
export function connectOperator(stateDirectory: string, options: OperatorClientOptions = {}): OperatorApi {
  return {
    status: () => callOperator(stateDirectory, "status", {}, options),
    listFailures: request => callOperator(stateDirectory, "listFailures", request, options),
    showFailure: request => callOperator(stateDirectory, "showFailure", request, options),
    exportFailure: request => callOperator(stateDirectory, "exportFailure", request, options),
    retryCurrent: request => callOperator(stateDirectory, "retryCurrent", request, options),
    reassess: request => callOperator(stateDirectory, "reassess", request, options),
    reopenCircuit: request => callOperator(stateDirectory, "reopenCircuit", request, options),
    retireBoundary: request => callOperator(stateDirectory, "retireBoundary", request, options),
    evaluate: request => callOperator(stateDirectory, "evaluate", request, options),
    redrive: request => callOperator(stateDirectory, "redrive", request, options)
  };
}
