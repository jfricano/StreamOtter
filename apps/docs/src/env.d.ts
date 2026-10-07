/** The API reference's pages, built from the workspace's streamotter package (integrations/api-reference.mjs). */
declare module "virtual:streamotter-docs/api-reference" {
  const reference: import("./api-reference/build.ts").ApiReference;
  export default reference;
}

/** The repository root, with a trailing slash; defined by astro.config.mjs. */
declare const __STREAMOTTER_ROOT__: string | undefined;
