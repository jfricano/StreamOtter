import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import apiReference from "./integrations/api-reference.mjs";
import releaseChannel, { docsChannel, repositoryRef } from "./integrations/release-channel.mjs";
import { rewriteRepositoryLinks } from "./integrations/repository-links.mjs";

export default defineConfig({
  site: "https://docs.streamotter.dev",
  server: { host: "127.0.0.1", port: 4322 },
  // /api/ is generated from the workspace's streamotter declarations; see integrations/api-reference.mjs.
  // DOCS_CHANNEL picks a release or preview build; see integrations/release-channel.mjs.
  integrations: [releaseChannel(), apiReference()],
  vite: { define: { __STREAMOTTER_ROOT__: JSON.stringify(fileURLToPath(new URL("../../", import.meta.url))) } },
  markdown: {
    // The guides are written for GitHub; their links to other repository files open there, at the
    // release tag or, in a preview, main. The ref is an option so that a new one invalidates Astro's cache.
    rehypePlugins: [[rewriteRepositoryLinks, { ref: repositoryRef(docsChannel(), createRequire(import.meta.url)("streamotter/package.json").version) }]],
    // The theme the global styles tune for contrast, as in the API reference's examples.
    shikiConfig: { theme: "night-owl" }
  }
});
