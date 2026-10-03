/**
 * Internal access shared by StreamOtter's own CLI, management server, and tests.
 * Not a stable public API; applications should use createGateway().
 */
export { createGatewayRuntime, getGatewayInternals, type GatewayInternals, type InternalGatewayOptions } from "./runtime/gateway.ts";
export { FAILURE_CAPABILITIES, failureHandlingIssues, failureOptionIssues, nodeSupportsJournal, type FailureCapabilities } from "./failures/validate.ts";
export { MemoryIncidentStore, type IncidentRecord, type IncidentStore, type RawEvidence } from "./failures/store.ts";
export { evidenceHash } from "./failures/evidence.ts";
export { SqliteIncidentStore, initJournal, openJournal } from "./failures/journal.ts";
export { KafkaQuarantineReader, KafkaQuarantineWriter } from "./failures/quarantine.ts";
export type { QuarantineRead } from "./failures/quarantine.ts";
export type { ResolvedKafkaConnection } from "./sources/kafka.ts";
export { rebaselineSource } from "./failures/rebaseline.ts";
