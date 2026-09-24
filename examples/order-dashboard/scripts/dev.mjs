/**
 * Runs the example locally: the application server and `streamotter dev` (gateway +
 * workbench). Pass --kafka for Kafka mode (requires `pnpm kafka:start`); the app starts
 * first there because it creates the topic and publishes the seeded state.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const kafka = process.argv.includes("--kafka");
const cli = fileURLToPath(new URL("../node_modules/@streamotter/cli/bin/streamotter.js", import.meta.url));
const children = [];
let stopping = false;

function start(name, args, readyPattern) {
  return new Promise(resolve => {
    // The app uses KafkaJS 2.2.4 directly; its harmless TimeoutNegativeWarning is silenced here.
    // (The gateway's source adapter carries its own fix for that KafkaJS timer.)
    const flags = name === "app" ? ["--disable-warning=TimeoutNegativeWarning"] : [];
    const child = spawn(process.execPath, [...flags, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    children.push(child);
    const prefix = name === "app" ? "[app] " : "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", text => {
        process.stdout.write(text.split("\n").map(line => (line === "" ? line : prefix + line)).join("\n"));
        if (readyPattern.test(text)) resolve();
      });
    }
    child.on("exit", code => {
      resolve();
      if (!stopping) {
        console.error(`${name} exited (${code}); stopping.`);
        stop();
      }
    });
  });
}

function stop() {
  stopping = true;
  for (const child of children) child.kill("SIGINT");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const app = () => start("app", ["dist/server/app.js", ...(kafka ? ["--kafka"] : [])], /Order dashboard/);
const gateway = () => start("streamotter", [cli, "dev", "--config", kafka ? "streamotter.kafka.json" : "streamotter.json", "--handlers", `dist/server/${kafka ? "kafka" : "fixture"}-handlers.js`], /Press Ctrl\+C/);
if (kafka) {
  await app();
  if (!stopping) await gateway();
} else {
  await Promise.all([gateway(), app()]);
}
