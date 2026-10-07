/** A happy-dom document for rendering React in Node's test runner, with `act` enabled. */
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3000/" });
const globals = globalThis as Record<string, unknown>;
globals["window"] = window;
globals["document"] = window.document;
globals["IS_REACT_ACT_ENVIRONMENT"] = true;

export function container(): Element {
  return window.document.body.appendChild(window.document.createElement("div")) as unknown as Element;
}
