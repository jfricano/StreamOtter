import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { StreamOtterError, type ErrorCode, type Json, type Page } from "@streamotter/contracts";
import {
  abandonedOperation, advancedIncident, capAdvances, checkAdvanceState, checkCircuit, checkOperationResult, checkPrepareAdvance, checkRetirement,
  clampLimit, defaultCircuit, endBoundary, evidenceBytes, finishedOperation, generationRetirement, JOURNAL_LIMIT_BYTES, MAX_EVENTS_PER_INCIDENT,
  MAX_OPERATIONS, newOperation, nextBoundary, operationsToPrune, SPOOL_LIMIT_BYTES, StaleRevisionError, storeFull, unknownIncident,
  type CircuitState, type HeaderBytes, type IncidentEvent, type IncidentPatch, type IncidentQuery, type IncidentRecord, type IncidentStore,
  type NewObservation, type ObservationResult, type PrepareAdvance, type RawEvidence, type SourceIdentity, type StoreUsage, type StoredBoundary,
  type NewOperation, type StoredOperation
} from "./store.ts";

/**
 * The durable failure journal (ADR-15A §2, spec §5.1): one SQLite file per
 * project under the gateway's state directory, written through Node's built-in
 * `node:sqlite` so failure handling adds no npm dependency (API §11, D1).
 *
 * Durability: WAL with synchronous=FULL, so a committed transaction survives a
 * process or OS crash. Every mutation is one BEGIN IMMEDIATE transaction, so an
 * incident and its event land together or not at all.
 *
 * Ownership: one gateway owns the journal. `journal.lock` (created with `wx`)
 * names the owner for people and for stale-lock recovery; SQLite's exclusive
 * locking mode backs it with an OS lock that the kernel drops when the owner
 * dies, so two processes can never write the journal at once even if they race
 * on the lock file.
 *
 * Budgets (spec §13): when a write would take the journal past its limit or the
 * raw spool past its budget, the write is refused with OVERLOADED. Nothing is
 * ever evicted to make room; unresolved decision state is exactly what must not
 * be lost.
 */

export const JOURNAL_FILE = "journal.sqlite";
export const LOCK_FILE = "journal.lock";
export const RUN_DIRECTORY = "run";
/** The first Node release whose `node:sqlite` loads without an ExperimentalWarning (API §11, D1). */
export const NODE_SQLITE_FLOOR = "24.15.0";
/** "SOJ1": marks the file as a StreamOtter journal, so an unrelated SQLite file is never mistaken for one. */
const APPLICATION_ID = 0x534f4a31;
/** WAL is truncated back to this after a checkpoint so it does not hold disk beyond the journal budget for long. */
const WAL_SIZE_LIMIT_BYTES = 8 * 1024 * 1024;
/** Allowance for one event row, index entries and page slack when estimating an observation's size. */
const ROW_OVERHEAD_BYTES = 1024;

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_NOTADB = 26;

/**
 * Forward-only schema migrations. A migration's SQL runs in one transaction
 * together with the schema_version bump, so a journal is always at exactly one
 * version. Append new versions; never edit a shipped one. Version 1 has not
 * shipped yet, so the recovery-boundary and circuit tables (ADR-15B) and the
 * operator operations table (ADR-15C §1) were added to it in place rather than
 * as later versions.
 */
const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE sources (
        source_id TEXT PRIMARY KEY,
        generation TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('kafka', 'fixture')),
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE incidents (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        failure_id TEXT NOT NULL UNIQUE,
        source_id TEXT NOT NULL REFERENCES sources (source_id),
        state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        updated_at TEXT NOT NULL,
        record TEXT NOT NULL CHECK (json_valid(record))
      ) STRICT;
      CREATE INDEX incidents_by_source ON incidents (source_id, state, seq);
      CREATE INDEX incidents_by_state ON incidents (state, seq);
      CREATE TABLE incident_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        failure_id TEXT NOT NULL REFERENCES incidents (failure_id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        event TEXT NOT NULL,
        detail TEXT,
        operation_id TEXT
      ) STRICT;
      CREATE INDEX incident_events_by_incident ON incident_events (failure_id, id);
      CREATE TABLE evidence (
        failure_id TEXT PRIMARY KEY,
        key BLOB,
        value BLOB,
        headers BLOB NOT NULL,
        bytes INTEGER NOT NULL CHECK (bytes >= 0),
        stored_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE boundaries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        boundary_id TEXT NOT NULL UNIQUE,
        source_id TEXT NOT NULL REFERENCES sources (source_id),
        generation TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('in-force', 'superseded', 'retired')),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        context TEXT NOT NULL CHECK (json_valid(context)),
        failure_ids TEXT NOT NULL CHECK (json_valid(failure_ids) AND json_type(failure_ids) = 'array'),
        supersedes TEXT REFERENCES boundaries (boundary_id),
        created_at TEXT NOT NULL,
        retired_at TEXT,
        retirement_mode TEXT CHECK (retirement_mode IN ('generation', 'application', 'operator', 'superseded')),
        retirement_reason TEXT,
        retirement_operation_id TEXT,
        CHECK ((state = 'in-force') = (retirement_mode IS NULL))
      ) STRICT;
      CREATE UNIQUE INDEX boundaries_in_force ON boundaries (source_id) WHERE state = 'in-force';
      CREATE TABLE circuits (
        source_id TEXT PRIMARY KEY REFERENCES sources (source_id),
        state TEXT NOT NULL CHECK (state IN ('closed', 'open')),
        advances TEXT NOT NULL CHECK (json_valid(advances) AND json_type(advances) = 'array'),
        opened_at TEXT,
        reason TEXT,
        revision INTEGER NOT NULL CHECK (revision >= 1)
      ) STRICT;
      CREATE TABLE operations (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 128),
        kind TEXT NOT NULL CHECK (kind IN ('retry-current', 'reassess', 'reopen-circuit', 'retire-boundary', 'redrive')),
        source_id TEXT NOT NULL,
        failure_id TEXT,
        request_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'unknown')),
        result TEXT CHECK (result IS NULL OR json_valid(result)),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        CHECK ((state = 'pending') = (completed_at IS NULL)),
        CHECK (state <> 'pending' OR result IS NULL)
      ) STRICT;
      CREATE INDEX operations_prune_order ON operations (completed_at, started_at, seq) WHERE state <> 'pending';
    `
  }
];

/** The schema version this build writes. A journal newer than this is refused, never downgraded. */
export const JOURNAL_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export interface JournalLimits {
  /** Default JOURNAL_LIMIT_BYTES (256 MiB). */
  journalLimitBytes?: number;
  /** Default SPOOL_LIMIT_BYTES (16 MiB). */
  spoolLimitBytes?: number;
  /** Operator operations kept before the oldest finished ones are pruned. Default MAX_OPERATIONS (10,000). */
  maxOperations?: number;
}

export interface JournalLock {
  pid: number;
  projectId: string | null;
  startedAt: string;
  hostname: string;
}

export interface OpenJournalOptions extends JournalLimits {
  /** When given, the journal must belong to this project. claim() checks it again. */
  projectId?: string;
  /** Called when a lock left by a dead gateway on this host is replaced. */
  onStaleLock?: (lock: JournalLock) => void;
}

/**
 * True when this Node version's `node:sqlite` loads without an experimental
 * warning: 24.15.0 or later (measured October 3, 2026; API §11, D1).
 */
export function nodeSqliteSupported(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 24 || (major === 24 && minor >= 15);
}

function refuse(code: ErrorCode, reason: string, message: string, details: Record<string, Json> = {}): StreamOtterError {
  return new StreamOtterError(code, { message, details: { reason, ...details } });
}

function requireNodeSqlite(): typeof import("node:sqlite") {
  const version = process.versions.node;
  if (!nodeSqliteSupported(version)) {
    throw refuse("CONFIG_INVALID", "node-version",
      `The failure journal needs Node ${NODE_SQLITE_FLOOR} or later; this is Node ${version}. ` +
      `node:sqlite is experimental before ${NODE_SQLITE_FLOOR} (decision D1, V1_1_API.md §11).`,
      { nodeVersion: version, required: NODE_SQLITE_FLOOR });
  }
  // Loaded here, not imported at the top, so a gateway without failure handling never loads node:sqlite.
  return process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
}

function sqliteErrcode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const errcode = (error as { errcode?: unknown }).errcode;
  return typeof errcode === "number" ? errcode & 0xff : null;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Refuses a path other local users could tamper with (spec §12): a symlink,
 * anything group- or world-writable, or anything not owned by this user.
 * Mode and owner checks are skipped where the platform has no POSIX permissions.
 */
function checkProtected(path: string, stats: Stats, what: "directory" | "file", reason: string): void {
  const label = what === "directory" ? `State directory ${path}` : `Journal ${path}`;
  if (stats.isSymbolicLink()) throw refuse("CONFIG_INVALID", reason, `${label} is a symbolic link; use the real path.`, { path });
  if (what === "directory" ? !stats.isDirectory() : !stats.isFile()) {
    throw refuse("CONFIG_INVALID", reason, `${label} is not a ${what}.`, { path });
  }
  if (process.platform === "win32") return;
  if ((stats.mode & 0o022) !== 0) {
    throw refuse("CONFIG_INVALID", reason,
      `${label} is group- or world-writable (mode ${(stats.mode & 0o777).toString(8)}); run chmod go-w on it.`, { path });
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    throw refuse("CONFIG_INVALID", reason, `${label} is owned by uid ${stats.uid}, not the gateway's uid ${uid}.`, { path });
  }
}

function checkStateDirectory(stateDirectory: string): void {
  const stats = lstatOrNull(stateDirectory);
  if (stats === null) {
    throw refuse("CONFIG_INVALID", "state-dir-missing",
      `State directory ${stateDirectory} does not exist. Run \`streamotter init --failures\` to create the journal.`, { path: stateDirectory });
  }
  checkProtected(stateDirectory, stats, "directory", "state-dir-insecure");
}

function validateSources(sources: readonly SourceIdentity[]): void {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.sourceId)) throw refuse("CONFIG_INVALID", "duplicate-source", `Source ${source.sourceId} is listed twice.`);
    seen.add(source.sourceId);
  }
}

/**
 * Puts the handle in exclusive locking mode. This must happen before the first
 * read so the lock, once taken, is never released while the handle is open.
 * Nothing is written yet, so an unrelated file can still be refused untouched.
 */
function lockExclusively(db: DatabaseSync): void {
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.exec("PRAGMA busy_timeout = 0");
}

/**
 * Applies the durability settings every journal handle uses. The empty write
 * transaction takes SQLite's exclusive OS lock now rather than at the first incident.
 */
function configureDurability(db: DatabaseSync): void {
  const mode = db.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: unknown } | undefined;
  if (mode?.journal_mode !== "wal") throw new Error(`could not enable WAL (journal_mode is ${String(mode?.journal_mode)})`);
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`);
  db.exec("BEGIN IMMEDIATE");
  db.exec("COMMIT");
}

/**
 * Creates the journal for a project (`streamotter init --failures`). Refuses if
 * one already exists: an existing journal holds decision state that must never
 * be overwritten. Returns the journal's path.
 */
export function initJournal(stateDirectory: string, projectId: string, sources: readonly SourceIdentity[]): string {
  const { DatabaseSync } = requireNodeSqlite();
  if (projectId === "") throw refuse("CONFIG_INVALID", "project-id", "A project ID is required to create the journal.");
  validateSources(sources);
  if (lstatOrNull(stateDirectory) === null) mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  checkStateDirectory(stateDirectory);
  const runDirectory = join(stateDirectory, RUN_DIRECTORY);
  if (lstatOrNull(runDirectory) === null) mkdirSync(runDirectory, { mode: 0o700 });
  checkProtected(runDirectory, lstatSync(runDirectory), "directory", "state-dir-insecure");

  const path = join(stateDirectory, JOURNAL_FILE);
  // A leftover WAL can hold a crashed journal's last commits, and SQLite would discard it against a new file; a
  // leftover shared-memory file belongs to that WAL. Either means a journal's files are still here.
  for (const suffix of ["-wal", "-shm"]) {
    if (lstatOrNull(path + suffix) !== null) {
      throw refuse("CONFIG_INVALID", "journal-exists",
        `${path}${suffix} exists: files of an earlier journal are still here and are never overwritten. ` +
        `To start a new journal, move every journal file (${JOURNAL_FILE}, ${JOURNAL_FILE}-wal and ${JOURNAL_FILE}-shm) aside together.`, { path: path + suffix });
    }
  }
  // Creating the empty file with wx makes "never overwrite" atomic and sets owner-only mode before any data lands.
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw refuse("CONFIG_INVALID", "journal-exists", `A journal already exists at ${path}; it is never overwritten.`, { path });
    }
    throw error;
  }

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path);
    lockExclusively(db);
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    configureDurability(db);
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const migration of MIGRATIONS) db.exec(migration.sql);
      db.prepare("INSERT INTO meta (id, schema_version, project_id, created_at) VALUES (1, ?, ?, ?)").run(JOURNAL_SCHEMA_VERSION, projectId, now);
      const insert = db.prepare("INSERT INTO sources (source_id, generation, kind, recorded_at) VALUES (?, ?, ?, ?)");
      for (const source of sources) insert.run(source.sourceId, source.generation, source.kind, now);
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
    db.close();
    db = null;
  } catch (error) {
    // These files are ours: the journal was created with wx above, and its -wal and -shm did not exist before it, so they are
    // SQLite's for this new file. A half-initialized journal is removed rather than left to be mistaken for a real one.
    try { db?.close(); } catch { /* already failing */ }
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    throw error;
  }
  return path;
}

/**
 * Writes the lock's content to a temporary file next to it, synced, so the
 * lock itself only ever appears complete: a gateway that dies mid-write leaves
 * at most this temporary file, never an empty or partial journal.lock. The
 * name is fixed per pid, so repeated crashes leave at most one per pid.
 */
function writeTemporaryLock(path: string, lock: JournalLock): string {
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(lock));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    rmSync(temporary, { force: true });
    throw error;
  }
  closeSync(fd);
  return temporary;
}

/** Creates the lock, complete, or fails with EEXIST: link() is as exclusive as `wx` but publishes the content at once. */
function writeLockFile(path: string, lock: JournalLock): void {
  const temporary = writeTemporaryLock(path, lock);
  try {
    linkSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Rewrites this process's own lock by renaming a complete copy over it, so there is no moment with no lock or a partial one. */
function rewriteLockFile(path: string, lock: JournalLock): void {
  const temporary = writeTemporaryLock(path, lock);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Reads a lock file; undefined when it vanished meanwhile. */
function readLockFile(path: string): JournalLock | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    text = "";
  }
  try {
    const value = JSON.parse(text) as Partial<JournalLock>;
    if (Number.isSafeInteger(value.pid) && (value.pid as number) > 0 && typeof value.hostname === "string" && typeof value.startedAt === "string") {
      return { pid: value.pid as number, projectId: typeof value.projectId === "string" ? value.projectId : null, startedAt: value.startedAt, hostname: value.hostname };
    }
  } catch {
    // Fall through: a lock we cannot read is never assumed stale.
  }
  throw refuse("SOURCE_UNAVAILABLE", "lock-unreadable",
    `${path} exists but cannot be read as a StreamOtter lock. If no gateway is running on this state directory, remove it and start again.`, { path });
}

/**
 * Lock paths this process holds, so a lock naming this pid can be told apart:
 * held here means a second open in the same process, which is refused; not held
 * means a dead gateway that had the same pid (a container restarted in place,
 * often pid 1), whose lock is stale.
 */
const heldLocks = new Set<string>();

function ownerAlive(lock: JournalLock): boolean {
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return errnoCode(error) === "EPERM";
  }
}

function lockHeld(path: string, lock: JournalLock): StreamOtterError {
  return refuse("SOURCE_UNAVAILABLE", "journal-locked",
    `Another gateway owns this journal (pid ${lock.pid} on ${lock.hostname}, started ${lock.startedAt}; lock ${path}).`,
    { path, pid: lock.pid, hostname: lock.hostname });
}

/**
 * True when another connection holds the journal's SQLite lock. A gateway in
 * another pid namespace (a second container on the same volume and hostname)
 * looks dead to ownerAlive, but its exclusive lock still shows here. Any other
 * error is left for the real open to report.
 */
function journalInUse(journalPath: string): boolean {
  const { DatabaseSync } = requireNodeSqlite();
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(journalPath);
    db.exec("PRAGMA busy_timeout = 0");
    db.prepare("SELECT count(*) AS tables FROM sqlite_schema").get();
    return false;
  } catch (error) {
    const errcode = sqliteErrcode(error);
    return errcode === SQLITE_BUSY || errcode === SQLITE_LOCKED;
  } finally {
    try { db?.close(); } catch { /* the probe only reads */ }
  }
}

/**
 * Takes journal.lock. On EEXIST the existing lock is read: a live owner, or one
 * on another host whose liveness cannot be checked, refuses; a dead owner on
 * this host is replaced once, after SQLite confirms nobody holds the journal. A
 * lock naming this process's own pid is a live owner only if this process holds
 * it. A second EEXIST means another process won the race, which also refuses.
 */
function acquireLock(path: string, mine: JournalLock, journalPath: string): JournalLock | null {
  let replaced: JournalLock | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeLockFile(path, mine);
      heldLocks.add(resolve(path));
      return replaced;
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw error;
    }
    const existing = readLockFile(path);
    if (existing === undefined) continue;
    if (existing.hostname !== mine.hostname) {
      throw refuse("SOURCE_UNAVAILABLE", "journal-locked",
        `${path} names a gateway on host ${existing.hostname} (pid ${existing.pid}), which cannot be checked from ${mine.hostname}. ` +
        "If that gateway is not running, remove the lock and start again.", { path, pid: existing.pid, hostname: existing.hostname });
    }
    const alive = existing.pid === process.pid ? heldLocks.has(resolve(path)) : ownerAlive(existing);
    if (alive || replaced !== null || journalInUse(journalPath)) throw lockHeld(path, existing);
    try {
      unlinkSync(path);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    replaced = existing;
  }
  throw refuse("SOURCE_UNAVAILABLE", "journal-locked", `Could not take ${path}: another process keeps creating it.`, { path });
}

/** Removes journal.lock only if it is still the one this process wrote. */
function releaseLock(path: string, mine: JournalLock): void {
  heldLocks.delete(resolve(path));
  try {
    const current = readLockFile(path);
    if (current !== undefined && current.pid === mine.pid && current.startedAt === mine.startedAt) unlinkSync(path);
  } catch {
    // A lock we cannot read or remove is left for the operator; closing must not fail because of it.
  }
}

/**
 * Opens an existing journal for the gateway that will own it. Ordinary startup
 * never creates, replaces or repairs a journal: anything missing, unprotected,
 * corrupt, foreign or newer than this build is refused with a reason.
 */
export function openJournal(stateDirectory: string, options: OpenJournalOptions = {}): SqliteIncidentStore {
  const { DatabaseSync } = requireNodeSqlite();
  checkStateDirectory(stateDirectory);
  const path = join(stateDirectory, JOURNAL_FILE);
  const stats = lstatOrNull(path);
  if (stats === null) {
    throw refuse("CONFIG_INVALID", "journal-missing",
      `No failure journal at ${path}. Run \`streamotter init --failures\` to create it; ordinary startup never creates one.`, { path });
  }
  checkProtected(path, stats, "file", "journal-insecure");

  const lockPath = join(stateDirectory, LOCK_FILE);
  const lock: JournalLock = { pid: process.pid, projectId: options.projectId ?? null, startedAt: new Date().toISOString(), hostname: hostname() };
  const replaced = acquireLock(lockPath, lock, path);
  if (replaced !== null) options.onStaleLock?.(replaced);

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path);
    const meta = inspect(db, path);
    if (options.projectId !== undefined && meta.projectId !== options.projectId) {
      throw refuse("SOURCE_UNAVAILABLE", "project-mismatch",
        `The journal at ${path} belongs to project ${meta.projectId}, not ${options.projectId}.`, { path, journalProjectId: meta.projectId });
    }
    if (lock.projectId !== meta.projectId) {
      // The lock was taken before the journal could be read; record the project now, in place, for whoever reads it.
      lock.projectId = meta.projectId;
      rewriteLockFile(lockPath, lock);
    }
    const store = new SqliteIncidentStore(db, path, options, () => releaseLock(lockPath, lock), replaced);
    db = null;
    return store;
  } catch (error) {
    try { db?.close(); } catch { /* already failing */ }
    releaseLock(lockPath, lock);
    throw translateOpenError(error, path);
  }
}

function translateOpenError(error: unknown, path: string): unknown {
  if (error instanceof StreamOtterError) return error;
  const errcode = sqliteErrcode(error);
  const detail = error instanceof Error ? error.message : String(error);
  if (errcode === SQLITE_BUSY || errcode === SQLITE_LOCKED) {
    return refuse("SOURCE_UNAVAILABLE", "journal-locked", `Another process holds the journal at ${path} open (${detail}).`, { path });
  }
  if (errcode === SQLITE_NOTADB || errcode === SQLITE_CORRUPT) {
    return refuse("SOURCE_UNAVAILABLE", "journal-corrupt",
      `The journal at ${path} is not a readable SQLite database or is corrupt (${detail}). Restore it from backup; it is never recreated automatically.`, { path });
  }
  return refuse("SOURCE_UNAVAILABLE", "journal-unreadable", `The journal at ${path} could not be opened: ${detail}.`, { path });
}

/** Checks the file is an intact StreamOtter journal and brings its schema up to date. */
function inspect(db: DatabaseSync, path: string): { projectId: string } {
  lockExclusively(db);
  const integrity = db.prepare("PRAGMA integrity_check").all() as { integrity_check?: unknown }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    const problems = integrity.slice(0, 5).map(row => String(row.integrity_check));
    throw refuse("SOURCE_UNAVAILABLE", "journal-corrupt",
      `The journal at ${path} failed its integrity check (${problems.join("; ")}). Restore it from backup; it is never recreated automatically.`, { path });
  }
  const applicationId = (db.prepare("PRAGMA application_id").get() as { application_id?: unknown } | undefined)?.application_id;
  const hasMeta = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'meta'").get() !== undefined;
  const meta = hasMeta ? db.prepare("SELECT schema_version, project_id FROM meta WHERE id = 1").get() as { schema_version: number; project_id: string } | undefined : undefined;
  if (applicationId !== APPLICATION_ID || meta === undefined) {
    throw refuse("CONFIG_INVALID", "not-a-journal", `${path} is a SQLite database but not a StreamOtter failure journal.`, { path });
  }
  if (meta.schema_version > JOURNAL_SCHEMA_VERSION) {
    throw refuse("CONFIG_INVALID", "schema-newer",
      `The journal at ${path} is schema version ${meta.schema_version}, newer than this gateway supports (${JOURNAL_SCHEMA_VERSION}). ` +
      "Upgrade StreamOtter; a journal is never downgraded.", { path, schemaVersion: meta.schema_version, supported: JOURNAL_SCHEMA_VERSION });
  }
  configureDurability(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= meta.schema_version) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("UPDATE meta SET schema_version = ? WHERE id = 1").run(migration.version);
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  return { projectId: meta.project_id };
}

/**
 * Header list encoding: version byte, u32 count, then per header a u32 name
 * length, UTF-8 name, u32 value length and value bytes. Keeps order, duplicate
 * names and arbitrary non-UTF-8 values exactly.
 */
function encodeHeaders(headers: readonly HeaderBytes[]): Uint8Array {
  const names = headers.map(header => Buffer.from(header.name, "utf8"));
  const size = 5 + headers.reduce((sum, header, index) => sum + 8 + names[index]!.byteLength + header.value.byteLength, 0);
  const buffer = Buffer.alloc(size);
  let offset = buffer.writeUInt8(1, 0);
  offset = buffer.writeUInt32BE(headers.length, offset);
  headers.forEach((header, index) => {
    const name = names[index]!;
    offset = buffer.writeUInt32BE(name.byteLength, offset);
    offset += name.copy(buffer, offset);
    offset = buffer.writeUInt32BE(header.value.byteLength, offset);
    buffer.set(header.value, offset);
    offset += header.value.byteLength;
  });
  return buffer;
}

function decodeHeaders(bytes: Uint8Array): HeaderBytes[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const corrupt = (): StreamOtterError => refuse("SOURCE_UNAVAILABLE", "journal-corrupt", "Stored evidence headers are malformed.");
  if (buffer.byteLength < 5 || buffer.readUInt8(0) !== 1) throw corrupt();
  const count = buffer.readUInt32BE(1);
  const headers: HeaderBytes[] = [];
  let offset = 5;
  const take = (): Uint8Array => {
    if (offset + 4 > buffer.byteLength) throw corrupt();
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    if (offset + length > buffer.byteLength) throw corrupt();
    const slice = new Uint8Array(buffer.subarray(offset, offset + length));
    offset += length;
    return slice;
  };
  for (let index = 0; index < count; index++) {
    const name = Buffer.from(take()).toString("utf8");
    headers.push({ name, value: take() });
  }
  if (offset !== buffer.byteLength) throw corrupt();
  return headers;
}

function encodeCursor(seq: number): string {
  return Buffer.from(`j:${seq}`).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^j:(\d{1,15})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (match === null) throw new StreamOtterError("INVALID_REQUEST", { message: "Invalid cursor." });
  return Number(match[1]);
}

interface IncidentRow { seq: number; record: string }

interface BoundaryRow {
  boundary_id: string;
  source_id: string;
  generation: string;
  state: StoredBoundary["state"];
  revision: number;
  context: string;
  failure_ids: string;
  supersedes: string | null;
  created_at: string;
  retired_at: string | null;
  retirement_mode: NonNullable<StoredBoundary["retirement"]>["mode"] | null;
  retirement_reason: string | null;
  retirement_operation_id: string | null;
}

const BOUNDARY_COLUMNS = `boundary_id, source_id, generation, state, revision, context, failure_ids, supersedes, created_at,
  retired_at, retirement_mode, retirement_reason, retirement_operation_id`;

function boundaryFromRow(row: BoundaryRow): StoredBoundary {
  return {
    boundaryId: row.boundary_id,
    sourceId: row.source_id,
    generation: row.generation,
    context: JSON.parse(row.context) as Json,
    revision: row.revision,
    state: row.state,
    failureIds: JSON.parse(row.failure_ids) as string[],
    supersedes: row.supersedes,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    retirement: row.retirement_mode === null ? null : { mode: row.retirement_mode, reason: row.retirement_reason, operationId: row.retirement_operation_id }
  };
}

interface OperationRow {
  operation_id: string;
  kind: StoredOperation["kind"];
  source_id: string;
  failure_id: string | null;
  request_hash: string;
  state: StoredOperation["state"];
  result: string | null;
  started_at: string;
  completed_at: string | null;
}

const OPERATION_COLUMNS = "operation_id, kind, source_id, failure_id, request_hash, state, result, started_at, completed_at";

function operationFromRow(row: OperationRow): StoredOperation {
  return {
    operationId: row.operation_id,
    kind: row.kind,
    sourceId: row.source_id,
    failureId: row.failure_id,
    requestHash: row.request_hash,
    state: row.state,
    result: row.result === null ? null : JSON.parse(row.result) as Json,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

interface CircuitRow { source_id: string; state: CircuitState["state"]; advances: string; opened_at: string | null; reason: string | null; revision: number }

/**
 * The SQLite incident store. Construct it through openJournal(), which checks
 * the file, takes the lock and hands the open handle over; close() releases both.
 */
export class SqliteIncidentStore implements IncidentStore {
  readonly kind = "sqlite" as const;
  readonly path: string;
  /** The lock of a dead gateway this store replaced when it opened, or null. */
  readonly replacedLock: JournalLock | null;
  readonly #db: DatabaseSync;
  readonly #journalLimitBytes: number;
  readonly #spoolLimitBytes: number;
  readonly #maxOperations: number;
  readonly #release: () => void;
  readonly #statements = new Map<string, StatementSync>();
  #closed = false;

  constructor(db: DatabaseSync, path: string, limits: JournalLimits, release: () => void, replacedLock: JournalLock | null = null) {
    this.#db = db;
    this.path = path;
    this.#journalLimitBytes = limits.journalLimitBytes ?? JOURNAL_LIMIT_BYTES;
    this.#spoolLimitBytes = limits.spoolLimitBytes ?? SPOOL_LIMIT_BYTES;
    this.#maxOperations = limits.maxOperations ?? MAX_OPERATIONS;
    this.#release = release;
    this.replacedLock = replacedLock;
    // A hard backstop under the admission checks below: SQLite itself refuses to grow the file past the limit.
    const pageSize = this.#pragma("page_size");
    db.exec(`PRAGMA max_page_count = ${Math.max(1, Math.floor(this.#journalLimitBytes / pageSize))}`);
  }

  claim(projectId: string, sources: readonly SourceIdentity[]): void {
    validateSources(sources);
    this.#write(() => {
      const meta = this.#statement("SELECT project_id FROM meta WHERE id = 1").get() as { project_id: string };
      if (meta.project_id !== projectId) {
        throw refuse("SOURCE_UNAVAILABLE", "project-mismatch",
          `The journal at ${this.path} belongs to project ${meta.project_id}, not ${projectId}.`, { journalProjectId: meta.project_id });
      }
      const stored = new Map((this.#statement("SELECT source_id, generation, kind FROM sources").all() as { source_id: string; generation: string; kind: string }[])
        .map(row => [row.source_id, row]));
      const configured = new Set(sources.map(source => source.sourceId));
      for (const [sourceId] of stored) {
        if (!configured.has(sourceId) && this.#openCount(sourceId) > 0) {
          throw refuse("SOURCE_UNAVAILABLE", "source-removed-with-open-incidents",
            `Source ${sourceId} has open incidents in the journal but is no longer configured. Restore it, or resolve its incidents first.`, { sourceId });
        }
      }
      const now = new Date().toISOString();
      for (const source of sources) {
        const previous = stored.get(source.sourceId);
        if (previous === undefined) {
          this.#statement("INSERT INTO sources (source_id, generation, kind, recorded_at) VALUES (?, ?, ?, ?)").run(source.sourceId, source.generation, source.kind, now);
          continue;
        }
        if (previous.generation === source.generation && previous.kind === source.kind) continue;
        const open = this.#openCount(source.sourceId);
        if (open > 0) {
          throw refuse("SOURCE_UNAVAILABLE", "generation-changed-with-open-incidents",
            `Source ${source.sourceId} changed from generation ${previous.generation} (${previous.kind}) to ${source.generation} (${source.kind}) ` +
            `while ${open} incident(s) are open. Restore the previous generation, resolve its incidents first, or close them with "streamotter sources rebaseline" (gateway stopped).`,
            { sourceId: source.sourceId, storedGeneration: previous.generation, generation: source.generation, openIncidents: open });
        }
        this.#statement("UPDATE sources SET generation = ?, kind = ?, recorded_at = ? WHERE source_id = ?").run(source.generation, source.kind, now, source.sourceId);
        // ADR-15B §4: a generation change always retires the boundary in force, whatever the retirement mode.
        const boundary = this.#inForceBoundary(source.sourceId);
        if (boundary !== null && boundary.generation !== source.generation) {
          this.#saveBoundary(endBoundary(boundary, generationRetirement(source.sourceId, boundary.generation, source.generation), now));
        }
      }
    });
  }

  get(failureId: string): IncidentRecord | null {
    const row = this.#statement("SELECT seq, record FROM incidents WHERE failure_id = ?").get(failureId) as IncidentRow | undefined;
    return row === undefined ? null : JSON.parse(row.record) as IncidentRecord;
  }

  events(failureId: string, limit = MAX_EVENTS_PER_INCIDENT): IncidentEvent[] {
    const rows = this.#statement("SELECT at, event, detail, operation_id FROM incident_events WHERE failure_id = ? ORDER BY id DESC LIMIT ?")
      .all(failureId, Number.isFinite(limit) ? Math.max(0, Math.min(Math.trunc(limit), MAX_EVENTS_PER_INCIDENT)) : MAX_EVENTS_PER_INCIDENT) as { at: string; event: IncidentEvent["event"]; detail: string | null; operation_id: string | null }[];
    return rows.reverse().map(row => ({ at: row.at, event: row.event, detail: row.detail, operationId: row.operation_id }));
  }

  /** Same semantics as MemoryIncidentStore.observe, committed as one transaction with its event. */
  observe(observation: NewObservation): ObservationResult {
    const { observedAt, ...fields } = observation;
    return this.#write(() => {
      const row = this.#statement("SELECT seq, record FROM incidents WHERE failure_id = ?").get(observation.failureId) as IncidentRow | undefined;
      if (row === undefined) {
        if (this.#statement("SELECT 1 AS present FROM sources WHERE source_id = ?").get(fields.sourceId) === undefined) {
          throw refuse("SOURCE_UNAVAILABLE", "source-not-claimed", `Source ${fields.sourceId} is not registered in the journal; claim() it first.`, { sourceId: fields.sourceId });
        }
        const record: IncidentRecord = {
          ...structuredClone(fields),
          revision: 1,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          observations: 1,
          quarantine: "not-required",
          quarantineCoordinates: null,
          progress: "held",
          recovery: "not-applicable",
          state: "open",
          resolution: null,
          guard: null,
          boundaryId: null,
          updatedAt: observedAt
        };
        const json = JSON.stringify(record);
        this.#admit(Buffer.byteLength(json) + ROW_OVERHEAD_BYTES, "record a new incident");
        this.#statement("INSERT INTO incidents (failure_id, source_id, state, revision, updated_at, record) VALUES (?, ?, ?, ?, ?, ?)")
          .run(record.failureId, record.sourceId, record.state, record.revision, record.updatedAt, json);
        this.#addEvent(record.failureId, { at: observedAt, event: "detected", detail: record.failureClass, operationId: null });
        return { record, created: true, conflict: false };
      }
      const existing = JSON.parse(row.record) as IncidentRecord;
      const conflict = existing.evidence.hash !== "" && fields.evidence.hash !== "" && existing.evidence.hash !== fields.evidence.hash;
      existing.revision++;
      existing.lastObservedAt = observedAt;
      existing.observations++;
      existing.updatedAt = observedAt;
      if (existing.state === "resolved") {
        existing.state = "open";
        existing.resolution = null;
        existing.progress = "held";
      }
      if (!conflict) {
        existing.failureClass = fields.failureClass;
        existing.stage = fields.stage;
        existing.errorCode = fields.errorCode;
        existing.channel = fields.channel;
        existing.diagnosis = fields.diagnosis;
      }
      const json = JSON.stringify(existing);
      this.#admit(ROW_OVERHEAD_BYTES + Math.max(0, Buffer.byteLength(json) - Buffer.byteLength(row.record)), "record another observation");
      this.#replace(existing, json);
      this.#addEvent(existing.failureId, { at: observedAt, event: "detected", detail: conflict ? "evidence-conflict" : fields.failureClass, operationId: null });
      return { record: existing, created: false, conflict };
    });
  }

  update(failureId: string, expectedRevision: number, patch: IncidentPatch, event: Omit<IncidentEvent, "at"> & { at?: string }): IncidentRecord {
    return this.#write(() => {
      const row = this.#statement("SELECT seq, record FROM incidents WHERE failure_id = ?").get(failureId) as IncidentRow | undefined;
      if (row === undefined) throw unknownIncident(failureId);
      const existing = JSON.parse(row.record) as IncidentRecord;
      if (existing.revision !== expectedRevision) throw new StaleRevisionError(failureId, expectedRevision, existing.revision);
      const at = event.at ?? new Date().toISOString();
      Object.assign(existing, structuredClone(patch));
      existing.revision++;
      existing.updatedAt = at;
      // Transitions are not pre-admitted: they rewrite an existing row, and refusing them could keep an operator
      // from resolving incidents in a full journal. SQLite's page cap still refuses real growth past the limit.
      this.#replace(existing, JSON.stringify(existing));
      this.#addEvent(failureId, { at, event: event.event, detail: event.detail, operationId: event.operationId });
      return existing;
    });
  }

  list(query: IncidentQuery): Page<IncidentRecord> {
    const limit = clampLimit(query.limit);
    const after = decodeCursor(query.cursor);
    const state = query.state ?? "open";
    const conditions = ["seq > ?"];
    const parameters: (string | number)[] = [after];
    if (query.sourceId !== undefined) { conditions.push("source_id = ?"); parameters.push(query.sourceId); }
    if (state !== "all") { conditions.push("state = ?"); parameters.push(state); }
    parameters.push(limit + 1);
    const rows = this.#statement(`SELECT seq, record FROM incidents WHERE ${conditions.join(" AND ")} ORDER BY seq LIMIT ?`).all(...parameters) as unknown as IncidentRow[];
    const page = rows.slice(0, limit);
    return {
      items: page.map(row => JSON.parse(row.record) as IncidentRecord),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!.seq) : null
    };
  }

  open(sourceId: string): IncidentRecord[] {
    const rows = this.#statement("SELECT seq, record FROM incidents WHERE source_id = ? AND state = 'open' ORDER BY seq").all(sourceId) as unknown as IncidentRow[];
    return rows.map(row => JSON.parse(row.record) as IncidentRecord);
  }

  putEvidence(failureId: string, evidence: RawEvidence): void {
    const bytes = evidenceBytes(evidence);
    const headers = encodeHeaders(evidence.headers);
    const stored = (evidence.key?.byteLength ?? 0) + (evidence.value?.byteLength ?? 0) + headers.byteLength;
    this.#write(() => {
      // Replacing a failure's evidence frees the old copy, so it does not count against the new one.
      const replaced = this.#statement(`SELECT bytes, coalesce(length(key), 0) + coalesce(length(value), 0) + length(headers) AS stored
        FROM evidence WHERE failure_id = ?`).get(failureId) as unknown as { bytes: number; stored: number } | undefined;
      if (this.#spoolBytes() - (replaced?.bytes ?? 0) + bytes > this.#spoolLimitBytes) throw storeFull("The raw evidence spool is full.");
      this.#admit(Math.max(0, stored - (replaced?.stored ?? 0)) + ROW_OVERHEAD_BYTES, "store raw evidence");
      this.#statement(`INSERT INTO evidence (failure_id, key, value, headers, bytes, stored_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (failure_id) DO UPDATE SET key = excluded.key, value = excluded.value, headers = excluded.headers, bytes = excluded.bytes, stored_at = excluded.stored_at`)
        .run(failureId, evidence.key, evidence.value, headers, bytes, new Date().toISOString());
    });
  }

  getEvidence(failureId: string): RawEvidence | null {
    const row = this.#statement("SELECT key, value, headers FROM evidence WHERE failure_id = ?").get(failureId) as
      { key: Uint8Array | null; value: Uint8Array | null; headers: Uint8Array } | undefined;
    if (row === undefined) return null;
    return { key: row.key, value: row.value, headers: decodeHeaders(row.headers) };
  }

  deleteEvidence(failureId: string): void {
    this.#write(() => {
      this.#statement("DELETE FROM evidence WHERE failure_id = ?").run(failureId);
    });
  }

  boundary(sourceId: string): StoredBoundary | null {
    return this.#inForceBoundary(sourceId);
  }

  getBoundary(boundaryId: string): StoredBoundary | null {
    const row = this.#statement(`SELECT ${BOUNDARY_COLUMNS} FROM boundaries WHERE boundary_id = ?`).get(boundaryId) as BoundaryRow | undefined;
    return row === undefined ? null : boundaryFromRow(row);
  }

  /** Same semantics as MemoryIncidentStore.prepareAdvance: the boundary, the incident, its event and the circuit commit together. */
  prepareAdvance(input: PrepareAdvance): { record: IncidentRecord; boundary: StoredBoundary } {
    const context = checkPrepareAdvance(input);
    return this.#write(() => {
      const row = this.#statement("SELECT seq, record FROM incidents WHERE failure_id = ?").get(input.failureId) as IncidentRow | undefined;
      const existing = row === undefined ? null : JSON.parse(row.record) as IncidentRecord;
      const prior = existing === null ? null : this.#inForceBoundary(existing.sourceId);
      const generation = existing === null ? null
        : (this.#statement("SELECT generation FROM sources WHERE source_id = ?").get(existing.sourceId) as { generation: string } | undefined)?.generation ?? null;
      const record = checkAdvanceState(input, existing, prior, generation, this.getBoundary(input.boundary.boundaryId) !== null);
      const boundary = nextBoundary(input, record, prior, context);
      const advanced = advancedIncident(input, record);
      const recordJson = JSON.stringify(advanced.record);
      const failureIds = JSON.stringify(boundary.failureIds);
      // A new boundary row is growth, so it is admitted like a new incident; the rest rewrites existing rows. The prior's
      // list moves to the new row (endBoundary empties it), so only the growth of the list counts.
      const listGrowth = Buffer.byteLength(failureIds) - (prior === null ? 0 : Buffer.byteLength(JSON.stringify(prior.failureIds)));
      this.#admit(Buffer.byteLength(context) + Math.max(0, listGrowth) + Math.max(0, Buffer.byteLength(recordJson) - Buffer.byteLength((row as IncidentRow).record))
        + 2 * ROW_OVERHEAD_BYTES, "record a recovery boundary");
      if (prior !== null) this.#saveBoundary(endBoundary(prior, { mode: "superseded", reason: null, operationId: null }, input.at));
      this.#statement(`INSERT INTO boundaries (${BOUNDARY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(boundary.boundaryId, boundary.sourceId, boundary.generation, boundary.state, boundary.revision, context, failureIds,
          boundary.supersedes, boundary.createdAt, null, null, null, null);
      this.#replace(advanced.record, recordJson);
      this.#addEvent(record.failureId, advanced.event);
      const circuit = this.circuit(record.sourceId);
      this.#saveCircuit({ ...circuit, advances: capAdvances([...circuit.advances, input.at]), revision: circuit.revision + 1 });
      return { record: advanced.record, boundary };
    });
  }

  retireBoundary(boundaryId: string, expectedRevision: number, retirement: NonNullable<StoredBoundary["retirement"]>, at = new Date().toISOString()): StoredBoundary {
    return this.#write(() => {
      const boundary = checkRetirement(boundaryId, this.getBoundary(boundaryId), expectedRevision, retirement, failureId => this.get(failureId));
      const retired = endBoundary(boundary, retirement, at);
      this.#saveBoundary(retired);
      return retired;
    });
  }

  circuit(sourceId: string): CircuitState {
    const row = this.#statement("SELECT source_id, state, advances, opened_at, reason, revision FROM circuits WHERE source_id = ?").get(sourceId) as CircuitRow | undefined;
    if (row === undefined) return defaultCircuit(sourceId);
    return { sourceId: row.source_id, state: row.state, advances: JSON.parse(row.advances) as string[], openedAt: row.opened_at, reason: row.reason, revision: row.revision };
  }

  updateCircuit(sourceId: string, expectedRevision: number, next: Pick<CircuitState, "state" | "advances" | "openedAt" | "reason">): CircuitState {
    return this.#write(() => {
      const current = this.circuit(sourceId);
      if (current.revision !== expectedRevision) {
        throw new StaleRevisionError(sourceId, expectedRevision, current.revision, `The circuit of source ${sourceId} is at revision ${current.revision}, not ${expectedRevision}.`);
      }
      const updated = checkCircuit(sourceId, next, current.revision + 1);
      this.#saveCircuit(updated);
      return updated;
    });
  }

  /** Same semantics as MemoryIncidentStore.beginOperation: the prune and the insert commit together. */
  beginOperation(input: NewOperation): { operation: StoredOperation; created: boolean } {
    const operation = newOperation(input);
    return this.#write(() => {
      const existing = this.getOperation(operation.operationId);
      if (existing !== null) return { operation: existing, created: false };
      const counts = this.#statement("SELECT count(*) AS stored, count(*) FILTER (WHERE state <> 'pending') AS finished FROM operations").get() as
        { stored: number; finished: number };
      const prune = operationsToPrune(counts.stored, counts.finished, this.#maxOperations);
      if (prune > 0) {
        // The WHERE clause matches operations_prune_order's, so the oldest finished rows come straight off that index.
        this.#statement(`DELETE FROM operations WHERE seq IN (
          SELECT seq FROM operations WHERE state <> 'pending' ORDER BY completed_at, started_at, seq LIMIT ?)`).run(prune);
      }
      // A new operation row is growth, so it is admitted like a new incident.
      this.#admit(Buffer.byteLength(JSON.stringify(operation)) + ROW_OVERHEAD_BYTES, "record an operator operation");
      this.#statement(`INSERT INTO operations (${OPERATION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(operation.operationId, operation.kind, operation.sourceId, operation.failureId, operation.requestHash, operation.state, null,
          operation.startedAt, null);
      return { operation, created: true };
    });
  }

  finishOperation(operationId: string, state: "completed" | "unknown", result: Json, at = new Date().toISOString()): StoredOperation {
    const canonical = checkOperationResult(state, result);
    return this.#write(() => {
      const finished = finishedOperation(operationId, this.getOperation(operationId), state, canonical, at);
      // Not pre-admitted (see IncidentStore.finishOperation); SQLite's page cap still refuses real growth past the limit.
      this.#statement("UPDATE operations SET state = ?, result = ?, completed_at = ? WHERE operation_id = ?").run(state, canonical, at, operationId);
      return finished;
    });
  }

  getOperation(operationId: string): StoredOperation | null {
    const row = this.#statement(`SELECT ${OPERATION_COLUMNS} FROM operations WHERE operation_id = ?`).get(operationId) as OperationRow | undefined;
    return row === undefined ? null : operationFromRow(row);
  }

  abandonPendingOperations(at: string): StoredOperation[] {
    return this.#write(() => {
      const rows = this.#statement(`SELECT ${OPERATION_COLUMNS} FROM operations WHERE state = 'pending' ORDER BY seq`).all() as unknown as OperationRow[];
      const abandoned = rows.map(row => abandonedOperation(operationFromRow(row), at));
      this.#statement("UPDATE operations SET state = 'unknown', result = NULL, completed_at = ? WHERE state = 'pending'").run(at);
      return abandoned;
    });
  }

  usage(): StoreUsage {
    const schemaVersion = (this.#statement("SELECT schema_version FROM meta WHERE id = 1").get() as { schema_version: number }).schema_version;
    return {
      sizeBytes: this.#pragma("page_count") * this.#pragma("page_size"),
      limitBytes: this.#journalLimitBytes,
      spoolBytes: this.#spoolBytes(),
      spoolLimitBytes: this.#spoolLimitBytes,
      schemaVersion
    };
  }

  /** The connection's durability settings, for status and tests (they cannot be read from another handle while this one holds the lock). */
  settings(): { journalMode: string; synchronous: number; foreignKeys: number; lockingMode: string } {
    const read = (name: string): string | number => Object.values(this.#statement(`PRAGMA ${name}`).get() ?? {})[0] as string | number;
    return {
      journalMode: String(read("journal_mode")),
      synchronous: Number(read("synchronous")),
      foreignKeys: Number(read("foreign_keys")),
      lockingMode: String(read("locking_mode"))
    };
  }

  /** Closes the database (checkpointing the WAL) and removes this gateway's lock. Safe to call twice. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#db.close();
    } finally {
      this.#release();
    }
  }

  /** Runs fn in one BEGIN IMMEDIATE transaction; any error rolls everything back. */
  #write<T>(fn: () => T): T {
    if (this.#closed) throw refuse("SOURCE_UNAVAILABLE", "journal-closed", `The journal at ${this.path} is closed.`);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      if (sqliteErrcode(error) === SQLITE_FULL) {
        throw storeFull(`The failure journal at ${this.path} reached its ${this.#journalLimitBytes}-byte limit or the disk is full; nothing was evicted.`);
      }
      throw error;
    }
  }

  /**
   * Refuses a write that would take the journal past its limit. Live pages
   * (page_count minus the freelist) are what count here, because freed pages
   * are reused before the file grows.
   */
  #admit(estimatedBytes: number, action: string): void {
    const live = (this.#pragma("page_count") - this.#pragma("freelist_count")) * this.#pragma("page_size");
    if (live + estimatedBytes > this.#journalLimitBytes) {
      throw storeFull(`The failure journal is full (${live} of ${this.#journalLimitBytes} bytes); refusing to ${action}. Nothing was evicted.`);
    }
  }

  #replace(record: IncidentRecord, json: string): void {
    this.#statement("UPDATE incidents SET state = ?, revision = ?, updated_at = ?, record = ? WHERE failure_id = ?")
      .run(record.state, record.revision, record.updatedAt, json, record.failureId);
  }

  #addEvent(failureId: string, event: IncidentEvent): void {
    this.#statement("INSERT INTO incident_events (failure_id, at, event, detail, operation_id) VALUES (?, ?, ?, ?, ?)")
      .run(failureId, event.at, event.event, event.detail, event.operationId);
    // Keep the newest MAX_EVENTS_PER_INCIDENT: delete everything at or below the first id past that window.
    this.#statement(`DELETE FROM incident_events WHERE failure_id = ? AND id <= (
      SELECT id FROM incident_events WHERE failure_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`)
      .run(failureId, failureId, MAX_EVENTS_PER_INCIDENT);
  }

  #inForceBoundary(sourceId: string): StoredBoundary | null {
    const row = this.#statement(`SELECT ${BOUNDARY_COLUMNS} FROM boundaries WHERE source_id = ? AND state = 'in-force'`).get(sourceId) as BoundaryRow | undefined;
    return row === undefined ? null : boundaryFromRow(row);
  }

  /** Rewrites a boundary's mutable fields; context and links never change after insert, and failureIds only empties on supersede. */
  #saveBoundary(boundary: StoredBoundary): void {
    this.#statement(`UPDATE boundaries SET state = ?, revision = ?, failure_ids = ?, retired_at = ?, retirement_mode = ?, retirement_reason = ?,
      retirement_operation_id = ? WHERE boundary_id = ?`)
      .run(boundary.state, boundary.revision, JSON.stringify(boundary.failureIds), boundary.retiredAt, boundary.retirement?.mode ?? null,
        boundary.retirement?.reason ?? null, boundary.retirement?.operationId ?? null, boundary.boundaryId);
  }

  /** Inserts or replaces a circuit; a source the journal does not know is refused like an observation of one. */
  #saveCircuit(circuit: CircuitState): void {
    if (this.#statement("SELECT 1 AS present FROM sources WHERE source_id = ?").get(circuit.sourceId) === undefined) {
      throw refuse("SOURCE_UNAVAILABLE", "source-not-claimed", `Source ${circuit.sourceId} is not registered in the journal; claim() it first.`, { sourceId: circuit.sourceId });
    }
    this.#statement(`INSERT INTO circuits (source_id, state, advances, opened_at, reason, revision) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_id) DO UPDATE SET state = excluded.state, advances = excluded.advances, opened_at = excluded.opened_at,
        reason = excluded.reason, revision = excluded.revision`)
      .run(circuit.sourceId, circuit.state, JSON.stringify(circuit.advances), circuit.openedAt, circuit.reason, circuit.revision);
  }

  #openCount(sourceId: string): number {
    return (this.#statement("SELECT count(*) AS open FROM incidents WHERE source_id = ? AND state = 'open'").get(sourceId) as { open: number }).open;
  }

  #spoolBytes(): number {
    return (this.#statement("SELECT coalesce(sum(bytes), 0) AS total FROM evidence").get() as { total: number }).total;
  }

  #pragma(name: "page_count" | "page_size" | "freelist_count"): number {
    return (this.#statement(`PRAGMA ${name}`).get() as Record<string, number>)[name] as number;
  }

  #statement(sql: string): StatementSync {
    if (this.#closed) throw refuse("SOURCE_UNAVAILABLE", "journal-closed", `The journal at ${this.path} is closed.`);
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }
}
