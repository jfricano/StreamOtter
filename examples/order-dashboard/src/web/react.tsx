/**
 * React usage example. One client per application scope (created once, closed on
 * unmount); one subscription per mounted component, unsubscribed on unmount.
 */
import { StrictMode, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Client, type StreamError, type SubscriptionState } from "@streamotter/client";
import { channelVersions, type AppChannels, type OrderState } from "../generated/streamotter.generated.ts";
import { currentToken, gatewayOrigin, signIn, type Session } from "./session.ts";

const ClientContext = createContext<Client<AppChannels> | null>(null);

function StreamOtterProvider({ session, children }: { session: Session; children: ReactNode }) {
  const client = useMemo(() => createClient<AppChannels>({ origin: gatewayOrigin(), getToken: () => currentToken(session) }), [session]);
  useEffect(() => () => { void client.close(); }, [client]);
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** Live order state plus the delivery state that says whether it is current. */
function useOrderStatus(orderId: string): { order: OrderState | null; revision: string | null; state: SubscriptionState; error: StreamError | null } {
  const client = useContext(ClientContext);
  const [value, setValue] = useState<{ order: OrderState | null; revision: string | null }>({ order: null, revision: null });
  const [state, setState] = useState<SubscriptionState>("idle");
  const [error, setError] = useState<StreamError | null>(null);
  useEffect(() => {
    if (client === null) return;
    setValue({ order: null, revision: null });
    setError(null);
    const subscription = client.subscribe("orderStatus", { channelVersion: channelVersions.orderStatus, params: { orderId } });
    const offData = subscription.on("data", event => setValue({ order: event.data, revision: event.revision }));
    const offState = subscription.on("state", change => setState(change.state));
    const offError = subscription.on("error", setError);
    return () => {
      offData();
      offState();
      offError();
      void subscription.unsubscribe();
    };
  }, [client, orderId]);
  return { ...value, state, error };
}

function OrderCard({ orderId }: { orderId: string }) {
  const { order, revision, state, error } = useOrderStatus(orderId);
  const live = state === "live";
  return (
    <section className={`panel${live ? "" : " stale"}`} aria-live="polite">
      <div className="row">
        <h2>Order {orderId}</h2>
        <span className={`badge ${live ? "ok" : state === "failed" || state === "resync-required" ? "bad" : "warn"}`}>{live ? "Live" : state}</span>
      </div>
      {order === null ? <p className="muted">{error === null ? "Loading…" : ""}</p> : (
        <div className="order-body">
          <div className="status-title">{order.status}</div>
          <p>{order.note}</p>
          <p className="muted small">{order.progress}% · revision {revision}</p>
        </div>
      )}
      {error !== null && <div className="notice bad" role="alert">{error.code === "FORBIDDEN" ? "You don't have access to this order." : error.message}</div>}
    </section>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { void signIn("alice").then(setSession); }, []);
  if (session === null) return <main><p className="muted">Signing in as Alice (development demo)…</p></main>;
  return (
    <StreamOtterProvider session={session}>
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
