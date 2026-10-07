import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blog.streamotter.dev",
  server: { host: "127.0.0.1", port: 4323 },
  markdown: {
    // The theme the docs site's global styles tune for contrast, so code reads the same on both sites.
    shikiConfig: { theme: "night-owl" }
  }
});
