import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import streamotter from "streamotter/package.json" with { type: "json" };

/**
 * The StreamOtter version these docs describe: the workspace's streamotter package. Deploys build
 * from a release tag, so the published site matches that release.
 */
export const RELEASE: string = streamotter.version;

const REPOSITORY = "https://github.com/jfricano/StreamOtter";
/** The repository tag for this release, so links to the specifications survive later commits. */
const TAG = `v${RELEASE}`;

export const LINKS = {
  home: "https://streamotter.dev",
  github: REPOSITORY,
  npm: "https://www.npmjs.com/package/streamotter",
  release: `https://www.npmjs.com/package/streamotter/v/${RELEASE}`,
  v1Api: `${REPOSITORY}/blob/${TAG}/docs/V1_API.md`,
  v11Api: `${REPOSITORY}/blob/${TAG}/docs/releases/v1.1/V1_1_API.md`,
  v11Spec: `${REPOSITORY}/blob/${TAG}/docs/releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md`,
  v11Decisions: `${REPOSITORY}/tree/${TAG}/docs/releases/v1.1/adr`,
  status: `${REPOSITORY}/blob/${TAG}/docs/IMPLEMENTATION_STATUS.md`,
  deployment: `${REPOSITORY}/blob/${TAG}/docs/DEPLOYMENT.md`,
  changelog: `${REPOSITORY}/blob/${TAG}/CHANGELOG.md`
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
