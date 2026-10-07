import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

// streamotter.dev generates its API reference from these doc comments, so every public export and
// every member of an exported interface, class, or object type needs one. `@internal` opts a
// declaration out; the reference leaves it out too.
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
const ENTRIES = ["client", "gateway", "contracts", "operator", "management", "cli"];

function program(): ts.Program {
  return ts.createProgram(ENTRIES.map(entry => `${SRC}${entry}.ts`), {
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2023,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"], types: ["node"], strict: true, noEmit: true,
    allowImportingTsExtensions: true, customConditions: ["streamotter-source"]
  });
}

const ours = (declaration: ts.Declaration) => declaration.getSourceFile().fileName.startsWith(PACKAGES);
const internal = (symbol: ts.Symbol) => symbol.declarations?.some(declaration => ts.getJSDocTags(declaration).some(tag => tag.tagName.text === "internal")) ?? false;

function documented(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (symbol.getDocumentationComment(checker).length > 0) return true;
  // A function's comment belongs to its signatures.
  return (symbol.declarations ?? []).some(declaration => ts.isFunctionDeclaration(declaration) && ts.getJSDocCommentsAndTags(declaration).length > 0);
}

/** The members a reader expects described: an interface's or class's own, or an object type alias's. */
function members(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol[] {
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) return [];
  if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
    return [...symbol.members?.values() ?? []].filter(member => !(member.flags & ts.SymbolFlags.TypeParameter) && member.escapedName !== "__constructor" && member.escapedName !== "__index");
  }
  if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
    return checker.getPropertiesOfType(checker.getTypeAtLocation(declaration.type));
  }
  return [];
}

test("every public export of the streamotter entry points has a doc comment, and so does each member", () => {
  const built = program();
  const checker = built.getTypeChecker();
  const missing: string[] = [];
  const seen = new Set<ts.Symbol>();
  for (const entry of ENTRIES) {
    const file = built.getSourceFile(`${SRC}${entry}.ts`);
    assert.ok(file, entry);
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (seen.has(symbol) || internal(symbol) || !(symbol.declarations ?? []).some(ours)) continue;
      seen.add(symbol);
      if (!documented(symbol, checker)) missing.push(`${entry}: ${symbol.name}`);
      for (const member of members(symbol, checker)) {
        if (!(member.declarations ?? []).some(ours) || internal(member)) continue;
        if (member.getDocumentationComment(checker).length === 0) missing.push(`${entry}: ${symbol.name}.${member.name}`);
      }
    }
  }
  assert.ok(seen.size > 200, `only ${seen.size} exports were found; the entry points did not resolve`);
  assert.deepEqual(missing, []);
});
