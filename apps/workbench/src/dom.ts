type Child = Node | string | number | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | null | undefined>;

/**
 * Minimal element builder. Text is always inserted as text nodes, never parsed as
 * HTML, so gateway data and diagnostics cannot inject markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(key, "");
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

export function replace(target: Element, ...children: (Child | Child[])[]): void {
  target.replaceChildren(...children.flat().filter((child): child is Node | string | number => child !== null && child !== undefined && child !== false)
    .map(child => (child instanceof Node ? child : String(child))));
}

export function pill(text: string, tone: "ok" | "warn" | "bad" | "info" | "neutral"): HTMLSpanElement {
  return h("span", { class: `pill ${tone}` }, text);
}

export function time(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function short(id: string | undefined, length = 8): string {
  return id === undefined ? "" : id.slice(0, length);
}
