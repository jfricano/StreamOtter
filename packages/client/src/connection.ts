import { io, type Socket } from "socket.io-client";
import {
  CONTROL_CALLBACK_TIMEOUT_MS, EVENTS, HELLO_TIMEOUT_MS, isStreamError, PROTOCOL_VERSION, streamError,
  type DataFrame, type ErrorFrame, type Hello, type Receipt, type Result, type StreamError, type SubscriptionFrame
} from "@streamotter/contracts";
import { isDataFrame, isErrorFrame, isHello, isResult, isSubscriptionFrame } from "./frames.ts";

export interface ConnectionEvents {
  state(frame: SubscriptionFrame): void;
  data(frame: DataFrame): void;
  error(frame: ErrorFrame): void;
  disconnect(): void;
}

/**
 * One Socket.IO connection. Socket.IO reconnection and connection-state recovery
 * are disabled: the SDK owns reconnection and subscribes again only after an
 * authenticated so:hello. Control requests are never buffered while disconnected.
 */
export class Connection {
  readonly ready: Promise<Hello>;
  readonly #socket: Socket;
  readonly #events: ConnectionEvents;
  #connected = false;
  #closed = false;
  #disconnectNotified = false;
  readonly #pending = new Set<(error: StreamError) => void>();

  constructor(options: { origin: string; path: string; token: string; events: ConnectionEvents }) {
    this.#events = options.events;
    this.#socket = io(options.origin, {
      path: options.path,
      transports: ["websocket"],
      upgrade: false,
      reconnection: false,
      forceNew: true,
      multiplex: false,
      timeout: HELLO_TIMEOUT_MS,
      auth: { token: options.token, protocolVersion: PROTOCOL_VERSION },
      autoConnect: false
    });
    this.ready = new Promise<Hello>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(streamError("TIMEOUT", { message: "The gateway did not complete the handshake within ten seconds." }));
        this.close();
      }, HELLO_TIMEOUT_MS);
      this.#socket.once("connect_error", (error: Error & { data?: unknown }) => {
        clearTimeout(timer);
        reject(isStreamError(error.data)
          ? error.data
          : streamError("SOURCE_UNAVAILABLE", { message: "The gateway could not be reached; retrying.", retryable: true }));
        this.close();
      });
      this.#socket.once(EVENTS.hello, (hello: unknown) => {
        clearTimeout(timer);
        if (!isHello(hello) || hello.protocolVersion !== PROTOCOL_VERSION || !hello.deliveryModes.includes("state")) {
          reject(streamError("UNSUPPORTED_CAPABILITY", { message: "The gateway does not support protocol version 1 state delivery." }));
          this.close();
          return;
        }
        this.#connected = true;
        resolve(hello);
      });
      this.#socket.once("disconnect", () => {
        clearTimeout(timer);
        if (!this.#connected) reject(streamError("SOURCE_UNAVAILABLE", { message: "The connection closed during the handshake.", retryable: true }));
      });
    });
    this.ready.catch(() => undefined);

    this.#socket.on(EVENTS.state, (frame: unknown) => {
      if (this.#connected && isSubscriptionFrame(frame)) this.#events.state(frame);
    });
    this.#socket.on(EVENTS.data, (frame: unknown) => {
      if (this.#connected && isDataFrame(frame)) this.#events.data(frame);
    });
    this.#socket.on(EVENTS.error, (frame: unknown) => {
      if (isErrorFrame(frame)) this.#events.error(frame);
    });
    this.#socket.on("disconnect", () => this.#handleDisconnect());
    this.#socket.connect();
  }

  get connected(): boolean {
    return this.#connected && !this.#closed;
  }

  /** Sends a control request; rejects with TIMEOUT after five seconds or when the connection drops. */
  request<T>(event: string, payload: unknown): Promise<Result<T>> {
    if (!this.connected) return Promise.reject(streamError("SOURCE_UNAVAILABLE", { message: "Not connected.", retryable: true }));
    return new Promise<Result<T>>((resolve, reject) => {
      const fail = (error: StreamError) => {
        this.#pending.delete(fail);
        reject(error);
      };
      this.#pending.add(fail);
      this.#socket.timeout(CONTROL_CALLBACK_TIMEOUT_MS).emit(event, payload, (error: Error | null, result: unknown) => {
        if (!this.#pending.has(fail)) return;
        this.#pending.delete(fail);
        if (error !== null) {
          reject(streamError("TIMEOUT", { message: "The gateway did not acknowledge a control request in time." }));
          return;
        }
        if (!isResult(result)) {
          reject(streamError("INVALID_REQUEST", { message: "The gateway sent a malformed acknowledgement." }));
          return;
        }
        resolve(result as Result<T>);
      });
    });
  }

  receipt(receipt: Receipt): void {
    if (this.connected) this.#socket.emit(EVENTS.receipt, receipt);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.removeAllListeners(EVENTS.state);
    this.#socket.removeAllListeners(EVENTS.data);
    this.#socket.disconnect();
    this.#handleDisconnect();
  }

  #handleDisconnect(): void {
    this.#closed = true;
    const wasConnected = this.#connected;
    this.#connected = false;
    for (const fail of [...this.#pending]) {
      fail(streamError("SOURCE_UNAVAILABLE", { message: "The connection closed before the request was acknowledged.", retryable: true }));
    }
    if (wasConnected && !this.#disconnectNotified) {
      this.#disconnectNotified = true;
      this.#events.disconnect();
    }
  }
}
