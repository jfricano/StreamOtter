import { assertValidProjectConfig, type ChannelMap, type Gateway, type GatewayOptions, type ProjectConfig } from "@streamotter/contracts";
import { createGatewayRuntime } from "./runtime/gateway.ts";

export type * from "@streamotter/contracts";
export { StreamOtterError, TransientMappingError, validateProjectConfig } from "@streamotter/contracts";
export { consoleLogger, silentLogger } from "./runtime/util.ts";

/**
 * Validates a portable project configuration and returns it typed against the
 * application's channel map.
 *
 * Checks structure, schemas and references synchronously. It never resolves
 * secrets, runs handlers or connects to brokers; those happen in
 * {@link Gateway.start}. The returned value is the same object that was passed in.
 * Use {@link validateProjectConfig} to get the issue list without throwing.
 *
 * @typeParam C - The application's channel map, usually the generated `AppChannels`.
 * @param config - The parsed contents of `streamotter.json`.
 * @returns `config`, unchanged.
 * @throws A StreamOtterError with code CONFIG_INVALID when the configuration is
 * invalid; `details.issues` lists each problem with its path, code and message.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { defineProject } from "@streamotter/gateway";
 * import type { AppChannels } from "./generated/streamotter.generated.js";
 *
 * const config = defineProject<AppChannels>(JSON.parse(await readFile("streamotter.json", "utf8")));
 * ```
 */
export function defineProject<C extends ChannelMap>(config: ProjectConfig<C>): ProjectConfig<C> {
  assertValidProjectConfig(config);
  return config;
}

/**
 * Constructs a gateway without opening any connection.
 *
 * Construction validates the configuration, the handler registry, the mode and
 * the mode's rules: production rejects `development` options, fixture sources
 * and plaintext Kafka connections. Call {@link Gateway.start} to open the
 * listener and source consumers, and {@link Gateway.stop} to shut down. A
 * stopped gateway cannot be restarted; construct a new one.
 *
 * @param options - Configuration, trusted handlers, mode and optional settings.
 * `logger` defaults to {@link consoleLogger}; `configDir`, which resolves relative
 * CA file paths, defaults to the process working directory.
 * @returns The gateway handle.
 * @throws A StreamOtterError with code CONFIG_INVALID when the configuration,
 * handlers, development options, failure-handling or health options are invalid,
 * or when the configuration is not allowed in the requested mode.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { createGateway, defineProject } from "@streamotter/gateway";
 * import type { AppChannels } from "./generated/streamotter.generated.js";
 * import { handlers } from "./handlers.js";
 *
 * const config = defineProject<AppChannels>(JSON.parse(await readFile("streamotter.json", "utf8")));
 * const gateway = createGateway({ config, handlers, mode: "production" });
 * const { origin, path } = await gateway.start();
 * process.once("SIGTERM", () => void gateway.stop());
 * ```
 */
export function createGateway<C extends ChannelMap>(options: GatewayOptions<C>): Gateway {
  return createGatewayRuntime(options).gateway;
}
