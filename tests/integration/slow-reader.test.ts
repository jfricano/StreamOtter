import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { afterEach, describe, it } from "node:test";
import { startHarness, waitFor, type Harness } from "./harness.ts";

/** One masked client WebSocket text frame. */
function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const mask = randomBytes(4);
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([header, mask, masked]);
}

/** An authenticated socket.io connection over a raw TCP socket, so the test controls reading. */
async function rawWebSocket(origin: string, path: string): Promise<Socket> {
  const url = new URL(origin);
  const socket = connect(Number(url.port), url.hostname);
  socket.on("error", () => {}); // The gateway resetting the connection is the outcome under test.
  await new Promise<void>(resolve => socket.once("connect", () => resolve()));
  socket.write(`GET ${path}/?EIO=4&transport=websocket HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: http://localhost:3000\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  const until = (marker: string) => new Promise<void>(resolve => {
    let seen = "";
    const onData = (chunk: Buffer) => {
      seen += chunk.toString("latin1");
      if (seen.includes(marker)) { socket.off("data", onData); resolve(); }
    };
    socket.on("data", onData);
  });
  await until("\"sid\"");
  socket.write(wsFrame(`40${JSON.stringify({ token: "alice@acme", protocolVersion: 1 })}`));
  await until("so:hello");
  return socket;
}

/** Writes `count` copies of a frame, respecting the client socket's own backpressure. */
async function flood(socket: Socket, frame: () => Buffer, count: number, stop: () => boolean): Promise<void> {
  for (let sent = 0; sent < count && !stop() && !socket.destroyed; sent += 500) {
    const chunk = Buffer.concat(Array.from({ length: 500 }, frame));
    if (!socket.write(chunk)) await new Promise(resolve => { socket.once("drain", resolve); socket.once("close", resolve); });
  }
}

describe("a client that stops reading", () => {
  let h: Harness | undefined;
  let socket: Socket | undefined;
  afterEach(async () => {
    socket?.destroy();
    await h?.close();
    h = undefined;
  });

  it("is disconnected after a burst of unknown or malformed frames", async () => {
    h = await startHarness();
    socket = await rawWebSocket(h.origin, h.path);
    await waitFor(() => h!.internals.connectionCount() === 1);
    socket.pause();
    const closed = () => h!.internals.connectionCount() === 0;
    await flood(socket, () => wsFrame(`42["a"]`), 10_000, closed);
    await waitFor(closed, 5_000);
  });

  it("is disconnected once replies it hasn't read pass the connection budget", async () => {
    h = await startHarness({ limits: { maxDataFrameBytes: 1_024, maxPendingBytesPerSubscription: 65_536, maxPendingBytesPerConnection: 65_536 } });
    socket = await rawWebSocket(h.origin, h.path);
    await waitFor(() => h!.internals.connectionCount() === 1);
    socket.pause();
    // Well-formed requests over the rate limit each get an OVERLOADED acknowledgement, which isn't a
    // protocol error; only the outbound guard stops these from piling up.
    let ack = 0;
    const subscribe = () => wsFrame(`42${ack++}${JSON.stringify(["so:unsubscribe", { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID() }])}`);
    const closed = () => h!.internals.connectionCount() === 0;
    await flood(socket, subscribe, 400_000, closed);
    await waitFor(closed, 10_000);
  });
});
