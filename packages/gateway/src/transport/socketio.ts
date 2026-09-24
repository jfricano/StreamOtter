import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  EVENTS, HELLO_TIMEOUT_MS,
  type ClientToServerEvents, type DataFrame, type ErrorFrame, type Hello, type Principal, type ServerToClientEvents,
  type StreamError, type SubscriptionFrame
} from "@streamotter/contracts";
import type { ConnectionTransport } from "./types.ts";

export interface HandshakeResult {
  principal: Principal;
  previewSessionId: string | null;
}

export interface SessionHandlers {
  handleSubscribe(payload: unknown, reply: unknown): void;
  handleUnsubscribe(payload: unknown, reply: unknown): void;
  handleResync(payload: unknown, reply: unknown): void;
  handleReceipt(payload: unknown): void;
  handleUnknown(event: string, args: readonly unknown[]): void;
  handleTransportClosed(): void;
  open(): void;
}

export interface TransportCallbacks {
  /** Validates origin and credentials; resolves to a principal or a public error. */
  authenticate(input: { auth: unknown; origin: string | undefined }): Promise<{ ok: true; value: HandshakeResult } | { ok: false; error: StreamError }>;
  /** Creates the session for an authenticated connection. */
  openSession(result: HandshakeResult, transport: ConnectionTransport): SessionHandlers;
}

type SocketData = { handshake?: HandshakeResult };
type StreamSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const KNOWN_EVENTS: ReadonlySet<string> = new Set([EVENTS.subscribe, EVENTS.unsubscribe, EVENTS.resync, EVENTS.receipt]);

class SocketIoConnection implements ConnectionTransport {
  readonly #socket: StreamSocket;

  constructor(socket: StreamSocket) {
    this.#socket = socket;
  }

  sendHello(hello: Hello): void {
    this.#socket.emit("so:hello", hello);
  }

  sendState(frame: SubscriptionFrame): void {
    this.#socket.emit("so:state", frame);
  }

  sendData(frame: DataFrame): void {
    this.#socket.emit("so:data", frame);
  }

  sendError(frame: ErrorFrame): void {
    this.#socket.emit("so:error", frame);
  }

  close(): void {
    this.#socket.disconnect(true);
  }
}

/**
 * Socket.IO adapter: namespace "/", WebSocket-only transport, connection-state
 * recovery disabled (V1 owns resynchronization), control frames bounded by
 * maxControlFrameBytes. Authentication runs in handshake middleware so failures
 * reach the SDK as structured connect errors.
 */
export function attachSocketIo(httpServer: HttpServer, options: {
  path: string;
  maxControlFrameBytes: number;
  callbacks: TransportCallbacks;
}): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    path: options.path,
    serveClient: false,
    transports: ["websocket"],
    allowUpgrades: false,
    maxHttpBufferSize: options.maxControlFrameBytes,
    connectTimeout: HELLO_TIMEOUT_MS,
    pingInterval: 25_000,
    pingTimeout: 20_000
  });

  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    options.callbacks.authenticate({ auth: socket.handshake.auth, origin }).then(result => {
      if (!result.ok) {
        const error = new Error(result.error.message) as Error & { data?: StreamError };
        error.data = result.error;
        next(error);
        return;
      }
      socket.data.handshake = result.value;
      next();
    }, () => {
      const error = new Error("An unexpected error occurred.") as Error & { data?: StreamError };
      error.data = { code: "INTERNAL", message: "An unexpected error occurred.", retryable: true, requestId: "" };
      next(error);
    });
  });

  io.on("connection", socket => {
    const handshake = socket.data.handshake;
    if (handshake === undefined) {
      socket.disconnect(true);
      return;
    }
    const session = options.callbacks.openSession(handshake, new SocketIoConnection(socket));
    const untyped = socket as unknown as Socket;
    untyped.on(EVENTS.subscribe, (payload: unknown, reply: unknown) => session.handleSubscribe(payload, reply));
    untyped.on(EVENTS.unsubscribe, (payload: unknown, reply: unknown) => session.handleUnsubscribe(payload, reply));
    untyped.on(EVENTS.resync, (payload: unknown, reply: unknown) => session.handleResync(payload, reply));
    untyped.on(EVENTS.receipt, (payload: unknown) => session.handleReceipt(payload));
    untyped.onAny((event: unknown, ...args: unknown[]) => {
      if (typeof event !== "string" || !KNOWN_EVENTS.has(event)) session.handleUnknown(String(event), args);
    });
    socket.on("disconnect", () => session.handleTransportClosed());
    session.open();
  });

  return io;
}
