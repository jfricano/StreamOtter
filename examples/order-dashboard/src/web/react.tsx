/**
 * React usage example with the SDK's hooks (`@streamotter/client/react`). The provider creates one
 * client per signed-in session and closes it on unmount; each card subscribes while mounted.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createStreamOtterHooks, StreamOtterProvider } from "@streamotter/client/react";
import { channelVersions, type AppChannels } from "../generated/streamotter.generated.ts";
import { currentToken, gatewayOrigin, signIn, type Session } from "./session.ts";

const { useSubscription } = createStreamOtterHooks<AppChannels>();

function OrderCard({ orderId }: { orderId: string }) {
  // Live order state plus the delivery state that says whether it is current.
  const { data: order, revision, state, live, error } = useSubscription("orderStatus", { channelVersion: channelVersions.orderStatus, params: { orderId } });
  return (
    <section className={`panel${live ? "" : " stale"}`} aria-live="polite">
      <div className="row">
        <h2>Order {orderId}</h2>
        <span className={`badge ${live ? "ok" : state === "failed" || state === "resync-required" ? "bad" : "warn"}`}>{live ? "Live" : state}</span>
      </div>
      {order === undefined ? <p className="muted">{error === undefined ? "Loading…" : ""}</p> : (
        <div className="order-body">
          <div className="status-title">{order.status}</div>
          <p>{order.note}</p>
          <p className="muted small">{order.progress}% · revision {revision}</p>
        </div>
      )}
      {error !== undefined && <div className="notice bad" role="alert">{error.code === "FORBIDDEN" ? "You don't have access to this order." : error.message}</div>}
    </section>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { void signIn("alice").then(setSession); }, []);
  if (session === null) return <main><p className="muted">Signing in as Alice (development demo)…</p></main>;
  return (
    // A new session gets a new client: the key remounts the provider.
    <StreamOtterProvider key={session.user} options={{ origin: gatewayOrigin(), getToken: () => currentToken(session) }}>
      <header><h1>Order status · React</h1><span className="spacer" /><span className="muted small">{session.name}</span></header>
      <main>
        <OrderCard orderId="ord_1001" />
        <OrderCard orderId="ord_1002" />
        <OrderCard orderId="ord_1003" />
      </main>
    </StreamOtterProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><App /></StrictMode>);
