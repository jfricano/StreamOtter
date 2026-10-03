import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  initJournal, JOURNAL_SCHEMA_VERSION, nodeSqliteSupported, openJournal, type JournalLimits, type JournalLock
} from "../src/failures/journal.ts";
import {
  MAX_EVENTS_PER_INCIDENT, MemoryIncidentStore,
  type GuardResult, type IncidentRecord, type IncidentStore, type NewObservation, type PrepareAdvance, type RawEvidence, type SourceIdentity,
  type StoredBoundary
} from "../src/failures/store.ts";
import type { Json } from "@streamotter/contracts";

const PROJECT = "order-dashboard";
const SOURCES: SourceIdentity[] = [
  { sourceId: "orders", generation: "g1", kind: "kafka" },
  { sourceId: "payments", generation: "g1", kind: "kafka" }
];
/** Below the D1 floor the journal refuses to load node:sqlite, so its suites are skipped rather than failed. */
const SQLITE_SKIP = nodeSqliteSupported(process.versions.node) ? false : `node:sqlite needs Node >= 24.15 (D1); this is ${process.versions.node}`;
function rawDatabase(path: string): import("node:sqlite").DatabaseSync {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(path);
}
const JOURNAL_MODULE = pathToFileURL(fileURLToPath(new URL("../src/failures/journal.ts", import.meta.url))).href;

const temporary: string[] = [];
after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

/** A fresh state directory path (not yet created) inside a temp parent. */
function stateDirectory(): string {
  const parent = mkdtempSync(join(tmpdir(), "streamotter-journal-"));
  temporary.push(parent);
  return join(parent, "state");
}

function freshJournal(limits: JournalLimits = {}): { directory: string; store: ReturnType<typeof openJournal> } {
  const directory = stateDirectory();
  initJournal(directory, PROJECT, SOURCES);
  return { directory, store: openJournal(directory, limits) };
}

function observation(failureId: string, overrides: Partial<NewObservation> = {}): NewObservation {
  return {
    failureId,
    sourceId: "orders",
    generation: "g1",
    position: { kind: "kafka", topic: "orders", partition: 0, offset: "42" },
    clusterId: "cluster-a",
    timestamp: "2026-10-03T00:00:00.000Z",
    failureClass: "invalid-json",
    stage: "validate",
    errorCode: "INVALID_PAYLOAD",
    channel: null,
    policy: "quarantine-hold",
    diagnosis: "Unexpected token",
    evidence: { location: "local", completeness: "complete", valueBytes: 3, keyBytes: null, headerCount: 0, hash: "sha256:aa" },
    fingerprints: { config: "c1", handlerBuildId: "unspecified", policyRevision: "p1", gatewayVersion: "1.1.0" },
    observedAt: "2026-10-03T00:00:00.000Z",
    ...overrides
  };
}

function hex(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : Buffer.from(bytes).toString("hex");
}

function comparable(evidence: RawEvidence | null): unknown {
  if (evidence === null) return null;
  return { key: hex(evidence.key), value: hex(evidence.value), headers: evidence.headers.map(header => [header.name, hex(header.value)]) };
}

function allPages(store: IncidentStore, query: Parameters<IncidentStore["list"]>[0]): IncidentRecord[] {
  const items: IncidentRecord[] = [];
  let cursor: string | null | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = store.list(cursor === undefined || cursor === null ? query : { ...query, cursor });
    assert.ok(page.items.length <= (query.limit ?? 50));
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  assert.fail("pagination did not terminate");
}

const GUARD: GuardResult = { decision: "recoverable", reason: null, evidenceRef: "outbox:42", at: "2026-10-03T00:01:00.000Z" };

function advance(failureId: string, expectedRevision: number, boundaryId: string, expectedPrior: string | null, context: Json, at = "2026-10-03T00:01:00.000Z"): PrepareAdvance {
  return { failureId, expectedRevision, boundary: { boundaryId, context, expectedPrior }, guard: { ...GUARD, at }, at };
}

/** Everything recovery state touches, for asserting that a refused call wrote nothing. */
function recoveryState(store: IncidentStore, failureIds: readonly string[], boundaryIds: readonly string[]): unknown {
  return {
    incidents: failureIds.map(id => [store.get(id), store.events(id)]),
    boundaries: boundaryIds.map(id => store.getBoundary(id)),
    inForce: SOURCES.map(source => store.boundary(source.sourceId)),
    circuits: SOURCES.map(source => store.circuit(source.sourceId))
  };
}

/** Matches a StreamOtterError by reason and, when given, details.status. */
function rejects(reason: string, status?: number): (error: unknown) => boolean {
  return (error: unknown) => {
    const actual = error as { code?: string; details?: { reason?: string; status?: number }; message?: string };
    assert.equal(actual.code, "INVALID_REQUEST", actual.message);
    assert.equal(actual.details?.reason, reason, actual.message);
    if (status !== undefined) assert.equal(actual.details?.status, status, actual.message);
    return true;
  };
}

function notFound(error: unknown): boolean {
  const actual = error as { code?: string; details?: { status?: number } };
  return actual.code === "INVALID_REQUEST" && actual.details?.status === 404;
}

/** The behavior every IncidentStore must share, run against the memory store and the journal. */
function conformance(name: string, create: (limits?: JournalLimits) => IncidentStore, skip: string | false = false): void {
  describe(`incident store conformance: ${name}`, { skip }, () => {
    it("creates, counts duplicates, flags conflicts, and reopens resolved incidents", () => {
      const store = create();
      const first = store.observe(observation("f1:a"));
      assert.equal(first.created, true);
      assert.equal(first.conflict, false);
      assert.equal(first.record.revision, 1);
      assert.equal(first.record.state, "open");
      assert.equal(first.record.progress, "held");
      assert.equal(first.record.quarantine, "not-required");
      assert.equal(first.record.observations, 1);
      assert.deepEqual(store.get("f1:a"), first.record);

      const again = store.observe(observation("f1:a", { observedAt: "2026-10-03T00:00:01.000Z", diagnosis: "Still bad", failureClass: "payload-schema" }));
      assert.equal(again.created, false);
      assert.equal(again.conflict, false);
      assert.equal(again.record.revision, 2);
      assert.equal(again.record.observations, 2);
      assert.equal(again.record.firstObservedAt, "2026-10-03T00:00:00.000Z");
      assert.equal(again.record.lastObservedAt, "2026-10-03T00:00:01.000Z");
      assert.equal(again.record.diagnosis, "Still bad");
      assert.equal(again.record.failureClass, "payload-schema");

      const conflicting = store.observe(observation("f1:a", {
        observedAt: "2026-10-03T00:00:02.000Z", diagnosis: "Different bytes",
        evidence: { location: "local", completeness: "complete", valueBytes: 4, keyBytes: null, headerCount: 0, hash: "sha256:bb" }
      }));
      assert.equal(conflicting.conflict, true);
      assert.equal(conflicting.record.revision, 3);
      assert.equal(conflicting.record.diagnosis, "Still bad", "a conflicting observation does not overwrite the diagnosis");
      assert.equal(conflicting.record.evidence.hash, "sha256:aa", "nor the stored evidence summary");

      const noHash = store.observe(observation("f1:a", { observedAt: "2026-10-03T00:00:03.000Z", evidence: { location: "none", completeness: "unavailable", valueBytes: null, keyBytes: null, headerCount: 0, hash: "" } }));
      assert.equal(noHash.conflict, false, "an observation without a hash cannot conflict");

      const resolved = store.update("f1:a", 4, { state: "resolved", resolution: "redriven", progress: "processed" }, { event: "resolved", detail: "ok", operationId: "op-1", at: "2026-10-03T00:00:04.000Z" });
      assert.equal(resolved.revision, 5);
      assert.equal(resolved.updatedAt, "2026-10-03T00:00:04.000Z");
      const reopened = store.observe(observation("f1:a", { observedAt: "2026-10-03T00:00:05.000Z" }));
      assert.equal(reopened.created, false);
      assert.equal(reopened.record.state, "open");
      assert.equal(reopened.record.resolution, null);
      assert.equal(reopened.record.progress, "held");
      assert.equal(reopened.record.revision, 6);
      assert.equal(reopened.record.observations, 5);

      assert.deepEqual(store.events("f1:a").map(event => [event.event, event.detail, event.operationId]), [
        ["detected", "invalid-json", null],
        ["detected", "payload-schema", null],
        ["detected", "evidence-conflict", null],
        ["detected", "invalid-json", null],
        ["resolved", "ok", "op-1"],
        ["detected", "invalid-json", null]
      ]);
      assert.deepEqual(store.events("f1:a", 2).map(event => event.event), ["resolved", "detected"]);
      assert.deepEqual(store.events("f1:missing"), []);
      assert.equal(store.get("f1:missing"), null);
      store.close();
    });

    it("applies transitions only at the expected revision", () => {
      const store = create();
      store.observe(observation("f1:a"));
      store.observe(observation("f1:a"));
      assert.throws(() => store.update("f1:a", 1, { quarantine: "pending" }, { event: "captured", detail: null, operationId: null }),
        (error: { code?: string; details?: { reason?: string; status?: number } }) => error.code === "INVALID_REQUEST" && error.details?.reason === "stale-revision" && error.details.status === 409);
      assert.equal(store.get("f1:a")?.quarantine, "not-required", "a stale update changes nothing");
      assert.equal(store.events("f1:a").length, 2);
      const updated = store.update("f1:a", 2, { quarantine: "acknowledged", quarantineCoordinates: { partition: 3, offset: "17" } }, { event: "quarantined", detail: null, operationId: null });
      assert.equal(updated.revision, 3);
      assert.deepEqual(store.get("f1:a")?.quarantineCoordinates, { partition: 3, offset: "17" });
      assert.throws(() => store.update("f1:missing", 1, {}, { event: "operator", detail: null, operationId: null }),
        (error: { code?: string; details?: { status?: number } }) => error.code === "INVALID_REQUEST" && error.details?.status === 404);
      store.close();
    });

    it("pages and filters incidents in first-observed order", () => {
      const store = create();
      for (let i = 0; i < 7; i++) store.observe(observation(`f1:${i}`, { sourceId: i % 2 === 0 ? "orders" : "payments", position: { kind: "kafka", topic: "t", partition: 0, offset: String(i) } }));
      store.update("f1:2", 1, { state: "resolved", resolution: "done" }, { event: "resolved", detail: null, operationId: null });
      const ids = (records: IncidentRecord[]): string[] => records.map(record => record.failureId);
      assert.deepEqual(ids(allPages(store, { limit: 2 })), ["f1:0", "f1:1", "f1:3", "f1:4", "f1:5", "f1:6"], "default state is open");
      assert.deepEqual(ids(allPages(store, { limit: 3, state: "all" })), ["f1:0", "f1:1", "f1:2", "f1:3", "f1:4", "f1:5", "f1:6"]);
      assert.deepEqual(ids(allPages(store, { limit: 1, state: "resolved" })), ["f1:2"]);
      assert.deepEqual(ids(allPages(store, { limit: 2, sourceId: "orders", state: "all" })), ["f1:0", "f1:2", "f1:4", "f1:6"]);
      assert.deepEqual(ids(allPages(store, { limit: 2, sourceId: "payments" })), ["f1:1", "f1:3", "f1:5"]);
      assert.deepEqual(ids(allPages(store, { sourceId: "nobody" })), []);
      const first = store.list({ limit: 6 });
      assert.equal(first.items.length, 6);
      assert.equal(store.list({ limit: 200, state: "all" }).nextCursor, null);
      assert.throws(() => store.list({ cursor: "not-a-cursor" }), { code: "INVALID_REQUEST" });
      assert.throws(() => store.list({ limit: 0 }), { code: "INVALID_REQUEST" });
      assert.throws(() => store.list({ limit: 201 }), { code: "INVALID_REQUEST" });
      assert.deepEqual(ids(store.open("orders")), ["f1:0", "f1:4", "f1:6"], "open(): oldest first, resolved excluded");
      assert.deepEqual(ids(store.open("payments")), ["f1:1", "f1:3", "f1:5"]);
      store.close();
    });

    it("keeps only the newest events of an incident", () => {
      const store = create();
      store.observe(observation("f1:a"));
      for (let i = 0; i < MAX_EVENTS_PER_INCIDENT + 5; i++) {
        store.update("f1:a", i + 1, {}, { event: "operator", detail: `u${i}`, operationId: null });
      }
      const events = store.events("f1:a");
      assert.equal(events.length, MAX_EVENTS_PER_INCIDENT);
      assert.equal(events[0]?.detail, "u5");
      assert.equal(events.at(-1)?.detail, `u${MAX_EVENTS_PER_INCIDENT + 4}`);
      assert.deepEqual(store.events("f1:a", 3).map(event => event.detail), ["u202", "u203", "u204"]);
      store.close();
    });

    it("round-trips raw evidence bytes exactly", () => {
      const store = create();
      const binary: RawEvidence = {
        key: null,
        value: new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]),
        headers: [
          { name: "trace", value: Buffer.from("one") },
          { name: "bin", value: new Uint8Array([0x00, 0xff, 0xc0]) },
          { name: "trace", value: Buffer.from("two") },
          { name: "empty", value: new Uint8Array(0) },
          { name: "naïve-ключ", value: Buffer.from("three") }
        ]
      };
      store.putEvidence("f1:a", binary);
      assert.deepEqual(comparable(store.getEvidence("f1:a")), comparable(binary));
      const tombstone: RawEvidence = { key: Buffer.from("order-7"), value: null, headers: [] };
      store.putEvidence("f1:b", tombstone);
      assert.deepEqual(comparable(store.getEvidence("f1:b")), { key: hex(Buffer.from("order-7")), value: null, headers: [] });
      const empties: RawEvidence = { key: new Uint8Array(0), value: new Uint8Array(0), headers: [] };
      store.putEvidence("f1:c", empties);
      assert.deepEqual(comparable(store.getEvidence("f1:c")), { key: "", value: "", headers: [] }, "empty bytes are not null");
      assert.equal(store.getEvidence("f1:missing"), null);
      store.deleteEvidence("f1:a");
      assert.equal(store.getEvidence("f1:a"), null);
      store.deleteEvidence("f1:a");
      assert.equal(store.usage().spoolBytes, Buffer.byteLength("order-7"));
      store.close();
    });

    it("refuses evidence past the spool budget without evicting anything", () => {
      const store = create({ spoolLimitBytes: 1_000 });
      store.putEvidence("f1:a", { key: null, value: new Uint8Array(600), headers: [] });
      assert.throws(() => store.putEvidence("f1:b", { key: null, value: new Uint8Array(500), headers: [] }),
        (error: { code?: string; details?: { reason?: string } }) => error.code === "OVERLOADED" && error.details?.reason === "journal-full");
      assert.equal(store.getEvidence("f1:b"), null);
      assert.equal(store.getEvidence("f1:a")?.value?.byteLength, 600, "nothing was evicted");
      store.putEvidence("f1:a", { key: null, value: new Uint8Array(900), headers: [{ name: "h", value: new Uint8Array(9) }] });
      assert.equal(store.usage().spoolBytes, 910, "a replacement counts only the new copy");
      assert.equal(store.usage().spoolLimitBytes, 1_000);
      store.deleteEvidence("f1:a");
      store.putEvidence("f1:b", { key: null, value: new Uint8Array(500), headers: [] });
      store.close();
    });

    it("prepares an advance: boundary in force, incident advance-pending, event and circuit together", () => {
      const store = create();
      store.claim(PROJECT, SOURCES);
      const observed = store.observe(observation("f1:a")).record;
      assert.equal(observed.guard, null, "a new incident has no guard result");
      assert.equal(observed.boundaryId, null, "nor a boundary");
      assert.equal(store.boundary("orders"), null);
      assert.equal(store.getBoundary("rb1:one"), null);

      const at = "2026-10-03T00:01:00.000Z";
      const { record, boundary } = store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, { z: 1, a: [1, { y: true, b: null }] }, at));
      const expected: StoredBoundary = {
        boundaryId: "rb1:one", sourceId: "orders", generation: "g1", context: { a: [1, { b: null, y: true }], z: 1 }, revision: 1,
        state: "in-force", failureIds: ["f1:a"], supersedes: null, createdAt: at, retiredAt: null, retirement: null
      };
      assert.deepEqual(boundary, expected);
      assert.equal(JSON.stringify(boundary.context), '{"a":[1,{"b":null,"y":true}],"z":1}', "context is canonical JSON");
      assert.deepEqual(store.boundary("orders"), expected);
      assert.deepEqual(store.getBoundary("rb1:one"), expected);
      assert.equal(store.boundary("payments"), null, "boundaries are per source");

      assert.equal(record.revision, 2);
      assert.equal(record.progress, "advance-pending");
      assert.equal(record.recovery, "boundary-in-force");
      assert.equal(record.state, "open");
      assert.deepEqual(record.guard, GUARD);
      assert.equal(record.boundaryId, "rb1:one");
      assert.equal(record.updatedAt, at);
      assert.deepEqual(store.get("f1:a"), record);
      assert.deepEqual(store.events("f1:a").at(-1), { at, event: "advance-pending", detail: "rb1:one", operationId: null });
      assert.deepEqual(store.circuit("orders"), { sourceId: "orders", state: "closed", advances: [at], openedAt: null, reason: null, revision: 1 });
      assert.equal(store.circuit("payments").revision, 0);

      // The patchable fields go through update() like any other.
      const patched = store.update("f1:a", 2, { guard: { ...GUARD, decision: "hold", reason: "watermark behind" }, boundaryId: null }, { event: "operator", detail: null, operationId: null });
      assert.equal(patched.guard?.decision, "hold");
      assert.equal(store.get("f1:a")?.boundaryId, null);
      store.close();
    });

    it("refuses an advance without writing anything", () => {
      const store = create();
      store.claim(PROJECT, SOURCES);
      store.observe(observation("f1:a"));
      store.observe(observation("f1:b", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "43" } }));
      store.observe(observation("f1:done", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "44" } }));
      store.update("f1:done", 1, { state: "resolved", resolution: "processed", progress: "processed" }, { event: "resolved", detail: null, operationId: null });
      store.observe(observation("f1:old", { generation: "g0", position: { kind: "kafka", topic: "orders", partition: 0, offset: "45" } }));
      store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, { watermark: 1 }));
      const ids = ["f1:a", "f1:b", "f1:done", "f1:old"];
      const boundaries = ["rb1:one", "rb1:two"];
      const before = recoveryState(store, ids, boundaries);

      const attempts: [string, () => unknown, (error: unknown) => boolean][] = [
        ["unknown incident", () => store.prepareAdvance(advance("f1:missing", 1, "rb1:two", "rb1:one", {})), notFound],
        ["stale incident revision", () => store.prepareAdvance(advance("f1:b", 2, "rb1:two", "rb1:one", {})), rejects("stale-revision", 409)],
        ["resolved incident", () => store.prepareAdvance(advance("f1:done", 2, "rb1:two", "rb1:one", {})), rejects("incident-resolved", 409)],
        ["prior named as none", () => store.prepareAdvance(advance("f1:b", 1, "rb1:two", null, {})), rejects("stale-revision", 409)],
        ["wrong prior", () => store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:other", {})), rejects("stale-revision", 409)],
        ["boundary ID reused", () => store.prepareAdvance(advance("f1:b", 1, "rb1:one", "rb1:one", {})), rejects("boundary-exists", 409)],
        ["incident of an earlier generation", () => store.prepareAdvance(advance("f1:old", 1, "rb1:two", "rb1:one", {})), rejects("generation-changed", 409)],
        ["context over 16 KiB", () => store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:one", { pad: "x".repeat(16_384) })), rejects("context-too-large", 400)],
        ["context not JSON", () => store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:one", { bad: Number.NaN })), rejects("context-not-json", 400)],
        ["guard reason over 512 characters", () => store.prepareAdvance({ ...advance("f1:b", 1, "rb1:two", "rb1:one", {}), guard: { ...GUARD, reason: "r".repeat(513) } }),
          rejects("guard-text-too-long", 400)]
      ];
      for (const [label, attempt, match] of attempts) {
        assert.throws(attempt, match, label);
        assert.deepEqual(recoveryState(store, ids, boundaries), before, `${label}: nothing was written`);
      }
      // The same request with the right prior goes through.
      store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:one", {}));
      assert.equal(store.boundary("orders")?.boundaryId, "rb1:two");
      store.close();
    });

    it("supersedes the prior boundary and carries its incidents forward", () => {
      const store = create();
      store.claim(PROJECT, SOURCES);
      store.observe(observation("f1:a"));
      store.observe(observation("f1:b", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "50" } }));
      store.observe(observation("f1:c", { position: { kind: "kafka", topic: "orders", partition: 1, offset: "7" } }));
      store.observe(observation("f1:p", { sourceId: "payments" }));
      const t1 = "2026-10-03T00:01:00.000Z";
      const t2 = "2026-10-03T00:02:00.000Z";
      const t3 = "2026-10-03T00:03:00.000Z";
      store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, { watermark: 1 }, t1));
      store.prepareAdvance(advance("f1:p", 1, "rb1:pay", null, { watermark: 9 }, t1));
      const second = store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:one", { watermark: 2 }, t2));
      assert.deepEqual(second.boundary.failureIds, ["f1:a", "f1:b"], "cumulative, oldest first");
      assert.equal(second.boundary.supersedes, "rb1:one");
      assert.deepEqual(store.getBoundary("rb1:one"), {
        boundaryId: "rb1:one", sourceId: "orders", generation: "g1", context: { watermark: 1 }, revision: 2, state: "superseded",
        failureIds: ["f1:a"], supersedes: null, createdAt: t1, retiredAt: t2, retirement: { mode: "superseded", reason: null, operationId: null }
      });
      const third = store.prepareAdvance(advance("f1:c", 1, "rb1:three", "rb1:two", { watermark: 3 }, t3));
      assert.deepEqual(third.boundary.failureIds, ["f1:a", "f1:b", "f1:c"]);
      assert.equal(store.getBoundary("rb1:two")?.state, "superseded");
      assert.deepEqual(store.boundary("orders"), third.boundary);
      assert.equal(store.get("f1:a")?.boundaryId, "rb1:one", "each incident keeps the boundary its advance installed");
      assert.equal(store.get("f1:b")?.boundaryId, "rb1:two");
      assert.deepEqual(store.circuit("orders").advances, [t1, t2, t3]);
      assert.equal(store.circuit("orders").revision, 3);
      assert.deepEqual(store.boundary("payments")?.failureIds, ["f1:p"], "another source's chain is independent");
      assert.deepEqual(store.circuit("payments").advances, [t1]);
      store.close();
    });

    it("retires a boundary only at its revision and never while its incident is held", () => {
      const store = create();
      store.claim(PROJECT, SOURCES);
      store.observe(observation("f1:a"));
      store.observe(observation("f1:b", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "43" } }));
      store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, {}));
      store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:one", {}));
      const operator = { mode: "operator" as const, reason: "verified manual repair", operationId: "op-7" };
      const ids = ["f1:a", "f1:b"];
      const boundaries = ["rb1:one", "rb1:two"];

      store.update("f1:a", 2, { progress: "held" }, { event: "held", detail: null, operationId: null });
      let before = recoveryState(store, ids, boundaries);
      assert.throws(() => store.retireBoundary("rb1:two", 1, operator), (error: unknown) => {
        rejects("incident-held", 409)(error);
        assert.equal((error as { details?: { failureId?: string } }).details?.failureId, "f1:a");
        return true;
      });
      assert.deepEqual(recoveryState(store, ids, boundaries), before, "a refused retirement writes nothing");
      store.update("f1:a", 3, { progress: "retrying" }, { event: "retrying", detail: null, operationId: null });
      assert.throws(() => store.retireBoundary("rb1:two", 1, operator), rejects("incident-held", 409));
      store.update("f1:a", 4, { progress: "advanced" }, { event: "advance-confirmed", detail: null, operationId: null });

      before = recoveryState(store, ids, boundaries);
      assert.throws(() => store.retireBoundary("rb1:two", 2, operator), rejects("stale-revision", 409));
      assert.throws(() => store.retireBoundary("rb1:one", 2, operator), rejects("boundary-not-in-force", 409), "a superseded boundary cannot be retired");
      assert.throws(() => store.retireBoundary("rb1:two", 1, { mode: "superseded", reason: null, operationId: null }), rejects("retirement-mode", 400));
      assert.throws(() => store.retireBoundary("rb1:missing", 1, operator), notFound);
      assert.deepEqual(recoveryState(store, ids, boundaries), before);

      const at = "2026-10-03T00:05:00.000Z";
      const retired = store.retireBoundary("rb1:two", 1, operator, at);
      assert.equal(retired.state, "retired");
      assert.equal(retired.revision, 2);
      assert.equal(retired.retiredAt, at);
      assert.deepEqual(retired.retirement, operator);
      assert.deepEqual(store.getBoundary("rb1:two"), retired);
      assert.equal(store.boundary("orders"), null);
      assert.equal(store.getBoundary("rb1:one")?.state, "superseded", "the chain behind it is untouched");
      assert.throws(() => store.retireBoundary("rb1:two", 2, operator), rejects("boundary-not-in-force", 409));

      // With nothing in force, the next advance names no prior.
      store.observe(observation("f1:c", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "60" } }));
      assert.equal(store.prepareAdvance(advance("f1:c", 1, "rb1:three", null, {})).boundary.supersedes, null);
      store.close();
    });

    it("keeps a circuit per source with a revision and at most 20 advances", () => {
      const store = create();
      store.claim(PROJECT, SOURCES);
      assert.deepEqual(store.circuit("orders"), { sourceId: "orders", state: "closed", advances: [], openedAt: null, reason: null, revision: 0 });
      const opened = store.updateCircuit("orders", 0, { state: "open", advances: ["2026-10-03T00:00:01.000Z"], openedAt: "2026-10-03T00:00:02.000Z", reason: "5 advances in 60 s" });
      assert.deepEqual(opened, { sourceId: "orders", state: "open", advances: ["2026-10-03T00:00:01.000Z"], openedAt: "2026-10-03T00:00:02.000Z", reason: "5 advances in 60 s", revision: 1 });
      assert.deepEqual(store.circuit("orders"), opened);
      assert.throws(() => store.updateCircuit("orders", 0, { state: "closed", advances: [], openedAt: null, reason: null }), rejects("stale-revision", 409));
      assert.throws(() => store.updateCircuit("orders", 1, { state: "half-open" as "open", advances: [], openedAt: null, reason: null }), rejects("circuit-state", 400));
      assert.deepEqual(store.circuit("orders"), opened, "a refused update changes nothing");
      assert.equal(store.circuit("payments").revision, 0, "circuits are per source");

      const times = Array.from({ length: 25 }, (_, i) => `2026-10-03T00:00:${String(i + 10).padStart(2, "0")}.000Z`);
      const capped = store.updateCircuit("orders", 1, { state: "closed", advances: times, openedAt: null, reason: "operator reopened" });
      assert.deepEqual(capped.advances, times.slice(5), "the oldest entries are dropped");
      assert.equal(capped.revision, 2);

      store.observe(observation("f1:a"));
      store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, {}, "2026-10-03T00:01:00.000Z"));
      const after = store.circuit("orders");
      assert.equal(after.advances.length, 20);
      assert.equal(after.advances[0], times[6]);
      assert.equal(after.advances.at(-1), "2026-10-03T00:01:00.000Z");
      assert.equal(after.revision, 3);
      assert.equal(after.reason, "operator reopened", "an advance only appends");
      store.close();
    });

    it("retires the boundary of a source whose generation changed on claim", () => {
      const store = create();
      store.claim(PROJECT, SOURCES);
      store.observe(observation("f1:a"));
      store.observe(observation("f1:p", { sourceId: "payments" }));
      store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, {}));
      store.prepareAdvance(advance("f1:p", 1, "rb1:pay", null, {}));
      store.update("f1:a", 2, { state: "resolved", resolution: "advanced", progress: "advanced" }, { event: "resolved", detail: null, operationId: null });
      store.update("f1:p", 2, { state: "resolved", resolution: "advanced", progress: "advanced" }, { event: "resolved", detail: null, operationId: null });

      store.claim(PROJECT, SOURCES);
      assert.equal(store.boundary("orders")?.boundaryId, "rb1:one", "an unchanged generation keeps its boundary");

      store.claim(PROJECT, [{ sourceId: "orders", generation: "g2", kind: "kafka" }, SOURCES[1]!]);
      assert.equal(store.boundary("orders"), null);
      const retired = store.getBoundary("rb1:one");
      assert.equal(retired?.state, "retired");
      assert.equal(retired?.revision, 2);
      assert.equal(retired?.retirement?.mode, "generation");
      assert.equal(retired?.retirement?.operationId, null);
      assert.ok(retired?.retiredAt !== null);
      assert.equal(store.boundary("payments")?.boundaryId, "rb1:pay", "other sources keep theirs");

      store.observe(observation("f1:new", { generation: "g2" }));
      assert.equal(store.prepareAdvance(advance("f1:new", 1, "rb1:g2", null, {})).boundary.generation, "g2");
      store.close();
    });
  });
}

conformance("memory", limits => new MemoryIncidentStore(limits?.spoolLimitBytes === undefined ? {} : { spoolLimitBytes: limits.spoolLimitBytes }));
conformance("sqlite", limits => freshJournal(limits).store, SQLITE_SKIP);

function refusal(reason: string, code?: string): (error: unknown) => boolean {
  return (error: unknown) => {
    const actual = error as { code?: string; details?: { reason?: string }; message?: string };
    assert.equal(actual.details?.reason, reason, actual.message);
    if (code !== undefined) assert.equal(actual.code, code);
    return true;
  };
}

describe("sqlite journal", { skip: SQLITE_SKIP }, () => {
  it("creates a protected journal and never overwrites one", () => {
    const directory = stateDirectory();
    const path = initJournal(directory, PROJECT, SOURCES);
    assert.equal(path, join(directory, "journal.sqlite"));
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, "run")).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const before = readFileSync(path);
    assert.throws(() => initJournal(directory, PROJECT, SOURCES), refusal("journal-exists", "CONFIG_INVALID"));
    assert.ok(readFileSync(path).equals(before), "the existing journal is untouched");
    assert.throws(() => initJournal(stateDirectory(), PROJECT, [SOURCES[0]!, SOURCES[0]!]), refusal("duplicate-source"));
  });

  it("keeps incidents, events, evidence and revisions across close and reopen", () => {
    const { directory, store } = freshJournal();
    store.observe(observation("f1:a"));
    store.observe(observation("f1:a", { observedAt: "2026-10-03T00:00:01.000Z" }));
    store.update("f1:a", 2, { quarantine: "acknowledged", quarantineCoordinates: { partition: 1, offset: "9" } }, { event: "quarantined", detail: null, operationId: "op-1" });
    store.observe(observation("f1:b", { sourceId: "payments" }));
    const evidence: RawEvidence = { key: new Uint8Array([1, 2]), value: new Uint8Array([0xff, 0x00]), headers: [{ name: "x", value: new Uint8Array([7]) }, { name: "x", value: new Uint8Array([8]) }] };
    store.putEvidence("f1:a", evidence);
    const record = store.get("f1:a");
    const events = store.events("f1:a");
    store.close();
    assert.equal(existsSync(join(directory, "journal.lock")), false, "close releases the lock");

    const reopened = openJournal(directory);
    reopened.claim(PROJECT, SOURCES);
    assert.deepEqual(reopened.get("f1:a"), record);
    assert.equal(reopened.get("f1:a")?.revision, 3);
    assert.deepEqual(reopened.events("f1:a"), events);
    assert.deepEqual(comparable(reopened.getEvidence("f1:a")), comparable(evidence));
    assert.deepEqual(reopened.open("payments").map(item => item.failureId), ["f1:b"]);
    assert.throws(() => reopened.update("f1:a", 2, {}, { event: "operator", detail: null, operationId: null }), { code: "INVALID_REQUEST" });
    const usage = reopened.usage();
    assert.equal(usage.schemaVersion, JOURNAL_SCHEMA_VERSION);
    assert.ok(usage.sizeBytes > 0 && usage.sizeBytes <= usage.limitBytes);
    assert.equal(usage.spoolBytes, 8, "key 2 + value 2 + two headers of name 1 and value 1");
    reopened.close();
    reopened.close();
    assert.throws(() => reopened.get("f1:a"), refusal("journal-closed"));
  });

  it("keeps boundaries, guard results and circuits across close and reopen", () => {
    const { directory, store } = freshJournal();
    store.claim(PROJECT, SOURCES);
    store.observe(observation("f1:a"));
    store.observe(observation("f1:b", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "43" } }));
    store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, { watermark: 1, nested: { é: "ü" } }, "2026-10-03T00:01:00.000Z"));
    store.prepareAdvance(advance("f1:b", 1, "rb1:two", "rb1:one", { watermark: 2 }, "2026-10-03T00:02:00.000Z"));
    store.updateCircuit("payments", 0, { state: "open", advances: [], openedAt: "2026-10-03T00:03:00.000Z", reason: "operator" });
    const before = recoveryState(store, ["f1:a", "f1:b"], ["rb1:one", "rb1:two"]);
    store.close();

    const reopened = openJournal(directory);
    reopened.claim(PROJECT, SOURCES);
    assert.deepEqual(recoveryState(reopened, ["f1:a", "f1:b"], ["rb1:one", "rb1:two"]), before);
    assert.equal(reopened.boundary("orders")?.boundaryId, "rb1:two");
    assert.deepEqual(reopened.get("f1:b")?.guard, { ...GUARD, at: "2026-10-03T00:02:00.000Z" });
    assert.equal(reopened.circuit("payments").state, "open");
    // A stale prior is still refused after a restart.
    reopened.observe(observation("f1:c", { position: { kind: "kafka", topic: "orders", partition: 0, offset: "44" } }));
    assert.throws(() => reopened.prepareAdvance(advance("f1:c", 1, "rb1:three", "rb1:one", {})), rejects("stale-revision", 409));
    reopened.close();
  });

  it("leaves the boundary in force when claim refuses a generation change", () => {
    const { store } = freshJournal();
    store.claim(PROJECT, SOURCES);
    store.observe(observation("f1:a"));
    store.prepareAdvance(advance("f1:a", 1, "rb1:one", null, {}));
    assert.throws(() => store.claim(PROJECT, [{ sourceId: "orders", generation: "g2", kind: "kafka" }, SOURCES[1]!]),
      refusal("generation-changed-with-open-incidents", "SOURCE_UNAVAILABLE"));
    assert.equal(store.boundary("orders")?.state, "in-force");
    assert.equal(store.getBoundary("rb1:one")?.revision, 1);
    assert.throws(() => store.updateCircuit("never-claimed", 0, { state: "open", advances: [], openedAt: null, reason: null }), refusal("source-not-claimed"));
    assert.equal(store.circuit("never-claimed").revision, 0);
    store.close();
  });

  it("checks project and source identity on claim", () => {
    const { store } = freshJournal();
    assert.throws(() => store.claim("other-project", SOURCES), refusal("project-mismatch", "SOURCE_UNAVAILABLE"));
    store.claim(PROJECT, SOURCES);

    // A new source is added; nothing open means a generation change is recorded.
    store.claim(PROJECT, [...SOURCES, { sourceId: "refunds", generation: "g1", kind: "fixture" }]);
    store.claim(PROJECT, [{ sourceId: "orders", generation: "g2", kind: "kafka" }, SOURCES[1]!, { sourceId: "refunds", generation: "g1", kind: "fixture" }]);
    store.observe(observation("f1:refund", { sourceId: "refunds", generation: "g1", position: { kind: "fixture", index: "0" } }));
    store.observe(observation("f1:order", { generation: "g2" }));

    // An open incident pins the source's generation and keeps it configured.
    const orders: SourceIdentity = { sourceId: "orders", generation: "g2", kind: "kafka" };
    const payments: SourceIdentity = SOURCES[1]!;
    const refunds: SourceIdentity = { sourceId: "refunds", generation: "g1", kind: "fixture" };
    const current = [orders, payments, refunds];
    assert.throws(() => store.claim(PROJECT, [{ ...orders, generation: "g3" }, payments, refunds]),
      refusal("generation-changed-with-open-incidents", "SOURCE_UNAVAILABLE"));
    assert.throws(() => store.claim(PROJECT, [orders, payments]), refusal("source-removed-with-open-incidents", "SOURCE_UNAVAILABLE"));
    assert.throws(() => store.claim(PROJECT, [...current, orders]), refusal("duplicate-source"));
    store.claim(PROJECT, current);

    // Once resolved, the source may change generation or leave the configuration.
    store.update("f1:order", 1, { state: "resolved", resolution: "done" }, { event: "resolved", detail: null, operationId: null });
    store.update("f1:refund", 1, { state: "resolved", resolution: "done" }, { event: "resolved", detail: null, operationId: null });
    store.claim(PROJECT, [{ sourceId: "orders", generation: "g3", kind: "kafka" }, SOURCES[1]!]);
    assert.throws(() => store.observe(observation("f1:unknown", { sourceId: "never-claimed" })), refusal("source-not-claimed"));
    store.close();
  });

  it("refuses to open anything that is not this project's intact journal", () => {
    const missingDirectory = stateDirectory();
    assert.throws(() => openJournal(missingDirectory), refusal("state-dir-missing", "CONFIG_INVALID"));

    mkdirSync(missingDirectory, { mode: 0o700 });
    assert.throws(() => openJournal(missingDirectory), (error: Error) => refusal("journal-missing", "CONFIG_INVALID")(error) && /streamotter init --failures/.test(error.message));
    assert.equal(existsSync(join(missingDirectory, "journal.sqlite")), false, "open never creates a journal");
    assert.equal(existsSync(join(missingDirectory, "journal.lock")), false);

    const garbage = stateDirectory();
    mkdirSync(garbage, { mode: 0o700 });
    writeFileSync(join(garbage, "journal.sqlite"), Buffer.from("this is not a database at all, just text ".repeat(200)), { mode: 0o600 });
    assert.throws(() => openJournal(garbage), refusal("journal-corrupt", "SOURCE_UNAVAILABLE"));
    assert.equal(existsSync(join(garbage, "journal.lock")), false, "a refused open releases its lock");

    const foreign = stateDirectory();
    mkdirSync(foreign, { mode: 0o700 });
    const other = rawDatabase(join(foreign, "journal.sqlite"));
    other.exec("CREATE TABLE meta (id INTEGER PRIMARY KEY, schema_version INTEGER, project_id TEXT)");
    other.exec("INSERT INTO meta VALUES (1, 1, 'order-dashboard')");
    other.close();
    chmodSync(join(foreign, "journal.sqlite"), 0o600);
    const foreignBytes = readFileSync(join(foreign, "journal.sqlite"));
    assert.throws(() => openJournal(foreign), refusal("not-a-journal", "CONFIG_INVALID"));
    assert.ok(readFileSync(join(foreign, "journal.sqlite")).equals(foreignBytes), "a refused file is left exactly as it was");
    assert.equal(existsSync(join(foreign, "journal.sqlite-wal")), false);

    const newer = stateDirectory();
    initJournal(newer, PROJECT, SOURCES);
    const raw = rawDatabase(join(newer, "journal.sqlite"));
    raw.exec(`UPDATE meta SET schema_version = ${JOURNAL_SCHEMA_VERSION + 1}`);
    raw.close();
    assert.throws(() => openJournal(newer), refusal("schema-newer", "CONFIG_INVALID"));

    const wrongProject = stateDirectory();
    initJournal(wrongProject, PROJECT, SOURCES);
    assert.throws(() => openJournal(wrongProject, { projectId: "another" }), refusal("project-mismatch"));
  });

  it("refuses a journal whose pages are damaged", () => {
    const directory = stateDirectory();
    initJournal(directory, PROJECT, SOURCES);
    const store = openJournal(directory);
    for (let i = 0; i < 40; i++) store.observe(observation(`f1:${i}`, { diagnosis: "x".repeat(400) }));
    store.close();
    const path = join(directory, "journal.sqlite");
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 4096 * 4);
    // Overwrite the middle of every page after the first, leaving the header readable.
    for (let page = 1; page * 4096 < bytes.length; page++) bytes.fill(0xa5, page * 4096 + 200, page * 4096 + 3000);
    writeFileSync(path, bytes);
    assert.throws(() => openJournal(directory), refusal("journal-corrupt", "SOURCE_UNAVAILABLE"));
  });

  it("refuses unprotected or redirected state", () => {
    const loose = stateDirectory();
    initJournal(loose, PROJECT, SOURCES);
    chmodSync(loose, 0o770);
    assert.throws(() => openJournal(loose), refusal("state-dir-insecure", "CONFIG_INVALID"));
    chmodSync(loose, 0o700);
    chmodSync(join(loose, "journal.sqlite"), 0o620);
    assert.throws(() => openJournal(loose), refusal("journal-insecure", "CONFIG_INVALID"));
    chmodSync(join(loose, "journal.sqlite"), 0o600);
    openJournal(loose).close();

    const real = stateDirectory();
    initJournal(real, PROJECT, SOURCES);
    const link = `${real}-link`;
    symlinkSync(real, link);
    assert.throws(() => openJournal(link), refusal("state-dir-insecure", "CONFIG_INVALID"));

    const existingLoose = stateDirectory();
    mkdirSync(existingLoose, { mode: 0o700 });
    chmodSync(existingLoose, 0o777);
    assert.throws(() => initJournal(existingLoose, PROJECT, SOURCES), refusal("state-dir-insecure"));
    assert.equal(existsSync(join(existingLoose, "journal.sqlite")), false);
  });

  it("lets exactly one gateway own the journal and recovers a dead owner's lock", () => {
    const { directory, store } = freshJournal();
    const lockPath = join(directory, "journal.lock");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as JournalLock;
    assert.equal(lock.pid, process.pid);
    assert.equal(lock.projectId, PROJECT, "the lock names the project once the journal is read");
    assert.equal(lock.hostname, hostname());
    assert.equal(statSync(lockPath).mode & 0o777, 0o600);
    assert.throws(() => openJournal(directory), (error: Error) => refusal("journal-locked", "SOURCE_UNAVAILABLE")(error) && /another gateway owns this journal/i.test(error.message));
    assert.ok(existsSync(lockPath), "a refused open leaves the owner's lock alone");
    store.close();
    assert.equal(existsSync(lockPath), false);

    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    const deadPid = Number(dead.stdout);
    assert.ok(deadPid > 0);
    writeFileSync(lockPath, JSON.stringify({ pid: deadPid, projectId: PROJECT, startedAt: "2026-10-01T00:00:00.000Z", hostname: hostname() }), { mode: 0o600 });
    const replaced: JournalLock[] = [];
    const recovered = openJournal(directory, { onStaleLock: stale => replaced.push(stale) });
    assert.equal(recovered.replacedLock?.pid, deadPid);
    assert.deepEqual(replaced.map(stale => stale.pid), [deadPid]);
    assert.equal((JSON.parse(readFileSync(lockPath, "utf8")) as JournalLock).pid, process.pid);
    recovered.close();

    writeFileSync(lockPath, JSON.stringify({ pid: deadPid, projectId: PROJECT, startedAt: "2026-10-01T00:00:00.000Z", hostname: "some-other-host" }), { mode: 0o600 });
    assert.throws(() => openJournal(directory), refusal("journal-locked"));
    writeFileSync(lockPath, "", { mode: 0o600 });
    assert.throws(() => openJournal(directory), refusal("lock-unreadable"));
    rmSync(lockPath);
    openJournal(directory).close();
  });

  it("refuses writes past the journal limit and evicts nothing", () => {
    const directory = stateDirectory();
    initJournal(directory, PROJECT, SOURCES);
    const probe = openJournal(directory);
    const baseline = probe.usage().sizeBytes;
    probe.close();
    const store = openJournal(directory, { journalLimitBytes: baseline + 48 * 1024 });
    let accepted = 0;
    let refused: unknown = null;
    for (let i = 0; i < 1_000 && refused === null; i++) {
      try {
        store.observe(observation(`f1:${i}`, { diagnosis: "d".repeat(2_000) }));
        accepted++;
      } catch (error) {
        refused = error;
      }
    }
    assert.ok(accepted > 0, "some incidents fit");
    assert.ok(refused !== null, "the journal eventually refuses");
    refusal("journal-full", "OVERLOADED")(refused);
    assert.equal(store.list({ state: "all", limit: 200 }).items.length, accepted, "every accepted incident is still there");
    assert.equal(store.get(`f1:${accepted}`), null, "the refused incident was not partly written");
    assert.throws(() => store.putEvidence("f1:0", { key: null, value: new Uint8Array(64 * 1024), headers: [] }), refusal("journal-full", "OVERLOADED"));
    assert.equal(store.getEvidence("f1:0"), null);
    // A recovery boundary is growth too, and is refused whole.
    assert.throws(() => store.prepareAdvance(advance("f1:0", 1, "rb1:full", null, { pad: "p".repeat(16_000) })), refusal("journal-full", "OVERLOADED"));
    assert.equal(store.getBoundary("rb1:full"), null);
    assert.equal(store.get("f1:0")?.progress, "held");
    assert.equal(store.circuit("orders").revision, 0);
    // Transitions on existing incidents still go through, so an operator can resolve them.
    store.update("f1:0", 1, { state: "resolved", resolution: "done" }, { event: "resolved", detail: null, operationId: null });
    assert.ok(store.usage().sizeBytes <= baseline + 48 * 1024);
    store.close();
  });

  it("runs with WAL, synchronous=FULL, foreign keys and an exclusive lock", () => {
    const { directory, store } = freshJournal();
    assert.deepEqual(store.settings(), { journalMode: "wal", synchronous: 2, foreignKeys: 1, lockingMode: "exclusive" });
    assert.throws(() => rawDatabase(join(directory, "journal.sqlite")).prepare("SELECT count(*) FROM incidents").get(), /locked/,
      "no other handle can read or write while the gateway owns the journal");
    store.close();
  });

  it("keeps a committed observation when the gateway is killed without closing", () => {
    const directory = stateDirectory();
    initJournal(directory, PROJECT, SOURCES);
    const script = `
      const { openJournal } = await import(${JSON.stringify(JOURNAL_MODULE)});
      const store = openJournal(process.env.JOURNAL_DIR);
      const observation = JSON.parse(process.env.OBSERVATION);
      store.observe(observation);
      store.putEvidence(observation.failureId, { key: null, value: new Uint8Array([0xde, 0xad]), headers: [] });
      process.stdout.write("committed");
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawnSync(process.execPath, ["--conditions=streamotter-source", "--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, JOURNAL_DIR: directory, OBSERVATION: JSON.stringify(observation("f1:crash")) }
    });
    assert.equal(child.stdout, "committed", child.stderr);
    assert.equal(child.signal, "SIGKILL");
    assert.ok(existsSync(join(directory, "journal.lock")), "the killed gateway left its lock behind");
    assert.ok(existsSync(join(directory, "journal.sqlite-wal")), "and its uncheckpointed WAL");

    const store = openJournal(directory);
    assert.equal(store.replacedLock?.pid, child.pid);
    assert.equal(store.get("f1:crash")?.revision, 1);
    assert.deepEqual(store.events("f1:crash").map(event => event.event), ["detected"]);
    assert.equal(hex(store.getEvidence("f1:crash")?.value ?? null), "dead");
    store.close();
  });
});

describe("node:sqlite version floor (D1)", () => {
  it("accepts 24.15 and later only", () => {
    assert.equal(nodeSqliteSupported("v24.14.0"), false);
    assert.equal(nodeSqliteSupported("24.14.9"), false);
    assert.equal(nodeSqliteSupported("v24.15.0"), true);
    assert.equal(nodeSqliteSupported("24.21.0"), true);
    assert.equal(nodeSqliteSupported("v25.0.0"), true);
    assert.equal(nodeSqliteSupported("26.0.0"), true);
    assert.equal(nodeSqliteSupported("v22.22.0"), false);
    assert.equal(nodeSqliteSupported("v23.11.0"), false);
    assert.equal(nodeSqliteSupported("not a version"), false);
  });
});
