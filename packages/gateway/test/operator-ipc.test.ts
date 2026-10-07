import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  OPERATOR_OPERATIONS, StreamOtterError, type GatewayLogger, type Json, type OperatorOperation, type OperatorRequests
} from "@streamotter/contracts";
import { OPERATOR_IPC_MAX_REQUEST_BYTES, type OperatorIpcResponse } from "@streamotter/contracts/internal";
import { callOperator, connectOperator, startOperatorSocket, type OperatorSocketOptions } from "../src/operator/ipc.ts";
import { BOUNDARY_ID, detail, FAILURE_ID, FakeOperator, HOSTILE_VALUE, raw, summary } from "./fake-operator.ts";

const POSIX = process.platform !== "win32";
const ROOT = POSIX && process.getuid?.() === 0;

const temporary: string[] = [];
after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

/** A state directory with run/ (0700), as `streamotter init --failures` leaves it. Short, so the socket path fits. */
function stateDirectory(): string {
  const parent = mkdtempSync(join(tmpdir(), "so-ipc-"));
  temporary.push(parent);
  const state = join(parent, "state");
  mkdirSync(join(state, "run"), { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  chmodSync(join(state, "run"), 0o700);
  return state;
}

function recordingLogger(): GatewayLogger & { lines: string[] } {
  const lines: string[] = [];
  const record = (level: string) => (message: string, fields?: Readonly<Record<string, Json>>) => { lines.push(`${level} ${message} ${JSON.stringify(fields ?? {})}`); };
  return { lines, info: record("info"), warn: record("warn"), error: record("error") };
}

async function serve(overrides: Partial<OperatorSocketOptions> = {}) {
  const directory = overrides.stateDirectory ?? stateDirectory();
  const operator = new FakeOperator();
  const logger = recordingLogger();
  const socket = await startOperatorSocket({ stateDirectory: directory, operator, logger, ...overrides });
  return { directory, operator, logger, socket, token: () => readFileSync(join(directory, "run/operator.token"), "utf8").trim() };
}

/** Writes raw bytes to the socket and collects everything until the server closes. */
function exchange(path: string, payload: string | Buffer | null, options: { end?: boolean } = {}): Promise<{ text: string; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = createConnection(path);
    let text = "";
    socket.on("connect", () => {
      if (payload === null) return;
      if (options.end === true) socket.end(payload);
      else socket.write(payload);
    });
    socket.on("data", chunk => { text += chunk.toString("utf8"); });
    // A server that answers and closes while we still write can reset the connection; the answer is what matters.
    socket.on("error", error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") reject(error); });
    socket.on("close", () => resolve({ text, elapsedMs: performance.now() - started }));
  });
}

/**
 * Writes `payload` and, once the server has answered and ended its side, keeps sending until the
 * server closes. Reports the answer, any error on the payload write, and how long the server kept
 * the connection after answering.
 */
function keepWriting(path: string, payload: Buffer, onAnswered: () => void = () => undefined): Promise<{ text: string; payloadError: string | undefined; lingerMs: number }> {
  return new Promise((resolve, reject) => {
    // allowHalfOpen: the caller keeps its side open after the server ends its own.
    const client = createConnection({ path, allowHalfOpen: true });
    const codeOf = (error: Error): string => (error as NodeJS.ErrnoException).code ?? error.message;
    let text = "";
    let payloadError: string | undefined;
    let answeredAt = 0;
    let ticker: NodeJS.Timeout | undefined;
    client.on("connect", () => client.write(payload, error => { if (error) payloadError = codeOf(error); }));
    client.on("data", chunk => { text += chunk.toString("utf8"); });
    client.on("end", () => {
      answeredAt = performance.now();
      ticker = setInterval(() => { if (!client.destroyed) client.write("more"); }, 50);
      onAnswered();
    });
    client.on("error", error => { if (codeOf(error) === "ENOENT") reject(error); });
    client.on("close", () => {
      clearInterval(ticker);
      resolve({ text, payloadError, lingerMs: answeredAt === 0 ? -1 : performance.now() - answeredAt });
    });
  });
}

async function send(path: string, request: unknown): Promise<OperatorIpcResponse> {
  const { text } = await exchange(path, `${JSON.stringify(request)}\n`);
  assert.ok(text.endsWith("\n"), `one response line, got ${JSON.stringify(text)}`);
  return JSON.parse(text) as OperatorIpcResponse;
}

function errorOf(response: OperatorIpcResponse) {
  assert.equal(response.ok, false, JSON.stringify(response));
  return (response as Extract<OperatorIpcResponse, { ok: false }>).error;
}

async function rejection(promise: Promise<unknown>): Promise<StreamOtterError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof StreamOtterError, String(error));
    return error;
  }
  assert.fail("expected a rejection");
}

function refusalOf(error: StreamOtterError): string {
  return String((error.details as Record<string, Json> | undefined)?.["reason"]);
}

const ARGS: { [O in OperatorOperation]: OperatorRequests[O] } = {
  status: {},
  listFailures: { sourceId: "orders", state: "open", limit: 10 },
  showFailure: { failureId: FAILURE_ID },
  exportFailure: { failureId: FAILURE_ID },
  retryCurrent: { sourceId: "orders", failureId: FAILURE_ID, expectedRevision: 3, reason: "fixed the producer" },
  reassess: { sourceId: "orders", failureId: FAILURE_ID, expectedRevision: 3 },
  reopenCircuit: { sourceId: "orders", expectedCircuitRevision: 1, reason: "flood is over" },
  retireBoundary: { sourceId: "orders", boundaryId: BOUNDARY_ID, expectedRevision: 2, reason: "verified the repair" },
  evaluate: { failureId: FAILURE_ID, expectedRevision: 3 },
  redrive: { failureId: FAILURE_ID, planId: "plan-1", planFingerprint: "sha256:plan", expectedRevision: 3, operationId: "redrive-1" }
};

describe("operator socket (API §7, ADR-15C §3)", { skip: POSIX ? false : "Unix-domain sockets only" }, () => {
  it("F38: round-trips every operation through connectOperator", async () => {
    const { directory, operator, socket } = await serve();
    try {
      const api = connectOperator(directory);
      assert.equal((await api.status()).sources[0]?.sourceId, "orders");
      assert.deepEqual((await api.listFailures(ARGS.listFailures)).items, [summary()]);
      assert.deepEqual(await api.showFailure(ARGS.showFailure), detail());
      assert.equal((await api.exportFailure(ARGS.exportFailure)).bundleVersion, 1);
      for (const op of ["retryCurrent", "reassess", "reopenCircuit", "retireBoundary", "redrive"] as const) {
        const result = await callOperator(directory, op, ARGS[op] as never);
        assert.equal(result.result, "completed", op);
      }
      assert.equal((await api.evaluate(ARGS.evaluate)).plan?.planId, "plan-1");
      assert.deepEqual(new Set(operator.calledOps()), new Set(OPERATOR_OPERATIONS));
      for (const call of operator.calls) assert.deepEqual(call.args, ARGS[call.op], call.op);
    } finally {
      await socket.close();
    }
  });

  it("F38: the socket and token file are 0600, the token is fresh base64url, and close removes both", async () => {
    const { directory, socket, token } = await serve();
    const tokenPath = join(directory, "run/operator.token");
    assert.equal(socket.path, join(directory, "run/operator.sock"));
    assert.ok(lstatSync(socket.path).isSocket());
    assert.equal(lstatSync(socket.path).mode & 0o777, 0o600);
    assert.equal(lstatSync(tokenPath).mode & 0o777, 0o600);
    assert.match(token(), /^[A-Za-z0-9_-]{43}$/);
    await socket.close();
    await socket.close();
    assert.equal(existsSync(socket.path), false);
    assert.equal(existsSync(tokenPath), false);
  });

  it("F38: refuses a missing or wrong token with UNAUTHENTICATED and never logs the token", async () => {
    const { operator, logger, socket, token } = await serve();
    try {
      const missing = await send(socket.path, { v: 1, id: "a", op: "status", args: {} });
      assert.equal(missing.id, "a");
      assert.equal(errorOf(missing).code, "UNAUTHENTICATED");
      const wrong = await send(socket.path, { v: 1, id: "b", token: "x".repeat(43), op: "status", args: {} });
      assert.equal(errorOf(wrong).code, "UNAUTHENTICATED");
      const ok = await send(socket.path, { v: 1, id: "c", token: token(), op: "status", args: {} });
      assert.equal(ok.ok, true);
      assert.deepEqual(operator.calledOps(), ["status"]);
      const log = logger.lines.join("\n");
      assert.doesNotMatch(log, new RegExp(token()));
      assert.match(log, /local caller with token/);
      assert.match(log, /"op":"status"/);
    } finally {
      await socket.close();
    }
  });

  it("F38: a token from a previous start stops working", async () => {
    const first = await serve();
    const old = first.token();
    await first.socket.close();
    const second = await serve({ stateDirectory: first.directory });
    try {
      assert.notEqual(second.token(), old);
      assert.equal(errorOf(await send(second.socket.path, { v: 1, id: "s", token: old, op: "status", args: {} })).code, "UNAUTHENTICATED");
      assert.equal((await send(second.socket.path, { v: 1, id: "t", token: second.token(), op: "status", args: {} })).ok, true);
    } finally {
      await second.socket.close();
    }
  });

  it("F38: answers an oversize line to a caller still writing, without resetting it, then closes", async () => {
    const { socket } = await serve();
    try {
      // Far larger than any socket buffer, so the caller is mid-write when the answer comes.
      const payload = Buffer.alloc(OPERATOR_IPC_MAX_REQUEST_BYTES * 32, 0x61);
      const outcome = await keepWriting(socket.path, payload);
      assert.equal(outcome.payloadError, undefined, "the server keeps reading after it answers, so the caller's write is not reset");
      const response = JSON.parse(outcome.text) as OperatorIpcResponse;
      assert.equal(errorOf(response).code, "INVALID_REQUEST");
      assert.match(errorOf(response).message, /longer than 65536 bytes/);
      // A caller that keeps sending is still cut off shortly after the answer (REPLY_LINGER_MS).
      assert.ok(outcome.lingerMs >= 800 && outcome.lingerMs < 5_000, `closed ${outcome.lingerMs} ms after the answer`);

      // A caller that ends its side after the answer is closed at once, not after the linger.
      const ended = await new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const client = createConnection(socket.path);
        client.on("connect", () => client.write(Buffer.alloc(OPERATOR_IPC_MAX_REQUEST_BYTES + 10, 0x61)));
        client.on("data", () => client.end());
        client.on("error", reject);
        client.on("close", () => resolve(performance.now() - started));
      });
      assert.ok(ended < 900, `closed after ${ended} ms`);
    } finally {
      await socket.close();
    }
  });

  it("F38: answers OVERLOADED to a caller still writing, and close() ends answered connections without waiting", async () => {
    const { socket, logger } = await serve({ maxConnections: 1, drainMs: 300, idleMs: 150 });
    const idle = exchange(socket.path, '{"v":1');
    await new Promise(resolve => setTimeout(resolve, 30));
    const crowded = await keepWriting(socket.path, Buffer.alloc(OPERATOR_IPC_MAX_REQUEST_BYTES * 8, 0x61));
    assert.equal(crowded.payloadError, undefined);
    assert.equal(errorOf(JSON.parse(crowded.text) as OperatorIpcResponse).code, "OVERLOADED");
    await idle;

    let closedMs = -1;
    const answered = keepWriting(socket.path, Buffer.alloc(OPERATOR_IPC_MAX_REQUEST_BYTES * 8, 0x61), () => {
      const started = performance.now();
      void socket.close().then(() => { closedMs = performance.now() - started; });
    });
    const outcome = await answered;
    assert.equal(errorOf(JSON.parse(outcome.text) as OperatorIpcResponse).code, "INVALID_REQUEST");
    assert.ok(outcome.lingerMs < 500, `close() ended the answered connection after ${outcome.lingerMs} ms`);
    await socket.close();
    assert.ok(closedMs >= 0 && closedMs < 500, `close() took ${closedMs} ms`);
    assert.doesNotMatch(logger.lines.join("\n"), /before every answer was written/);
  });

  it("F38: refuses an oversize line, malformed JSON, invalid UTF-8 and bad shapes with INVALID_REQUEST", async () => {
    const { operator, socket, token } = await serve();
    try {
      const oversize = await exchange(socket.path, Buffer.alloc(OPERATOR_IPC_MAX_REQUEST_BYTES + 10, 0x61));
      const big = JSON.parse(oversize.text) as OperatorIpcResponse;
      assert.equal(big.id, "");
      assert.equal(errorOf(big).code, "INVALID_REQUEST");
      assert.match(errorOf(big).message, /longer than 65536 bytes/);

      // Exactly at the limit including the newline is accepted as a line (and then judged on content).
      const padded = JSON.stringify({ v: 1, id: "edge", token: token(), op: "status", args: {}, pad: "" });
      const fill = OPERATOR_IPC_MAX_REQUEST_BYTES - 1 - padded.length;
      const edge = JSON.parse((await exchange(socket.path, `${padded.replace('"pad":""', `"pad":"${"p".repeat(fill)}"`)}\n`)).text) as OperatorIpcResponse;
      assert.equal(edge.id, "edge");
      assert.match(errorOf(edge).message, /Unknown request field "pad"/);

      for (const line of ["{not json\n", "[1,2]\n", "\"text\"\n", "null\n"]) {
        const response = JSON.parse((await exchange(socket.path, line)).text) as OperatorIpcResponse;
        assert.equal(response.id, "", line);
        assert.equal(errorOf(response).code, "INVALID_REQUEST", line);
      }
      const latin1 = JSON.parse((await exchange(socket.path, Buffer.from([0x7b, 0xff, 0xfe, 0x7d, 0x0a]))).text) as OperatorIpcResponse;
      assert.equal(errorOf(latin1).code, "INVALID_REQUEST");

      const unterminated = JSON.parse((await exchange(socket.path, JSON.stringify({ v: 1, id: "u", token: token(), op: "status", args: {} }), { end: true })).text) as OperatorIpcResponse;
      assert.match(errorOf(unterminated).message, /terminated by a newline/);

      const longId = await send(socket.path, { v: 1, id: "i".repeat(129), token: token(), op: "status", args: {} });
      assert.equal(longId.id, "");
      assert.equal(errorOf(longId).code, "INVALID_REQUEST");
      const numericId = await send(socket.path, { v: 1, id: 7, token: token(), op: "status", args: {} });
      assert.equal(numericId.id, "");

      const version = await send(socket.path, { v: 2, id: "v", token: token(), op: "status", args: {} });
      assert.equal(version.id, "v");
      assert.match(errorOf(version).message, /protocol version/);
      const noArgs = await send(socket.path, { v: 1, id: "n", token: token(), op: "status" });
      assert.match(errorOf(noArgs).message, /args must be a JSON object/);
      assert.deepEqual(operator.calls, []);
    } finally {
      await socket.close();
    }
  });

  it("F38: refuses an unknown operation and unknown or invalid arguments before calling the operator", async () => {
    const { operator, socket, token } = await serve();
    try {
      const unknownOp = await send(socket.path, { v: 1, id: "o", token: token(), op: "dropJournal", args: {} });
      assert.equal(errorOf(unknownOp).code, "INVALID_REQUEST");
      const inherited = await send(socket.path, { v: 1, id: "p", token: token(), op: "constructor", args: {} });
      assert.equal(errorOf(inherited).code, "INVALID_REQUEST");
      const unknownField = await send(socket.path, { v: 1, id: "f", token: token(), op: "retryCurrent", args: { ...ARGS.retryCurrent, force: true } });
      assert.equal(errorOf(unknownField).code, "INVALID_REQUEST");
      assert.match(errorOf(unknownField).message, /Unknown field "force"/);
      const wildcard = await send(socket.path, { v: 1, id: "w", token: token(), op: "reassess", args: { ...ARGS.reassess, expectedRevision: "*" } });
      assert.equal(errorOf(wildcard).code, "INVALID_REQUEST");
      const extra = await send(socket.path, { v: 1, id: "e", token: token(), op: "status", args: {}, sudo: true });
      assert.match(errorOf(extra).message, /Unknown request field "sudo"/);
      assert.deepEqual(operator.calls, []);
    } finally {
      await socket.close();
    }
  });

  it("F38: answers OVERLOADED beyond the request rate", async () => {
    const { socket, token } = await serve({ ratePerSecond: 1, burst: 2 });
    try {
      const request = { v: 1, id: "r", token: token(), op: "status", args: {} };
      assert.equal((await send(socket.path, request)).ok, true);
      assert.equal((await send(socket.path, request)).ok, true);
      const third = await send(socket.path, request);
      assert.equal(third.id, "r");
      assert.equal(errorOf(third).code, "OVERLOADED");
      // Bad tokens are rate limited too, so guessing is bounded.
      assert.equal(errorOf(await send(socket.path, { ...request, token: "guess" })).code, "OVERLOADED");
    } finally {
      await socket.close();
    }
  });

  it("F38: closes idle connections and answers OVERLOADED past the connection limit", async () => {
    const { socket, token } = await serve({ idleMs: 150, maxConnections: 1 });
    try {
      const idle = exchange(socket.path, '{"v":1');
      await new Promise(resolve => setTimeout(resolve, 30));
      const crowded = await send(socket.path, { v: 1, id: "c", token: token(), op: "status", args: {} });
      assert.equal(errorOf(crowded).code, "OVERLOADED");
      const closed = await idle;
      assert.equal(closed.text, "");
      assert.ok(closed.elapsedMs >= 100 && closed.elapsedMs < 2_000, `closed after ${closed.elapsedMs} ms`);
      const silent = await exchange(socket.path, null);
      assert.equal(silent.text, "");
      assert.equal((await send(socket.path, { v: 1, id: "d", token: token(), op: "status", args: {} })).ok, true);
    } finally {
      await socket.close();
    }
  });

  it("passes a StreamOtterError from the operator through, and hides anything else as INTERNAL", async () => {
    const { directory, operator, logger, socket } = await serve();
    try {
      operator.throwing.set("showFailure", new StreamOtterError("INVALID_REQUEST", { message: "No incident f1:none.", details: { reason: "not-found" } }));
      operator.throwing.set("status", new Error("database password is hunter2"));
      const known = await rejection(callOperator(directory, "showFailure", { failureId: "f1:none" }));
      assert.equal(known.code, "INVALID_REQUEST");
      assert.equal(known.message, "No incident f1:none.");
      assert.deepEqual(known.details, { reason: "not-found" });
      const unknown = await rejection(callOperator(directory, "status", {}));
      assert.equal(unknown.code, "INTERNAL");
      assert.equal(unknown.details, undefined);
      assert.doesNotMatch(unknown.message, /hunter2/);
      assert.doesNotMatch(logger.lines.join("\n"), /hunter2/);
    } finally {
      await socket.close();
    }
  });

  it("F39: raw evidence passes through as base64 and a request embedded in it is never acted on", async () => {
    const { directory, operator, socket } = await serve();
    try {
      const shown = await callOperator(directory, "showFailure", { failureId: FAILURE_ID, includeRaw: true });
      assert.deepEqual(shown.raw, raw());
      assert.deepEqual(Buffer.from(shown.raw?.valueBase64 ?? "", "base64"), HOSTILE_VALUE);
      assert.deepEqual(operator.calledOps(), ["showFailure"]);
    } finally {
      await socket.close();
    }
  });

  it("F38: refuses to start in a run directory others can reach, a symlinked one, or a missing one", async () => {
    for (const mode of [0o770, 0o777, 0o750, 0o701]) {
      const directory = stateDirectory();
      chmodSync(join(directory, "run"), mode);
      const error = await rejection(serve({ stateDirectory: directory }));
      assert.equal(error.code, "CONFIG_INVALID");
      assert.equal(refusalOf(error), "run-dir-insecure", mode.toString(8));
      assert.equal(existsSync(join(directory, "run/operator.token")), false);
    }
    const linked = stateDirectory();
    const elsewhere = stateDirectory();
    rmSync(join(linked, "run"), { recursive: true });
    symlinkSync(join(elsewhere, "run"), join(linked, "run"));
    const link = await rejection(serve({ stateDirectory: linked }));
    assert.equal(refusalOf(link), "run-dir-insecure");
    assert.match(link.message, /symbolic link/);
    assert.equal(existsSync(join(elsewhere, "run/operator.token")), false);

    const missing = stateDirectory();
    rmSync(join(missing, "run"), { recursive: true });
    assert.equal(refusalOf(await rejection(serve({ stateDirectory: missing }))), "run-dir-missing");
    assert.equal(refusalOf(await rejection(serve({ stateDirectory: join(missing, "nope") }))), "state-dir-missing");
    const writable = stateDirectory();
    chmodSync(writable, 0o777);
    assert.equal(refusalOf(await rejection(serve({ stateDirectory: writable }))), "state-dir-insecure");
  });

  it("F38: refuses a run directory owned by another user", { skip: ROOT ? false : "needs root to chown" }, async () => {
    const directory = stateDirectory();
    chownSync(join(directory, "run"), 4242, 4242);
    const error = await rejection(serve({ stateDirectory: directory }));
    assert.equal(refusalOf(error), "run-dir-insecure");
    assert.match(error.message, /owned by uid 4242/);
  });

  it("F38: replaces a stale socket, refuses a live one, and never replaces a non-socket", async () => {
    // A process that dies without closing leaves its socket file behind.
    const stale = stateDirectory();
    const stalePath = join(stale, "run/operator.sock");
    const child = spawnSync(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(stalePath)}, () => process.kill(process.pid, "SIGKILL"))`]);
    assert.equal(child.signal, "SIGKILL");
    assert.ok(lstatSync(stalePath).isSocket());
    const replaced = await serve({ stateDirectory: stale });
    try {
      assert.equal((await callOperator(stale, "status", {})).gateway.state, "running");

      const live = await rejection(serve({ stateDirectory: stale }));
      assert.equal(refusalOf(live), "socket-in-use");
      assert.match(live.message, /Another gateway serves this state directory/);
      // The refused start left the live gateway's token alone.
      assert.equal((await callOperator(stale, "status", {})).gateway.state, "running");
    } finally {
      await replaced.socket.close();
    }

    const occupied = stateDirectory();
    writeFileSync(join(occupied, "run/operator.sock"), "keep me");
    const error = await rejection(serve({ stateDirectory: occupied }));
    assert.equal(refusalOf(error), "socket-path-occupied");
    assert.equal(readFileSync(join(occupied, "run/operator.sock"), "utf8"), "keep me");

    const target = join(occupied, "target");
    writeFileSync(target, "x");
    const symlinked = stateDirectory();
    symlinkSync(target, join(symlinked, "run/operator.sock"));
    assert.equal(refusalOf(await rejection(serve({ stateDirectory: symlinked }))), "socket-path-occupied");
  });

  it("F38: replaces a token path planted as a symlink without writing through it", async () => {
    const directory = stateDirectory();
    const victim = join(directory, "victim");
    writeFileSync(victim, "untouched", { mode: 0o644 });
    symlinkSync(victim, join(directory, "run/operator.token"));
    const { socket, token } = await serve({ stateDirectory: directory });
    try {
      assert.equal(readFileSync(victim, "utf8"), "untouched");
      assert.ok(lstatSync(join(directory, "run/operator.token")).isFile());
      assert.match(token(), /^[A-Za-z0-9_-]{43}$/);
    } finally {
      await socket.close();
    }
  });

  it("F38: the client refuses a group-readable or symlinked token file and an unsafe run directory", async () => {
    const { directory, operator, socket } = await serve();
    const tokenPath = join(directory, "run/operator.token");
    try {
      chmodSync(tokenPath, 0o640);
      const readable = await rejection(callOperator(directory, "status", {}));
      assert.equal(readable.code, "CONFIG_INVALID");
      assert.equal(refusalOf(readable), "token-insecure");
      assert.match(readable.message, /accessible to group or others \(mode 640\)/);
      chmodSync(tokenPath, 0o600);

      const real = join(directory, "copied-token");
      writeFileSync(real, readFileSync(tokenPath), { mode: 0o600 });
      rmSync(tokenPath);
      symlinkSync(real, tokenPath);
      const linked = await rejection(callOperator(directory, "status", {}));
      assert.equal(refusalOf(linked), "token-insecure");
      assert.match(linked.message, /symbolic link/);
      rmSync(tokenPath);
      writeFileSync(tokenPath, readFileSync(real), { mode: 0o600 });

      chmodSync(join(directory, "run"), 0o755);
      assert.equal(refusalOf(await rejection(callOperator(directory, "status", {}))), "run-dir-insecure");
      chmodSync(join(directory, "run"), 0o700);
      assert.equal((await callOperator(directory, "status", {})).gateway.mode, "production");
      assert.deepEqual(operator.calledOps(), ["status"]);
    } finally {
      await socket.close();
    }
  });

  it("F38: refuses a socket path longer than macOS allows (103 bytes), at startup and in the client", async () => {
    // A state directory whose socket path is exactly `bytes` long.
    const sized = (bytes: number): string => {
      const base = stateDirectory();
      const name = "p".repeat(bytes - Buffer.byteLength(join(base, "x", "run", "operator.sock")) + 1);
      const state = join(base, name);
      mkdirSync(join(state, "run"), { recursive: true, mode: 0o700 });
      chmodSync(state, 0o700);
      assert.equal(Buffer.byteLength(join(state, "run", "operator.sock")), bytes);
      return state;
    };
    const fits = await serve({ stateDirectory: sized(103) });
    try {
      assert.equal((await connectOperator(fits.directory).status()).sources[0]?.sourceId, "orders");
    } finally {
      await fits.socket.close();
    }
    const long = sized(104);
    const refused = await rejection(serve({ stateDirectory: long }));
    assert.equal(refused.code, "CONFIG_INVALID");
    assert.equal(refusalOf(refused), "socket-path-too-long");
    assert.equal(existsSync(join(long, "run/operator.token")), false);
    // A client pointed at such a directory says why nothing answers instead of failing with EINVAL.
    const client = await rejection(callOperator(long, "status", {}));
    assert.equal(refusalOf(client), "operator-not-running");
    assert.match(client.message, /longer than 103 bytes/);
  });

  it("the client validates arguments locally and reports a gateway that is not running", async () => {
    const { directory, operator, socket } = await serve();
    const invalid = await rejection(callOperator(directory, "retryCurrent", { ...ARGS.retryCurrent, expectedRevision: -1 }));
    assert.equal(invalid.code, "INVALID_REQUEST");
    assert.deepEqual(operator.calls, []);
    await socket.close();
    const stopped = await rejection(callOperator(directory, "status", {}));
    assert.equal(stopped.code, "UNSUPPORTED_CAPABILITY");
    assert.match(stopped.message, /No gateway is serving the operator socket/);
    assert.equal(refusalOf(stopped), "operator-not-running");

    // A token left behind by a crash, with nobody listening, reads as not running too.
    writeFileSync(join(directory, "run/operator.token"), `${"a".repeat(43)}\n`, { mode: 0o600 });
    assert.equal(refusalOf(await rejection(callOperator(directory, "status", {}))), "operator-not-running");
    assert.equal(statSync(join(directory, "run")).mode & 0o777, 0o700);
  });

  it("the client times out when the gateway does not answer, and says the outcome is unknown", async () => {
    const { directory, operator, socket } = await serve();
    try {
      operator.delayMs = 500;
      const error = await rejection(callOperator(directory, "status", {}, { timeoutMs: 50 }));
      assert.equal(error.code, "TIMEOUT");
      assert.equal(refusalOf(error), "no-answer");
    } finally {
      await socket.close();
    }
  });

  it("S1: close() answers a request already handed to the operator, refuses one still being read, and accepts nothing new", async () => {
    const { directory, operator, socket } = await serve();
    operator.delayMs = 300;
    const inflight = callOperator(directory, "retryCurrent", ARGS.retryCurrent);
    const partial = exchange(socket.path, '{"v":1');
    while (operator.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const closed = socket.close();
    const result = await inflight;
    assert.equal(result.result, "completed");
    assert.equal(result.incidentRevision, 4);
    const refused = JSON.parse((await partial).text) as OperatorIpcResponse;
    assert.equal(errorOf(refused).code, "UNSUPPORTED_CAPABILITY");
    assert.match(errorOf(refused).message, /closing; the request was not run/);
    await closed;
    assert.equal(refusalOf(await rejection(callOperator(directory, "status", {}))), "operator-not-running");
    assert.deepEqual(operator.calledOps(), ["retryCurrent"]);
  });

  it("S1: close() waits at most drainMs for an answer, and the client then reports that the outcome is unknown", async () => {
    const { directory, operator, logger, socket } = await serve({ drainMs: 100 });
    operator.delayMs = 1_000;
    const inflight = rejection(callOperator(directory, "redrive", ARGS.redrive));
    while (operator.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const started = performance.now();
    await socket.close();
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 90 && elapsed < 900, `closed after ${elapsed} ms`);
    const error = await inflight;
    assert.equal(error.code, "INTERNAL");
    assert.equal(refusalOf(error), "no-answer");
    assert.match(error.message, /closed before a complete answer/);
    assert.match(logger.lines.join("\n"), /warn operator socket closed before every answer was written \{"unanswered":1,"drainMs":100\}/);
  });
});
