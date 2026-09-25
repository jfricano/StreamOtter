export { EXIT, runCli, runProcess, type CliIO } from "./cli.ts";
export {
  detectPackageStyle, fingerprint, generateFiles, GENERATED_MARKER, renderType, streamotterModules, typeNames,
  type GeneratedFile, type PackageStyle
} from "./generate.ts";
export { scaffoldFiles } from "./templates.ts";
