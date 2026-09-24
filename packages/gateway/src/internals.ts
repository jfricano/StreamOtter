/**
 * Internal access shared by StreamOtter's own CLI, management server, and tests.
 * Not a stable public API; applications should use createGateway().
 */
export { createGatewayRuntime, getGatewayInternals, type GatewayInternals, type InternalGatewayOptions } from "./runtime/gateway.ts";
