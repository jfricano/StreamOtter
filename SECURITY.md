# Security policy

## Supported versions

StreamOtter is pre-1.0. Security fixes go into the most recent release only: currently the `0.1.x` line, including its release candidates. All six packages (`streamotter` and the five `@streamotter/*` packages) are released together, so update them together.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub's vulnerability reporting: <https://github.com/jfricano/StreamOtter/security/advisories/new>.

Please include:

- the affected package(s) and version;
- the configuration and handler shape needed to reproduce the problem (minimal, with no real credentials);
- the steps to reproduce, and what an attacker gains: data from another tenant or user, access that survives revocation, a way around bounded delivery, secrets in logs or traces, and so on.

We will acknowledge the report, keep you informed while we investigate, coordinate a fix and its disclosure with you, and credit you if you wish.

## Scope

In scope: anything that breaks the guarantees the [V1 specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md) makes. For example:

- the gateway delivering data without a successful `authenticate` and `authorize`, or across the tenant boundary set by your `map` handler;
- revoked or expired access continuing to receive data, or being restored by reconnecting;
- the development management API or workbench being reachable from `streamotter start`, from a non-loopback address, or without its token and origin checks;
- credentials or payloads appearing in logs, traces, or public error messages;
- a single client growing gateway memory without bound, or blocking source progress;
- the SDK showing a previous account's data after an account switch.

These are out of scope, because they are development-only or by design:

- the reference example's demo identities and signing secret (the example refuses to run with `NODE_ENV=production`);
- the local Kafka credentials and throwaway certificate authority created by `scripts/kafka` for tests;
- V1's documented limits: a single gateway, no durable revocation store, and no production health endpoint;
- vulnerabilities in your own handlers, or in third-party dependencies with no StreamOtter-specific impact (please report those upstream).
