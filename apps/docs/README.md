# StreamOtter docs site

The source of docs.streamotter.dev: the guides from `docs/guides/`, the API reference generated
from the packages' type declarations and doc comments, and Under the Hood from
`docs/under-the-hood/` when that folder exists. The site keeps no second copy of any of them.

## Develop

```sh
pnpm install
pnpm build                                 # the packages' declarations, which /api/ reads
pnpm --filter @streamotter/docs dev        # http://127.0.0.1:4322
```

## Check

```sh
pnpm --filter @streamotter/docs test       # the reference builder and the guide links
pnpm --filter @streamotter/docs build
pnpm --filter @streamotter/docs exec tsc --noEmit -p .   # .ts and .mjs; .astro files aren't type-checked
pnpm --filter @streamotter/docs check:links
```

`packages/streamotter/test/api-docs.test.ts` requires a doc comment on every public export and
member, so the reference has no blank entries.

## Publish

A build is a preview unless `DOCS_CHANNEL=release`: every page carries the unreleased-preview
banner and `noindex`, and repository links open on main. docs.streamotter.dev is built only from
a release tag, with `DOCS_CHANNEL=release`, and the build fails anywhere else. DESIGN.md's
"Publishing" section has the policy and the build steps. The output is static files in
`apps/docs/dist/`. Hosting and DNS for docs.streamotter.dev are not set up yet.
