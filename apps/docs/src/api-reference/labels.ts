/** Display names for the reference's kinds of declaration, and the order export lists group them in. */
import type { ApiKind } from "./build.ts";

/** The name each kind of declaration goes by on its page and in an ungrouped export list. */
export const KIND_LABELS: Readonly<Record<ApiKind, string>> = {
  function: "Function", class: "Class", variable: "Constant", interface: "Interface", type: "Type alias", enum: "Enum", namespace: "Namespace"
};

/** The headings an export list grouped by kind uses, in order. Enums are listed with the constants. */
export const KIND_GROUPS: readonly { label: string; kinds: readonly ApiKind[] }[] = [
  { label: "Functions", kinds: ["function"] },
  { label: "Classes", kinds: ["class"] },
  { label: "Constants", kinds: ["variable", "enum"] },
  { label: "Interfaces", kinds: ["interface"] },
  { label: "Type aliases", kinds: ["type"] },
  { label: "Namespaces", kinds: ["namespace"] }
];
