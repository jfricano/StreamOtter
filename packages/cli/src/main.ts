import { runCli } from "./cli.ts";

const shutdownSignal = new Promise<string>(resolve => {
  process.once("SIGINT", () => resolve("SIGINT"));
  process.once("SIGTERM", () => resolve("SIGTERM"));
});

const code = await runCli(process.argv.slice(2), {
  out: line => { process.stdout.write(`${line}\n`); },
  err: line => { process.stderr.write(`${line}\n`); },
  shutdownSignal
});
// Flush output, then exit even if a dependency left a handle open.
process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
