import type { DataFrame, ErrorFrame, Hello, SubscriptionFrame } from "@streamotter/contracts";

/** Server-side view of one client transport connection. Transport specifics stay in the adapter. */
export interface ConnectionTransport {
  sendHello(hello: Hello): void;
  sendState(frame: SubscriptionFrame): void;
  sendData(frame: DataFrame): void;
  sendError(frame: ErrorFrame): void;
  /** Bytes written but not yet taken by the client: frames queued in the transport plus the socket's buffer. */
  bufferedBytes(): number;
  /** Closes the connection; `force` drops queued output instead of waiting for the client to read it. */
  close(force?: boolean): void;
}
