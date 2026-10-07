/**
 * The import paths the API reference can document, in the order the reference lists them. Each is
 * one of the `streamotter` package's entry points and is also published in its own package. The
 * site documents those the built package exports; one it exports that isn't listed here fails the
 * build. `entry` is the TypeDoc module name: the entry file's base name in streamotter's dist/.
 */
export interface ApiModuleInfo {
  slug: string;
  entry: string;
  importPath: string;
  /** The same entry point in its own scoped package, for apps that install only that package. */
  scopedImport: string;
  title: string;
  description: string;
  /**
   * The entry point's exports by audience, in page order. Every export must be in exactly one
   * section, or the build fails. Entry points that re-export these names group them the same way.
   */
  sections?: readonly ApiSectionInfo[];
}

/** One labeled group of an entry point's exports. `slug` is its anchor on the page. */
export interface ApiSectionInfo {
  slug: string;
  title: string;
  description: string;
  /** Whether a typical app uses this section; the page lists these first and says so. */
  everyApp: boolean;
  names: readonly string[];
}

/**
 * streamotter/contracts by audience. About 50 names are what an app uses; the rest serve source
 * failure handling, operator tools, the workbench host, custom clients and low-level checks.
 */
const CONTRACTS_SECTIONS: readonly ApiSectionInfo[] = [
  {
    slug: "configuration", title: "Project configuration", everyApp: true,
    description: "streamotter.json and defineProject: sources, Kafka connections, channel schemas and limits, and the validators the CLI and gateway run.",
    names: [
      "ProjectConfig", "Source", "KafkaConnection", "SecretRef", "Schema", "Limits", "DEFAULT_LIMITS", "DevelopmentOptions", "FixtureRecord",
      "validateProjectConfig", "assertValidProjectConfig", "ConfigValidation", "ConfigIssue"
    ]
  },
  {
    slug: "gateway", title: "Gateway and handlers", everyApp: true,
    description: "The gateway's options and lifecycle, and what your authorization and mapping handlers receive and return.",
    names: [
      "Gateway", "GatewayOptions", "GatewayLogger", "HealthListenerOptions", "HealthReason", "HealthResponse", "Principal", "HandlerContext",
      "HandlerRegistry", "ChannelHandlers", "SourceRecord", "MappedState", "Revocation"
    ]
  },
  {
    slug: "client", title: "Browser client", everyApp: true,
    description: "The client and its subscriptions: connection and subscription states, state changes, and waiting for a live view.",
    names: ["Client", "ClientOptions", "Subscription", "SubscriptionState", "ConnectionState", "StateChange", "StreamEvent", "WaitOptions", "Unlisten"]
  },
  {
    slug: "channels", title: "Channels and values", everyApp: true,
    description: "The types channel contracts are written in. `streamotter generate` emits your AppChannels map from them.",
    names: ["Json", "Params", "Revision", "Awaitable", "ChannelContract", "ChannelMap"]
  },
  {
    slug: "errors", title: "Errors", everyApp: true,
    description: "The stable error codes, the errors the client and gateway report, and the messages a browser may show.",
    names: ["ErrorCode", "StreamError", "StreamErrorOptions", "StreamOtterError", "streamError", "isStreamError", "isErrorCode", "ERROR_CODES", "PUBLIC_MESSAGES"]
  },
  {
    slug: "source-failures", title: "Source failure handling", everyApp: false,
    description: "Failure policies, recovery handlers and quarantine, for apps that configure what happens when a source record can't be mapped (V1.1).",
    names: [
      "FailureHandlingConfig", "FailurePolicy", "SourceFailurePolicy", "SourceRecoveryHandlers", "FailureClass", "FAILURE_CLASSES",
      "QUARANTINE_ELIGIBLE_CLASSES", "DEFAULT_AUTOMATIC_ADVANCE_LIMIT", "ResolvedSourcePolicy", "resolveSourcePolicy", "policyFor",
      "TransientMappingError", "RecoveryDecision", "RecoveryIncident", "RecoveryBoundary", "BoundaryRetirement"
    ]
  },
  {
    slug: "operator", title: "Operator API types", everyApp: false,
    description: "Incidents and the operator's requests and results. streamotter/gateway/operator re-exports the ones callOperator uses.",
    names: [
      "OperatorApi", "OperatorOperation", "OPERATOR_OPERATIONS", "OPERATOR_MUTATIONS", "OperatorRequests", "OperatorStatus", "OperatorSourceStatus",
      "OperationResult", "PLAN_TTL_MS", "IncidentSummary", "IncidentDetail", "IncidentEvent", "IncidentEventName", "IncidentNextAction",
      "IncidentProgress", "IncidentQuarantine", "IncidentRecovery", "RawEvidenceView", "ReproductionBundle", "EvaluationOutput", "EvaluationResult",
      "EvaluateRequest", "ExportFailureRequest", "ListFailuresRequest", "ReassessRequest", "RedriveRequest", "ReopenCircuitRequest",
      "RetireBoundaryRequest", "RetryCurrentRequest", "ShowFailureRequest"
    ]
  },
  {
    slug: "diagnostics", title: "Management and diagnostics", everyApp: false,
    description: "What the development management API and the workbench report: channels, sources, traces and diagnostic steps.",
    names: ["ManagementOperations", "ChannelSummary", "SourceStatus", "Trace", "TraceStage", "Page", "DiagnosticStep", "DevelopmentPrincipalSummary"]
  },
  {
    slug: "protocol", title: "Wire protocol", everyApp: false,
    description: "The Socket.IO frames and constants between the browser SDK and the gateway (V1_API §8). Only a custom client needs them.",
    names: [
      "PROTOCOL_VERSION", "EVENTS", "CAPABILITIES", "Capabilities", "DEFAULT_SOCKET_PATH", "SocketAuth", "Hello", "SubscribeRequest", "ControlRequest",
      "Result", "DataFrame", "SubscriptionFrame", "Receipt", "ErrorFrame", "ClientToServerEvents", "ServerToClientEvents"
    ]
  },
  {
    slug: "workbench", title: "Workbench hosting", everyApp: false,
    description: "The WHC-1 host contract, for a site that hosts the StreamOtter workbench behind its own server.",
    names: [
      "WorkbenchHostConfig", "WorkbenchHostConfigIssue", "validateWorkbenchHostConfig", "WorkbenchHostManifest", "WorkbenchDiscovery",
      "WorkbenchOperation", "WORKBENCH_OPERATIONS", "isWorkbenchOperation", "isWorkbenchApiOrigin", "WORKBENCH_HOST_CONTRACT",
      "WORKBENCH_BOOT_ELEMENT_ID", "WORKBENCH_MOUNT_ELEMENT_ID", "WORKBENCH_REQUEST_HEADER", "PREVIEW_TOKEN_TTL_MS"
    ]
  },
  {
    slug: "helpers", title: "Helpers", everyApp: false,
    description: "Canonical JSON, revisions, identifiers and schema checks: the same rules the gateway applies, for tools that check values themselves.",
    names: [
      "canonicalJson", "canonicalJsonPretty", "canonicalizeParams", "CanonicalParamsResult", "compareRevisions", "isRevision", "REVISION_PATTERN",
      "isIdentifier", "IDENTIFIER_PATTERN", "validateSchemaDefinition", "validateValue", "ValueIssue"
    ]
  }
];

export const API_MODULES: readonly ApiModuleInfo[] = [
  {
    slug: "client", entry: "client", importPath: "streamotter/client", scopedImport: "@streamotter/client", title: "Browser SDK",
    description: "createClient, subscriptions, connection and subscription states, and the errors a browser sees."
  },
  {
    slug: "react", entry: "react", importPath: "streamotter/react", scopedImport: "@streamotter/client/react", title: "React hooks",
    description: "StreamOtterProvider and typed hooks over the browser SDK: useSubscription, useConnectionState and createStreamOtterHooks. Needs React 18 or later."
  },
  {
    slug: "gateway", entry: "gateway", importPath: "streamotter/gateway", scopedImport: "@streamotter/gateway", title: "Gateway",
    description: "defineProject and createGateway for the Node.js server, with every contract type re-exported for handlers and configuration."
  },
  {
    slug: "contracts", entry: "contracts", importPath: "streamotter/contracts", scopedImport: "@streamotter/contracts", title: "Contracts",
    description: "The shared types and validation the other entry points are built on: configuration, handlers, schemas, limits, errors, and the protocol.",
    sections: CONTRACTS_SECTIONS
  },
  {
    slug: "operator", entry: "operator", importPath: "streamotter/gateway/operator", scopedImport: "@streamotter/gateway/operator", title: "Operator API",
    description: "Source-failure incidents, quarantine, recovery guards and redrive, in process or over the gateway's local socket. Never exposed to browsers."
  },
  {
    slug: "management", entry: "management", importPath: "streamotter/gateway/management", scopedImport: "@streamotter/gateway/management", title: "Management API",
    description: "The development-only management server and the mountable handler that host the workbench."
  },
  {
    slug: "cli", entry: "cli", importPath: "streamotter/cli", scopedImport: "@streamotter/cli", title: "CLI",
    description: "The streamotter command's programmatic API: running it, generating contract files, and scaffolding a project."
  }
];

export const API_ROOT = "/api/";

export const apiModuleHref = (slug: string) => `${API_ROOT}${slug}/`;
export const apiSymbolHref = (slug: string, name: string) => `${API_ROOT}${slug}/${encodeURIComponent(name)}/`;
