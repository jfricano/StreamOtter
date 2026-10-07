/**
 * Builds the site's API reference (/api/) from the workspace's `streamotter` package, as built by
 * `pnpm build`: the same declarations npm publishes, so the reference can't drift from the code.
 * Deploys build from a release tag. TypeDoc reads the type declarations, comments included, once
 * per dev server or build, and
 * src/api-reference/build.ts turns its model into the pages' data. The pages import it from
 * `virtual:streamotter-docs/api-reference`. A declaration TypeDoc can't read fails the build.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { Application, LogLevel } from "typedoc";
import { buildApiReference } from "../src/api-reference/build.ts";
import { API_MODULES } from "../src/api-reference/modules.ts";

const VIRTUAL = "virtual:streamotter-docs/api-reference";
const REPOSITORY = "https://github.com/jfricano/StreamOtter";

/** The workspace's streamotter package: its directory and version. Its declarations must be built. */
export function installedStreamotter() {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("streamotter/package.json");
  const dir = dirname(manifest);
  if (!existsSync(join(dir, "dist", "client.d.ts"))) throw new Error("API reference: the streamotter package has no declarations yet. Run `pnpm build` at the repository root first.");
  return { dir, version: require(manifest).version, exports: Object.keys(require(manifest).exports), require: createRequire(manifest) };
}

/**
 * The import paths this release exports, in modules.ts order. Throws when the package exports an
 * entry point modules.ts doesn't describe, so a new one can't ship undocumented.
 */
export function documentedModules(installed = installedStreamotter()) {
  const exported = installed.exports.filter(path => path !== "./package.json").map(path => `streamotter${path.slice(1)}`);
  const missing = exported.filter(path => !API_MODULES.some(module => module.importPath === path));
  if (missing.length > 0) throw new Error(`API reference: describe ${missing.join(", ")} in src/api-reference/modules.ts.`);
  return API_MODULES.filter(module => exported.includes(module.importPath));
}

/**
 * A declaration's file on GitHub at the release's tag. TypeDoc names files by their path from the
 * streamotter package (`../contracts/dist/types.d.ts` in the workspace, or
 * `@streamotter/contracts/dist/types.d.ts` when installed); each is emitted from the same path
 * under `packages/<name>/src/`, so the link opens the source, not the declaration.
 */
export function sourceUrlFor(version) {
  return fileName => {
    const match = /(?:^|\/)(?:@streamotter|packages|\.\.)\/([\w-]+)\/dist\/(.+)\.d\.ts$/.exec(fileName.split(sep).join("/"));
    return match ? `${REPOSITORY}/blob/v${version}/packages/${match[1]}/src/${match[2]}.ts` : null;
  };
}

/** Runs TypeDoc over the installed release's entry points and returns its JSON model. */
export async function readStreamotterModel(installed = installedStreamotter()) {
  // Contracts first: a symbol several entry points export is documented where it is declared.
  const order = ["contracts", ...documentedModules(installed).map(module => module.entry).filter(entry => entry !== "contracts")];
  const entryPoints = order.map(entry => join(installed.dir, "dist", `${entry}.d.ts`));
  // The declarations import node: modules; @types/node is this app's own dependency.
  const typesNode = dirname(createRequire(import.meta.url).resolve("@types/node/package.json"));
  const work = mkdtempSync(join(tmpdir(), "streamotter-docs-api-reference-"));
  try {
    const tsconfig = join(work, "tsconfig.json");
    writeFileSync(tsconfig, JSON.stringify({
      compilerOptions: {
        module: "NodeNext", moduleResolution: "NodeNext", target: "ES2023", lib: ["ES2023", "DOM"], strict: true, noEmit: true,
        types: ["node"], typeRoots: [dirname(typesNode)]
      },
      files: entryPoints
    }));
    const app = await Application.bootstrap({
      entryPoints, tsconfig, logLevel: LogLevel.Warn, excludeInternal: true, excludePrivate: true, excludeProtected: true,
      // The package was type-checked when it was released; its declarations are read as published.
      skipErrorChecking: true, readme: "none", plugin: [], sort: ["source-order"]
    });
    const project = await app.convert();
    if (project === undefined || app.logger.hasErrors()) throw new Error(`API reference: TypeDoc could not read streamotter@${installed.version}; its errors are logged above.`);
    return app.serializer.projectToObject(project, installed.dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The reference's data for the installed release. */
export async function loadApiReference(installed = installedStreamotter()) {
  const model = await readStreamotterModel(installed);
  return buildApiReference(model, { release: installed.version, modules: documentedModules(installed), sourceUrl: sourceUrlFor(installed.version) });
}

/** The Astro integration: builds the reference once and serves it as a virtual module. */
export default function apiReference() {
  let reference = null;
  return {
    name: "streamotter-docs-api-reference",
    hooks: {
      "astro:config:setup": async ({ updateConfig }) => {
        reference = await loadApiReference();
        updateConfig({ vite: { plugins: [{
          name: "streamotter-docs-api-reference",
          resolveId: id => id === VIRTUAL ? `\0${VIRTUAL}` : undefined,
          load: id => id === `\0${VIRTUAL}` ? `export default ${JSON.stringify(reference)};` : undefined
        }] } });
      }
    }
  };
}
