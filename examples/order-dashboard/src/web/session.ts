/** The application's own session handling (development demo sign-in). */
export interface Session {
  user: string;
  name: string;
  token: string;
  expiresAt: string;
}

export async function signIn(user: string): Promise<Session> {
  const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user }) });
  if (!response.ok) throw new Error(`Sign-in failed (${response.status}).`);
  const body = await response.json() as { token: string; expiresAt: string; user: { name: string } };
  return { user, name: body.user.name, token: body.token, expiresAt: body.expiresAt };
}

/** Returns a current token, renewing the session shortly before it expires. */
export async function currentToken(session: Session): Promise<string> {
  if (Date.parse(session.expiresAt) - Date.now() < 60_000) {
    const renewed = await signIn(session.user);
    session.token = renewed.token;
    session.expiresAt = renewed.expiresAt;
  }
  return session.token;
}

export function gatewayOrigin(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="streamotter-gateway-origin"]')?.content ?? "http://127.0.0.1:7400";
}

export function appMode(): "kafka" | "fixture" {
  return document.querySelector<HTMLMetaElement>('meta[name="order-dashboard-mode"]')?.content === "kafka" ? "kafka" : "fixture";
}
