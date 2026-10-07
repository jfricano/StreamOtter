import { randomBytes } from "node:crypto";
import { StreamOtterError, type OperationResult, type ProjectConfig } from "@streamotter/contracts";
import { MAX_OPERATOR_REASON } from "@streamotter/contracts/internal";
import { openJournal } from "./journal.ts";

/**
 * Offline rebaseline (spec §14, ADR-15A §3, ADR-15B §4). After an operator
 * changes a source's `generation` (V1's rebaseline: a recreated topic, another
 * cluster, a new consumer group), the open incidents of the old generation name
 * positions that no longer exist, and startup refuses them. This closes them as
 * rebaselined, with the operator's reason and an operation ID on each, and
 * records the new generation, which retires the old generation's boundaries.
 *
 * It never moves a consumer group and never skips a record in the current
 * generation: incidents of the configured generation are left alone. It opens
 * the journal itself, so it is refused while a gateway holds it.
 */
export function rebaselineSource(options: {
  stateDirectory: string;
  config: ProjectConfig;
  sourceId: string;
  reason: string;
  at?: string;
}): OperationResult & { closed: string[]; retiredBoundary: string | null; generation: string } {
  const { config, sourceId, reason } = options;
  const source = config.sources[sourceId];
  if (source === undefined) throw new StreamOtterError("INVALID_REQUEST", { message: `No configured source ${sourceId}.`, details: { reason: "unknown-source" } });
  if (reason.trim().length === 0 || reason.length > MAX_OPERATOR_REASON) {
    throw new StreamOtterError("INVALID_REQUEST", { message: `A reason of 1 to ${MAX_OPERATOR_REASON} characters is required.`, details: { reason: "reason" } });
  }
  const at = options.at ?? new Date().toISOString();
  const operationId = `op1:${randomBytes(16).toString("hex")}`;
  const generation = source.generation;
  const store = openJournal(options.stateDirectory, { projectId: config.projectId });
  try {
    // One transaction: the incidents close and the generation is recorded together, or nothing changes.
    return store.atomically(() => {
      const open = store.open(sourceId);
      const stale = open.filter(incident => incident.generation !== generation);
      const before = store.boundary(sourceId);
      const staleBoundary = before !== null && before.generation !== generation ? before.boundaryId : null;
      if (stale.length === 0 && staleBoundary === null) {
        const current = open.length;
        return {
          operationId, result: "refused", outcome: "nothing-to-rebaseline", incidentRevision: null, closed: [], retiredBoundary: null, generation,
          message: current > 0
            ? `Source ${sourceId} has ${current} open incident(s) in its configured generation "${generation}". Rebaselining applies only after the generation changes; resolve these with retry-current or a repair.`
            : `Source ${sourceId} has nothing from an earlier generation to rebaseline.`
        };
      }
      for (const incident of stale) {
        store.update(incident.failureId, incident.revision, { state: "resolved", resolution: `rebaselined to generation ${generation}` }, {
          at, event: "operator", detail: `rebaseline from generation ${incident.generation}: ${reason}`, operationId
        });
      }
      // Recording the new generation retires the old generation's boundaries (ADR-15B §4). Every other source is claimed as the
      // journal already records it, so this changes only this source: another source's changed generation or removal is the
      // gateway's startup check (and its own rebaseline), never a reason to refuse or alter this one.
      store.claim(config.projectId, store.sources().map(stored => stored.sourceId === sourceId ? { sourceId, generation, kind: source.kind } : stored));
      return {
        operationId, result: "completed", outcome: "rebaselined", incidentRevision: null, closed: stale.map(incident => incident.failureId),
        retiredBoundary: staleBoundary, generation,
        message: `Closed ${stale.length} incident(s) from earlier generations of ${sourceId}${staleBoundary === null ? "" : ` and retired boundary ${staleBoundary}`}; the source now runs as generation "${generation}".`
      };
    });
  } finally {
    store.close();
  }
}
