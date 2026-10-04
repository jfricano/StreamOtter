/**
 * Handler module for Kafka mode with quarantine-resync:
 *   streamotter dev --config streamotter.kafka-resync.json --handlers dist/server/kafka-resync-handlers.js
 *
 * The Kafka handlers plus the orders source's recovery guard. The gateway refuses a
 * guard for a source without a quarantine-resync policy, so the plain Kafka
 * configuration keeps using kafka-handlers.js.
 */
import type { HandlerRegistry } from "@streamotter/contracts";
import type { AppChannels } from "../generated/streamotter.generated.ts";
import { handlers as kafkaHandlers, recovery } from "./kafka-handlers.ts";

export const handlers: HandlerRegistry<AppChannels> = { ...kafkaHandlers, sources: { orders: recovery } };
