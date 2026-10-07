/**
 * A rehype plugin for the guides, which are written to be read on GitHub: a link to another guide
 * opens its page here, and a link to any other repository file opens it on GitHub at this
 * release's tag. Absolute URLs and in-page anchors are left alone.
 */
import { createRequire } from "node:module";
import { posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "https://github.com/jfricano/StreamOtter";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VERSION = createRequire(import.meta.url)("streamotter/package.json").version;

/** Where a guide's relative link opens, given the guide's path from the repository root. */
export function repositoryLink(href, guidePath, version = VERSION) {
  if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) return href;
  const hashAt = href.indexOf("#");
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  if (path === "") return href;
  const target = posix.normalize(posix.join(posix.dirname(guidePath), path));
  const guide = /^docs\/guides\/([\w-]+)\.md$/.exec(target);
  if (guide) return `/guides/${guide[1]}/${hash}`;
  const kind = path.endsWith("/") ? "tree" : "blob";
  return `${REPOSITORY}/${kind}/v${version}/${target.replace(/\/$/, "")}${hash}`;
}

export function rewriteRepositoryLinks() {
  return (tree, file) => {
    if (!file.path) return;
    const guidePath = relative(ROOT, file.path).split(sep).join("/");
    const visit = node => {
      if (node.type === "element" && node.tagName === "a" && typeof node.properties?.href === "string") {
        node.properties.href = repositoryLink(node.properties.href, guidePath);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
