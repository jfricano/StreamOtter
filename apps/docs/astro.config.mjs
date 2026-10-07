import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import apiReference from "./integrations/api-reference.mjs";
import { rewriteRepositoryLinks } from "./integrations/repository-links.mjs";

export default defineConfig({
  site: "https://docs.streamotter.dev",
  server: { host: "127.0.0.1", port: 4322 },
  // /api/ is generated from the workspace's streamotter declarations; see integrations/api-reference.mjs.
  integrations: [apiReference()],
  vite: { define: { __STREAMOTTER_ROOT__: JSON.stringify(fileURLToPath(new URL("../../", import.meta.url))) } },
  markdown: {
    // The guides are written for GitHub; their links to other repository files open there.
    rehypePlugins: [rewriteRepositoryLinks]
  }
});
