import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import streamotter from "streamotter/package.json" with { type: "json" };
import { docsChannel, repositoryRef } from "../integrations/release-channel.mjs";

/**
 * The workspace's streamotter version. A release build is built from this version's tag, so the
 * site describes that release. On main between releases it is still the last version published
 * to npm, which a preview's banner names.
 */
export const RELEASE: string = streamotter.version;

const CHANNEL = docsChannel();
/** A preview build, not a release (docs.streamotter.dev); see integrations/release-channel.mjs. */
export const PREVIEW: boolean = CHANNEL === "preview";

/** The release a preview build describes ahead of time. Raise it once that release is out. */
export const UPCOMING = "1.0";

/** How pages name the version they describe: `v1.0.0`, or `1.0 preview`. */
export const VERSION_LABEL: string = PREVIEW ? `${UPCOMING} preview` : `v${RELEASE}`;

/** The banner on every page of a preview build (jason's wording, 2026-10-08). */
export const PREVIEW_BANNER = {
  title: `Unreleased ${UPCOMING} preview, npm latest is ${RELEASE}.`,
  detail: "These pages describe the main branch, and some of what they document isn't published yet."
} as const;

const REPOSITORY = "https://github.com/jfricano/StreamOtter";
/** Where repository links open: this release's tag, so they survive later commits, or main in a preview. */
export const REF: string = repositoryRef(CHANNEL, RELEASE);

export const LINKS = {
  home: "https://streamotter.dev",
  github: REPOSITORY,
  npm: "https://www.npmjs.com/package/streamotter",
  release: `https://www.npmjs.com/package/streamotter/v/${RELEASE}`,
  v1Api: `${REPOSITORY}/blob/${REF}/docs/V1_API.md`,
  v11Api: `${REPOSITORY}/blob/${REF}/docs/releases/v1.1/V1_1_API.md`,
  v11Spec: `${REPOSITORY}/blob/${REF}/docs/releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md`,
  v11Decisions: `${REPOSITORY}/tree/${REF}/docs/releases/v1.1/adr`,
  status: `${REPOSITORY}/blob/${REF}/docs/IMPLEMENTATION_STATUS.md`,
  deployment: `${REPOSITORY}/blob/${REF}/docs/DEPLOYMENT.md`,
  changelog: `${REPOSITORY}/blob/${REF}/CHANGELOG.md`
} as const;

/** The guides in docs/guides/, in reading order. Each page's title is its file's own heading. */
export const GUIDES = [
  { slug: "getting-started", label: "Start with a live channel", summary: "Scaffold a fixture project, open the local workbench, and subscribe from a browser." },
  { slug: "existing-app", label: "Add StreamOtter to your app", summary: "Connect your identity, handlers, and authoritative state to an existing application." },
  { slug: "kafka", label: "Connect to Kafka", summary: "Configure a broker connection and move from fixture records to a Kafka source." },
  { slug: "troubleshooting", label: "Troubleshoot a view", summary: "Follow state changes, source health, and errors to the part that needs attention." },
  { slug: "source-failures", label: "Handle bad records", summary: "Turn on source-failure policies, write an honest recovery guard, and operate incidents from the CLI." }
] as const;

/**
 * The repository root. A build bundles this module elsewhere, so astro.config.mjs passes the root
 * in; run directly (in tests), the module finds it from its own path.
 */
const ROOT = typeof __STREAMOTTER_ROOT__ === "string" ? __STREAMOTTER_ROOT__ : fileURLToPath(new URL("../../../", import.meta.url));

/** docs/under-the-hood/ in the repository, served as is at /under-the-hood/ when it exists. */
export const UNDER_THE_HOOD_DIR = `${ROOT}docs/under-the-hood/`;
export const HAS_UNDER_THE_HOOD = existsSync(`${UNDER_THE_HOOD_DIR}index.html`);

/** The site's sections, in the header and the footer. */
export const SECTIONS = [
  { href: "/guides/", label: "Guides" },
  { href: "/api/", label: "API reference" },
  ...(HAS_UNDER_THE_HOOD ? [{ href: "/under-the-hood/", label: "Under the Hood" }] : [])
] as const;
