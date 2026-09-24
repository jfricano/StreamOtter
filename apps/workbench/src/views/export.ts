import { ApiError } from "../api.ts";
import { h, replace } from "../dom.ts";
import { candidateDiffers, type WorkbenchState } from "../state.ts";

export function renderExport(root: HTMLElement, state: WorkbenchState): void {
  const output = h("div", { class: "stack" });
  const button = h("button", { class: "primary", type: "button" }, "Export candidate");
  button.addEventListener("click", async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.candidateText);
    } catch (error) {
      replace(output, h("div", { class: "banner bad", role: "alert" }, `The candidate is not valid JSON: ${(error as Error).message}`));
      return;
    }
    try {
      const exported = await state.api.export(parsed as never);
      const url = URL.createObjectURL(new Blob([exported.content], { type: "application/json" }));
      const differs = candidateDiffers(state);
      replace(output,
        differs
          ? h("div", { class: "banner warn", role: "status" }, h("strong", {}, "Restart required. "), "Save this file as streamotter.json and restart streamotter dev. The running gateway is unchanged until then.")
          : h("div", { class: "banner info", role: "status" }, "This export matches the active configuration."),
        h("div", { class: "row" },
          h("a", { href: url, download: exported.filename, class: "mono" }, `Download ${exported.filename}`),
          h("span", { class: "muted small mono" }, `sha256:${exported.fingerprint}`)),
        h("h3", {}, "Verify and generate from the CLI"),
        h("pre", { class: "data-view" }, [
          "streamotter validate --config streamotter.json",
          `# expect: Fingerprint: sha256:${exported.fingerprint}`,
          "streamotter generate --config streamotter.json --out src/generated"
        ].join("\n")),
        h("h3", { id: "canonical-heading" }, "Canonical content"),
        h("pre", { class: "data-view", "aria-labelledby": "canonical-heading" }, exported.content));
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.error.details?.["issues"])) {
        const issues = error.error.details["issues"] as { path: string; code: string; message: string }[];
        replace(output, h("div", { class: "banner bad", role: "alert" }, h("strong", {}, "Not exported: the candidate is invalid."),
          h("ul", { class: "issues" }, issues.map(issue => h("li", {}, h("code", {}, issue.path || "/"), ` ${issue.code}: ${issue.message}`)))));
      } else {
        replace(output, h("div", { class: "banner bad", role: "alert" }, (error as Error).message));
      }
    }
  });

  replace(root,
    h("section", { class: "panel stack" },
      h("div", {},
        h("h2", {}, "Export"),
        h("p", { class: "lede" }, "Exports produce canonical, reviewable streamotter.json (sorted keys, secrets only as environment references). The workbench never writes files or changes the running gateway; the CLI validates the same fingerprint and generates your AppChannels types.")),
      h("div", { class: "row" }, button),
      output),
    h("section", { class: "panel stack" },
      h("h3", {}, "Integrate"),
      h("p", {}, "Generated types plus the TypeScript SDK:"),
      h("pre", { class: "data-view" }, [
        "import { createClient } from \"@streamotter/client\";",
        "import { channelVersions, type AppChannels } from \"./generated/streamotter.generated.js\";",
        "",
        `const client = createClient<AppChannels>({ origin: "${state.gatewayOrigin}", getToken: ({ signal }) => session.getAccessToken(signal) });`,
        `const sub = client.subscribe("${state.channels[0]?.name ?? "channelName"}", { channelVersion: channelVersions.${state.channels[0]?.name ?? "channelName"}, params });`,
        "sub.on(\"data\", event => render(event.data));",
        "sub.on(\"state\", ({ state }) => showDeliveryState(state)); // \"live\" means synchronized",
        "sub.on(\"error\", error => showStreamError(error));",
        "await sub.ready();",
        "// On unmount: await sub.unsubscribe();"
      ].join("\n"))));
}
