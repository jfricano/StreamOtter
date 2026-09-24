import { io, type Socket } from "socket.io-client";
import type { Hello, Result, StreamError } from "@streamotter/contracts";

/** Low-level protocol client for wire-contract tests; bypasses the SDK. */
export function rawSocket(origin: string, auth: unknown, headers: Record<string, string> = {}): Socket {
  return io(origin, {
    path: "/streamotter/socket.io",
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: auth as Record<string, unknown>,
    extraHeaders: headers
  });
}

export function rawConnect(origin: string, auth: unknown, headers: Record<string, string> = {}): Promise<{ socket: Socket; hello: Hello }> {
  const socket = rawSocket(origin, auth, headers);
  return new Promise((resolve, reject) => {
    socket.once("so:hello", (hello: Hello) => resolve({ socket, hello }));
    socket.once("connect_error", (error: Error & { data?: StreamError }) => {
      socket.close();
      reject(error.data ?? error);
    });
  });
}

export async function rawConnectError(origin: string, auth: unknown, headers: Record<string, string> = {}): Promise<StreamError> {
  try {
    const { socket } = await rawConnect(origin, auth, headers);
    socket.close();
  } catch (error) {
    return error as StreamError;
  }
  throw new Error("expected the handshake to be rejected");
}

export function ack<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<Result<T>> {
  return socket.timeout(5_000).emitWithAck(event, payload) as Promise<Result<T>>;
}
