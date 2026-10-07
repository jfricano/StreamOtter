import { readFileSync } from "node:fs";

/**
 * The streamotter entry points, by source file name (`client`, `operator`), read from the
 * package's `exports`, so a new entry point is checked as soon as it is exported. Contracts comes
 * first, so a symbol several entry points share is reported under the one that declares it.
 */
export function entryPoints(): string[] {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> };
  const entries = Object.entries(manifest.exports)
    .filter(([path]) => path !== "./package.json")
    .map(([path, target]) => {
      const source = (target as Record<string, string>)["streamotter-source"];
      if (source === undefined) throw new Error(`packages/streamotter/package.json: ${path} has no streamotter-source condition`);
      return source.replace(/^\.\/src\/|\.ts$/g, "");
    });
  return [...entries.filter(entry => entry === "contracts"), ...entries.filter(entry => entry !== "contracts")];
}
