import { assertValidProjectConfig, type ChannelMap, type Gateway, type GatewayOptions, type ProjectConfig } from "@streamotter/contracts";
import { createGatewayRuntime } from "./runtime/gateway.ts";

export type * from "@streamotter/contracts";
export { StreamOtterError, validateProjectConfig } from "@streamotter/contracts";
export { consoleLogger, silentLogger } from "./runtime/util.ts";

/**
 * Validates configuration structure and references synchronously. Secret
 * resolution and connectivity belong to gateway startup. Throws CONFIG_INVALID.
 */
export function defineProject<C extends ChannelMap>(config: ProjectConfig<C>): ProjectConfig<C> {
  assertValidProjectConfig(config);
  return config;
}

/** Constructs a gateway without opening connections; call start() to listen and consume. */
export function createGateway<C extends ChannelMap>(options: GatewayOptions<C>): Gateway {
  return createGatewayRuntime(options).gateway;
}
