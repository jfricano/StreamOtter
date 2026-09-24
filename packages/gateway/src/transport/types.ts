import type { DataFrame, ErrorFrame, Hello, SubscriptionFrame } from "@streamotter/contracts";

/** Server-side view of one client transport connection. Transport specifics stay in the adapter. */
export interface ConnectionTransport {
  sendHello(hello: Hello): void;
  sendState(frame: SubscriptionFrame): void;
  sendData(frame: DataFrame): void;
  sendError(frame: ErrorFrame): void;
  close(): void;
}
