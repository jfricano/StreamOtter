/** Shared secret between the gateway's handlers and the application's internal API (Kafka mode). */
export function internalServiceToken(): string {
  const configured = process.env["ORDER_SERVICE_TOKEN"];
  if (configured !== undefined && configured.length >= 32) return configured;
  if (process.env["NODE_ENV"] === "production") throw new Error("ORDER_SERVICE_TOKEN (at least 32 characters) is required in production.");
  return "order-dashboard-internal-development-token";
}
