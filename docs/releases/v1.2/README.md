# StreamOtter V1.2 — Quality review

V1 never had a review by anyone who hadn't written the code. V1.2 is that review, run on V1 and V1.1 together so that its fixes can't break V1.1. It adds no features. V1.1, V1.2 and V1.2.1 (the fixes for the minors deferred here) ship together as `0.2.0-rc.1`, with one [CHANGELOG](../../../CHANGELOG.md) entry. V1.2 is a milestone label, not a package version.

| Document | Contents |
| --- | --- |
| [REVIEW_PLAN.md](./REVIEW_PLAN.md) | Scope, reviewers and method |
| [PHASE_A_FINDINGS.md](./PHASE_A_FINDINGS.md) | V1 code that V1.1 never touched: 10 major, 33 minor |
| [PHASE_B_FINDINGS.md](./PHASE_B_FINDINGS.md) | V1 code that V1.1 changed: 5 major, 24 minor |
| [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md) | Log, the minors fixed and deferred, and test runs |

**Status (October 4, 2026):** every major is fixed with a regression test, and so are 25 minors, in PR #20, which targets `main` now that V1.1 (#55) is merged. Not released.
