import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import ts from "typescript";
import { generateFiles, typeNames } from "@streamotter/cli";
import { validateProjectConfig, validateValue, type ProjectConfig, type Schema } from "@streamotter/contracts";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "tests/.generated-contracts");

const schemas: Record<string, Schema> = {
  "shipment-params": {
    type: "object", additionalProperties: false, required: ["shipmentId", "express", "attempt"],
    properties: { shipmentId: { type: "string", minLength: 1 }, express: { type: "boolean" }, attempt: { type: "integer", minimum: 0 } }
  },
  ShipmentState: {
    type: "object", additionalProperties: false, required: ["status", "legs", "eta", "carrier-code"],
    properties: {
      status: { type: "string", enum: ["pending", "in-transit", "delivered"] },
      legs: {
        type: "array", maxItems: 10,
        items: {
          type: "object", additionalProperties: false, required: ["from", "to"],
          properties: { from: { type: "string" }, to: { type: "string" }, km: { type: "number", minimum: 0 } }
        }
      },
      eta: { type: "null" },
      "carrier-code": { type: "string", maxLength: 8 },
      tags: { type: "array", maxItems: 3, items: { type: "string", enum: ["fragile", "cold"] } },
      note: { type: "string" }
    }
  },
  String: { type: "object", additionalProperties: false, required: [], properties: {} }
};

const config: ProjectConfig = {
  configVersion: 1,
  projectId: "shipping",
  gateway: { host: "127.0.0.1", port: 7400, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:3000"] },
  connections: {},
  sources: { shipments: { kind: "fixture", generation: "f1", fixtureRef: "shipments" } },
  schemas,
  channels: {
    shipmentStatus: {
      version: 3, source: "shipments", paramsSchema: "shipment-params", payloadSchema: "ShipmentState",
      handlersRef: "shipmentStatus", delivery: { kind: "state", overflow: "resync" }
    }
  }
};

const valid = {
  params: { shipmentId: "s1", express: true, attempt: 2 },
  data: { status: "in-transit", legs: [{ from: "A", to: "B", km: 12.5 }, { from: "B", to: "C" }], eta: null, "carrier-code": "UPS", tags: ["cold"] }
};
const invalid: [string, string, unknown][] = [
  ["unknown enum value", "data", { ...valid.data, status: "lost" }],
  ["missing required field", "data", { status: "pending", legs: [], eta: null }],
  ["extra property", "data", { ...valid.data, secretCost: 5 }],
  ["wrong nested type", "data", { ...valid.data, legs: [{ from: "A", to: 5 }] }],
  ["null where a string is required", "data", { ...valid.data, note: null }],
  ["missing parameter", "params", { shipmentId: "s1", express: true }],
  ["wrong parameter type", "params", { shipmentId: "s1", express: "yes", attempt: 1 }]
];

describe("generated contract types agree with schema validation", () => {
  after(() => rm(OUT, { recursive: true, force: true }));

  it("accepts at compile time exactly what runtime validation accepts for these samples", async () => {
    assert.equal(validateProjectConfig(config).valid, true);
    const payload = config.schemas["ShipmentState"]!;
    const params = config.schemas["shipment-params"]!;
    assert.equal(validateValue(payload, valid.data), null);
    assert.equal(validateValue(params, valid.params), null);
    for (const [label, kind, value] of invalid) {
      assert.notEqual(validateValue(kind === "data" ? payload : params, value), null, `runtime rejects ${label}`);
    }

    await mkdir(OUT, { recursive: true });
    for (const file of generateFiles(config)) await writeFile(join(OUT, file.path), file.content);
    const checks = [
      `import type { AppChannels, ShipmentParams, ShipmentState, StringSchema } from "./streamotter.generated.js";`,
      `import { channelVersions } from "./streamotter.generated.js";`,
      `import { createClient } from "@streamotter/client";`,
      `const version: 3 = channelVersions.shipmentStatus;`,
      `const params: ShipmentParams = ${JSON.stringify(valid.params)};`,
      `const data: ShipmentState = ${JSON.stringify(valid.data)};`,
      `const empty: StringSchema = {};`,
      ...invalid.map(([label, kind, value], index) =>
        `// @ts-expect-error ${label}\nconst invalid${index}: ${kind === "data" ? "ShipmentState" : "ShipmentParams"} = ${JSON.stringify(value)};`),
      `const client = createClient<AppChannels>({ origin: "http://localhost:7400", getToken: () => "t" });`,
      `const sub = client.subscribe("shipmentStatus", { channelVersion: 3, params });`,
      `sub.on("data", event => { const legs: number = event.data.legs.length; void legs; });`,
      `// @ts-expect-error the deployed version is fixed by the generated contract`,
      `client.subscribe("shipmentStatus", { channelVersion: 2, params });`,
      `void [version, data, empty, ${invalid.map((_, index) => `invalid${index}`).join(", ")}];`
    ].join("\n");
    await writeFile(join(OUT, "check.ts"), `${checks}\n`);

    const program = ts.createProgram([join(OUT, "check.ts"), join(OUT, "streamotter.client.example.ts")], {
      strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], customConditions: ["streamotter-source"], allowImportingTsExtensions: true,
      types: []
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic =>
      `${diagnostic.file?.fileName.replace(OUT, "") ?? ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    assert.deepEqual(diagnostics, []);
  });

  it("names colliding schema types the same whatever the schema key order", () => {
    const ids = ["order_row", "order-row", "Client", "client-schema", "OrderRow"];
    const expected = typeNames(ids);
    assert.deepEqual(Object.fromEntries(typeNames([...ids].reverse())), Object.fromEntries(expected));
    assert.equal(new Set(expected.values()).size, ids.length);
    // "shipment_params" and "shipment-params" both become ShipmentParams; the channel must keep its type name.
    const withTwin = (entries: [string, Schema][]): ProjectConfig => ({ ...config, schemas: Object.fromEntries(entries) });
    const entries: [string, Schema][] = [["shipment_params", schemas["String"]!], ...Object.entries(schemas)];
    const channelLine = (value: ProjectConfig) => /^ {2}shipmentStatus: .*$/m.exec(generateFiles(value)[0]!.content)?.[0];
    assert.equal(channelLine(withTwin(entries)), channelLine(withTwin([...entries].reverse())));
  });

  it("keeps line separators in names inside generated string literals", () => {
    const injection = (tail: string) => `x\u2028export const injected${tail} = 1; //`;
    const hostile: ProjectConfig = {
      ...config,
      schemas: {
        ...schemas,
        "shipment-params": {
          type: "object", additionalProperties: false, required: [injection("1"), "mode"],
          properties: { [injection("1")]: { type: "string" }, mode: { type: "string", enum: [`a\u2029export const injected2 = 2; //`] } }
        }
      }
    };
    assert.equal(validateProjectConfig(hostile).valid, true);
    for (const file of generateFiles(hostile)) {
      const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.ES2022);
      const declared = source.statements.flatMap(statement => ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map(declaration => declaration.name.getText(source)) : []);
      assert.deepEqual(declared.filter(name => name.startsWith("injected")), [], file.path);
      assert.doesNotMatch(file.content, /[\u2028\u2029]/, file.path);
    }
  });
});
