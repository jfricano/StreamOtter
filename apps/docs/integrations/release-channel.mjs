/**
 * Which build this is, set by the DOCS_CHANNEL environment variable when the site is built:
 *
 * - `release`: docs.streamotter.dev. The build fails unless the checkout is at the release tag for
 *   the workspace's streamotter version (`v1.0.0` for 1.0.0) and that version is not a prerelease,
 *   so production only ever describes a release npm has.
 * - `preview` (the default, so a build nobody configured can't pass for production): every page
 *   carries the unreleased-preview banner and `noindex`, links to repository files open on `main`,
 *   and the output gets a `_headers` file that sends `X-Robots-Tag: noindex` for every path.
 *
 * jason set this policy on 2026-10-08; DESIGN.md's "Publishing" section has the build steps.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The channel `value` names; unset or empty means `preview`.
 * @param {string | undefined} value
 * @returns {"preview" | "release"}
 */
export function docsChannel(value = process.env.DOCS_CHANNEL) {
  if (value === undefined || value === "") return "preview";
  if (value === "preview" || value === "release") return value;
  throw new Error(`Docs: DOCS_CHANNEL is "${value}"; set it to "release" (docs.streamotter.dev, from a release tag) or "preview", or leave it unset for a preview.`);
}

/**
 * The git ref that links to repository files open at: the release tag, or `main` for a preview.
 * @param {"preview" | "release"} channel
 * @param {string} version the workspace's streamotter version
 */
export function repositoryRef(channel, version) {
  return channel === "release" ? `v${version}` : "main";
}

/**
 * Throws unless a release build may go out: `version` is a release, not a prerelease, and its tag
 * is one of `tagsAtHead`.
 * @param {string} version
 * @param {readonly string[]} tagsAtHead
 */
export function checkRelease(version, tagsAtHead) {
  if (version.includes("-")) throw new Error(`Docs: a release build needs a released version, and streamotter is ${version}. Build a preview instead (leave DOCS_CHANNEL unset).`);
  const tag = `v${version}`;
  if (!tagsAtHead.includes(tag)) {
    const found = tagsAtHead.length === 0 ? "no tag" : tagsAtHead.join(", ");
    throw new Error(`Docs: a release build must be built from the ${tag} tag, and this checkout has ${found}. Check out ${tag} with its tags fetched, then build again.`);
  }
}

/** The tags at the checkout's HEAD; none when git or the tags aren't there. */
export function tagsAtHead() {
  try {
    return execFileSync("git", ["tag", "--points-at", "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** The Astro integration: checks a release build before it starts and marks a preview's output. */
export default function releaseChannel() {
  const channel = docsChannel();
  return {
    name: "streamotter-docs-release-channel",
    hooks: {
      "astro:config:setup": ({ command }) => {
        if (command === "build" && channel === "release") checkRelease(createRequire(import.meta.url)("streamotter/package.json").version, tagsAtHead());
      },
      "astro:build:done": ({ dir }) => {
        // Cloudflare Pages reads _headers; the pages' own robots meta covers other hosts.
        if (channel === "preview") writeFileSync(new URL("_headers", dir), "/*\n  X-Robots-Tag: noindex\n");
      }
    }
  };
}
