# Under the Hood accuracy review

October 7, 2026 · Pages checked against `main` at 1c75aaa

Before publication, five independent reviewers who had not written the pages checked each part claim by claim against the code and docs at 1c75aaa. Every finding was fixed in the pages; nothing was waived. Line-number citations (82 of them) were also removed, so file references stay valid as the code moves.

| Part | Claims checked (approx.) | Findings |
| --- | --- | --- |
| Introduction and 1 How it works | 150 | 9 |
| 2 How it's built | 120 | 18 |
| 3 Why it's built this way | 80 | 14 |
| 4 Guarantees and limits | 110 | 14 |
| 5 Using and running it | 110 | 14 |

## The corrections that matter most

- **Revocation (parts 2 and 4).** The pages said the gateway remembers a revocation so a reconnect can't restore access. It doesn't: `RevocationLog` is short-lived and only stops work already in flight. Keeping a revoked user out on reconnect is the application's job, as V1_API.md §2 says.
- **The commit point (part 1).** The offset commit doesn't come before delivery. Admission can already send the frame before `process()` returns "commit"; the commit just never waits for the browser.
- **Promises in part 4.** "Every record is processed at least once", "a probing browser learns nothing", "other browsers aren't affected" and "a view never shows an older revision in a browser's lifetime" were all stronger than the code. Each now states the real bound and its exceptions.
- **Commands in part 5.** `init <dir> --failures`, bare `validate` and bare `failures list` don't run as written; the journal setup was missing its parent-directory step; restarting `dev` with fixture data ends in `resync-required`, not `live`.
- **Decision records in part 3.** Three owner decisions on September 29, not two; the shipped journal engine is the October 4 decision D1; kafka-penguin is recorded in the V1.1 spec; Protobuf is beyond V3.
- **Code structure in part 2.** The CLI command list, which objects implement `SourceSink` and `OperatorHost`, `WaiterSet`, generations versus epochs, and `ProcessOutcome`'s four variants.

Configurable defaults are now labeled as defaults throughout.
