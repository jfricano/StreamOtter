# StreamOtter V1.2.1 — Deferred minor fixes

V1.2.1 fixes the 33 minor findings the [V1.2 quality review](../v1.2/README.md) deferred and the [V1.1 review](../v1.1/REVIEW.md)'s deferred J7, tracked as issues #21 to #54. It adds no features. V1.2.1 is a milestone label, not a package version; whether it ships in `0.2.0-rc.1` with V1.1 and V1.2 is the owner's decision.

| Document | Contents |
| --- | --- |
| [FIXES.md](./FIXES.md) | Every issue: what changed, its regression test, and the docs it touched |
| [REVIEW.md](./REVIEW.md) | The independent review of the fixes: 19 minor findings, all fixed |
| [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md) | Plan, log, test runs and handoff |

**Status (October 4, 2026):** all 34 issues addressed on `feat/v1.2.1-minor-fixes`, stacked on the V1.2 fixes (PR #20). 31 are fixed outright; K-4 keeps its behavior with a warning and docs, K-6 is partly fixed (a clearer warning), and R-9 is documented rather than changed. Two fixes change behavior a user can see: P-6 raises the minimum `maxControlFrameBytes` to 9216, and P-2 answers schema-invalid params in production with `FORBIDDEN`. An independent review found 19 minor issues in the fixes and no majors; all are fixed. Every tier passes. Not released.
