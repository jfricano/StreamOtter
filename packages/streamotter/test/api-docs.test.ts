import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { entryPoints } from "./entries.ts";

// streamotter.dev generates its API reference from these doc comments, so every public export and
// every member of an exported interface, class, or object type needs one. `@internal` opts a
// declaration out, and the site's generator leaves those out too (`excludeInternal`).
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const PACKAGES = `${ROOT}packages/`;
const ENTRIES = entryPoints();

function program(): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(`${ROOT}tsconfig.check.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => assert.fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")) });
  assert.ok(config, "tsconfig.check.json");
  return ts.createProgram(ENTRIES.map(entry => `${SRC}${entry}.ts`), config.options);
}

const ours = (declaration: ts.Declaration) => declaration.getSourceFile().fileName.startsWith(PACKAGES);
const internal = (symbol: ts.Symbol) => symbol.declarations?.some(declaration => ts.getJSDocTags(declaration).some(tag => tag.tagName.text === "internal")) ?? false;

/** The object type literals an alias is made of, directly or as members of a union or intersection. */
function typeLiterals(node: ts.TypeNode): ts.TypeLiteralNode[] {
  if (ts.isTypeLiteralNode(node)) return [node];
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.flatMap(typeLiterals);
  if (ts.isParenthesizedTypeNode(node)) return typeLiterals(node.type);
  return [];
}

/** The members a reader expects described: an interface's or class's own, or those of an object type alias. */
function members(symbol: ts.Symbol, checker: ts.TypeChecker): { name: string; symbol: ts.Symbol }[] {
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) return [];
  if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
    const own = [...symbol.members?.values() ?? []].filter(member => !(member.flags & ts.SymbolFlags.TypeParameter) && member.escapedName !== "__index");
    const statics = [...symbol.exports?.values() ?? []].filter(member => member.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Property));
    return [...own, ...statics].map(member => ({ name: member.escapedName === "__constructor" ? "constructor" : member.name, symbol: member }));
  }
  if (ts.isTypeAliasDeclaration(declaration)) {
    return typeLiterals(declaration.type).flatMap(literal => literal.members.flatMap(member => {
      const memberSymbol = member.name === undefined ? undefined : checker.getSymbolAtLocation(member.name);
      return memberSymbol === undefined ? [] : [{ name: memberSymbol.name, symbol: memberSymbol }];
    }));
  }
  return [];
}

describe("API documentation", () => {
  it("checks every entry point the package exports, contracts first", () => {
    assert.equal(ENTRIES[0], "contracts");
    assert.ok(ENTRIES.includes("client") && ENTRIES.includes("gateway"), ENTRIES.join(", "));
  });

  it("every public export of the streamotter entry points has a doc comment, and so does each member", () => {
    const built = program();
    const checker = built.getTypeChecker();
    const missing: string[] = [];
    const seen = new Set<ts.Symbol>();
    for (const entry of ENTRIES) {
      const file = built.getSourceFile(`${SRC}${entry}.ts`);
      assert.ok(file, entry);
      const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)
        .map(exported => (exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported))
        .filter(symbol => (symbol.declarations ?? []).some(ours));
      assert.ok(exports.length > 0, `streamotter/${entry} exports nothing of ours; its re-exports did not resolve`);
      for (const symbol of exports) {
        if (seen.has(symbol) || internal(symbol)) continue;
        seen.add(symbol);
        if (symbol.getDocumentationComment(checker).length === 0) missing.push(`${entry}: ${symbol.name}`);
        for (const member of members(symbol, checker)) {
          if (!(member.symbol.declarations ?? []).some(ours) || internal(member.symbol)) continue;
          const documented = member.name === "constructor"
            ? member.symbol.declarations!.every(declaration => ts.getJSDocCommentsAndTags(declaration).length > 0)
            : member.symbol.getDocumentationComment(checker).length > 0;
          if (!documented) missing.push(`${entry}: ${symbol.name}.${member.name}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
