/**
 * Builds dist/workbench-host.css from src/styles.css (WHC-1 §2.1): the same rules with every
 * selector scoped under the attribute the workbench sets on its mount element in hosted mode, so
 * nothing in the file can match outside the mount. Dependency-free and deliberately small: it
 * understands style rules and the conditional group rules `@media` and `@supports`, and refuses
 * everything else (`@keyframes`, `@font-face`, `@import`, nesting, `html`/`body`/`:root` anywhere
 * but at the start of a selector) by throwing, which fails the build.
 */

export const HOST_SCOPE = "[data-streamotter-workbench]";

const GROUP_RULES = new Set(["media", "supports"]);
/** Selectors that stand for the whole document in styles.css and become the mount element itself. */
const DOCUMENT_ROOTS = new Set(["html", "body", ":root"]);

type Item = { kind: "rule"; prelude: string; body: string } | { kind: "group"; prelude: string; items: Item[] };

export class CssScopeError extends Error {}

/** Returns the scoped stylesheet, or throws CssScopeError naming the construct it cannot scope safely. */
export function scopeStylesheet(css: string, scope: string = HOST_SCOPE): string {
  const items = parse(stripComments(css));
  const lines: string[] = [];
  emit(items, scope, "", lines);
  return `${lines.join("\n")}\n`;
}

function stripComments(css: string): string {
  let out = "";
  let quote: string | null = null;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]!;
    if (quote !== null) {
      out += char;
      if (char === "\\") out += css[++index] ?? "";
      else if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") {
      quote = char;
      out += char;
    } else if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      if (end < 0) throw new CssScopeError("Unterminated comment.");
      index = end + 1;
    } else {
      out += char;
    }
  }
  if (quote !== null) throw new CssScopeError("Unterminated string.");
  return out;
}

/** Index just past the `}` that closes the block whose `{` is at `open`, skipping strings. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index]!;
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new CssScopeError(`Unbalanced "{" near: ${css.slice(open - 40, open + 1).trim()}`);
}

function parse(css: string): Item[] {
  const items: Item[] = [];
  let start = 0;
  let quote: string | null = null;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]!;
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === ";") throw new CssScopeError(`Statement outside a rule cannot be scoped: ${css.slice(start, index + 1).trim()}`);
    else if (char === "}") throw new CssScopeError(`Unbalanced "}" after: ${css.slice(start, index).trim().slice(-40)}`);
    else if (char === "{") {
      const prelude = css.slice(start, index).trim();
      const end = blockEnd(css, index);
      const body = css.slice(index + 1, end - 1);
      if (prelude.startsWith("@")) {
        const name = /^@([A-Za-z-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
        if (!GROUP_RULES.has(name)) throw new CssScopeError(`@${name} cannot be scoped to the mount (its names or effects are global): ${prelude}`);
        items.push({ kind: "group", prelude: prelude.replace(/\s+/g, " "), items: parse(body) });
      } else {
        if (prelude === "") throw new CssScopeError("A rule has no selector.");
        if (withoutStrings(body).includes("{")) throw new CssScopeError(`Nested rules cannot be scoped: ${prelude}`);
        items.push({ kind: "rule", prelude, body });
      }
      index = end - 1;
      start = end;
    }
  }
  if (quote !== null) throw new CssScopeError("Unterminated string.");
  const rest = css.slice(start).trim();
  if (rest !== "") throw new CssScopeError(`Unterminated rule or statement: ${rest.slice(0, 60)}`);
  return items;
}

/** Splits a selector list on top-level commas (not inside brackets, parentheses or strings). */
function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index]!;
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(prelude.slice(start, index));
      start = index + 1;
    }
    if (depth < 0) throw new CssScopeError(`Unbalanced brackets in selector: ${prelude}`);
  }
  if (depth !== 0 || quote !== null) throw new CssScopeError(`Unbalanced brackets in selector: ${prelude}`);
  parts.push(prelude.slice(start));
  return parts.map(part => part.trim().replace(/\s+/g, " "));
}

function withoutStrings(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "\"\"");
}

/** The selector with strings and attribute selectors blanked, so a value like `[title="body"]` is not mistaken for a type selector. */
function structure(selector: string): string {
  return withoutStrings(selector).replace(/\[[^\]]*\]/g, "[]");
}

function scopeSelector(selector: string, scope: string): string[] {
  if (selector === "") throw new CssScopeError("Empty selector in a selector list.");
  if (/^[>+~]/.test(selector)) throw new CssScopeError(`A selector cannot start with a combinator: ${selector}`);
  if (selector === "*") return [scope, `${scope} *`];
  const leading = /^(html|body|:root)(?=$|\s)/i.exec(selector)?.[1];
  const rest = leading === undefined ? selector : selector.slice(leading.length).trim();
  const shape = structure(rest);
  if (/(^|[\s>+~(,])(html|body)(?=$|[\s>+~.#:[),])/i.test(shape) || /:(root|host|scope)\b|::slotted|&/i.test(shape)) {
    throw new CssScopeError(`Cannot scope "${selector}": it refers to the document root or to nesting outside the leading position.`);
  }
  if (leading !== undefined) return [rest === "" ? scope : `${scope} ${rest}`];
  return [`${scope} ${selector}`];
}

function emit(items: readonly Item[], scope: string, indent: string, lines: string[]): void {
  for (const item of items) {
    if (item.kind === "group") {
      lines.push(`${indent}${item.prelude} {`);
      emit(item.items, scope, `${indent}  `, lines);
      lines.push(`${indent}}`);
      continue;
    }
    const selectors = [...new Set(splitSelectors(item.prelude).flatMap(selector => scopeSelector(selector, scope)))];
    for (const selector of selectors) {
      // The invariant the file exists for: every selector is the mount or something inside it.
      if (selector !== scope && !selector.startsWith(`${scope} `)) throw new CssScopeError(`Unscoped selector produced: ${selector}`);
    }
    const body = item.body.trim().replace(/\s*\n\s*/g, " ");
    lines.push(`${indent}${selectors.join(", ")} { ${body} }`);
  }
}
