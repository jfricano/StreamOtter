/**
 * Runs the example locally: the application server and `streamotter dev` (gateway +
 * workbench). Pass --kafka for Kafka mode (requires `pnpm kafka:start`); the app starts
 * first there because it creates the topic and publishes the seeded state. Add --resync
 * for Kafka mode with quarantine-resync (streamotter.kafka-resync.json); the app then
 * also creates the quarantine topic.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const kafka = process.argv.includes("--kafka");
const resync = kafka && process.argv.includes("--resync");
const cli = fileURLToPath(new URL("../node_modules/@streamotter/cli/bin/streamotter.js", import.meta.url));
const children = [];
let stopping = false;

function start(name, args, readyPattern) {
  return new Promise(resolve => {
    // The app uses KafkaJS 2.2.4 directly; its harmless TimeoutNegativeWarning is silenced here.
    // (The gateway's source adapter carries its own fix for that KafkaJS timer.)
    const flags = name === "app" ? ["--disable-warning=TimeoutNegativeWarning"] : [];
    const env = resync ? { ...process.env, ORDER_QUARANTINE_TOPIC: process.env.ORDER_QUARANTINE_TOPIC ?? "orders.status.quarantine" } : process.env;
    const child = spawn(process.execPath, [...flags, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env });
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
const config = resync ? "streamotter.kafka-resync.json" : kafka ? "streamotter.kafka.json" : "streamotter.json";
const handlerModule = resync ? "kafka-resync" : kafka ? "kafka" : "fixture";
const gateway = () => start("streamotter", [cli, "dev", "--config", config, "--handlers", `dist/server/${handlerModule}-handlers.js`], /Press Ctrl\+C/);
if (kafka) {
  await app();
  if (!stopping) await gateway();
} else {
  await Promise.all([gateway(), app()]);
}
