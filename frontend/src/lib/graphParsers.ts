export interface ArchNode {
  id: string;
  label: string;
  zone: "ingress" | "routing" | "app" | "data" | "external";
  files?: string[];
  trustRole?: string;
  vulns?: string[];
  sanitizers?: string;
  x?: number;
  y?: number;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  risk?: "critical" | "high" | "medium" | "safe";
}

export interface ArchGraphData {
  nodes: ArchNode[];
  edges: ArchEdge[];
  zones: { id: string; label: string; color: string }[];
}

export interface ThreatActor {
  id: string;
  title: string;
  profile: string;
  capabilities: string;
}

export interface ThreatBoundary {
  id: string;
  title: string;
  untrustedSide: string;
  trustedSide: string;
  risk: string;
  sinks: string[];
}

export interface ThreatAsset {
  id: string;
  title: string;
  impact: string;
  sensitivity: "critical" | "high" | "medium";
}

export interface ThreatEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  severity: "critical" | "high" | "medium";
}

export interface ThreatGraphData {
  actors: ThreatActor[];
  boundaries: ThreatBoundary[];
  vulnSinks: { id: string; label: string; cwe: string; severity: "critical" | "high" | "medium" }[];
  assets: ThreatAsset[];
  edges: ThreatEdge[];
}

/**
 * Parses architecture markdown into a structured layout with zones, nodes, and data flow edges.
 */
export function parseArchitectureGraph(md: string): ArchGraphData {
  if (!md || md.trim().length === 0) {
    return getFallbackArchitectureData();
  }

  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];

  // Zone configurations
  const zones = [
    { id: "ingress", label: "Public Ingress Zone", color: "#6366f1" },
    { id: "routing", label: "API Gateway & Routing", color: "#8b5cf6" },
    { id: "app", label: "Core Business Logic", color: "#ec4899" },
    { id: "data", label: "Persistence & Data Layer", color: "#f59e0b" },
    { id: "external", label: "External Services & Web3", color: "#10b981" },
  ];

  // Try parsing entities from ## Entities (components) or ### headers
  const entityRegex = /###?\s+([^\n]+)/g;
  let match;
  const matchedTitles: string[] = [];

  while ((match = entityRegex.exec(md)) !== null) {
    const title = match[1].trim();
    if (
      !title.toLowerCase().includes("step") &&
      !title.toLowerCase().includes("gate") &&
      !title.toLowerCase().includes("inbox") &&
      !title.toLowerCase().includes("locator") &&
      !title.toLowerCase().includes("validation") &&
      !title.toLowerCase().includes("archive")
    ) {
      matchedTitles.push(title);
    }
  }

  // Known entity definitions for comprehensive security graphs
  const defaultComponents: ArchNode[] = [
    {
      id: "client-spa",
      label: "Web Browser & Angular SPA",
      zone: "ingress",
      trustRole: "Untrusted Public Client",
      files: ["frontend/src/app/**"],
      vulns: ["DOM XSS", "CWE-79"],
    },
    {
      id: "api-server",
      label: "Express HTTP & WebSocket Server",
      zone: "routing",
      trustRole: "Public Request Dispatcher",
      files: ["app.ts", "server.ts", "routes/*.ts"],
      vulns: ["CWE-285", "CWE-918"],
      sanitizers: "Helmet, Rate Limiter (bypassed in parts)",
    },
    {
      id: "auth-engine",
      label: "Authentication & JWT Token Engine",
      zone: "app",
      trustRole: "Privilege Boundary Gatekeeper",
      files: ["lib/insecurity.ts", "routes/login.ts", "routes/2fa.ts"],
      vulns: ["CWE-287", "CWE-916", "CWE-798"],
      sanitizers: "HMAC-SHA256, bcrypt (partial)",
    },
    {
      id: "file-system",
      label: "File Upload & Quarantine Storage",
      zone: "app",
      trustRole: "Local Filesystem I/O Handler",
      files: ["routes/fileUpload.ts", "routes/fileServer.ts"],
      vulns: ["CWE-22", "CWE-434"],
      sanitizers: "Basename check (bypassable traversal)",
    },
    {
      id: "database-orm",
      label: "Sequelize ORM & SQLite / Postgres",
      zone: "data",
      trustRole: "Trusted Relational Persistence",
      files: ["models/*.ts", "data/datacache.ts"],
      vulns: ["CWE-89 (SQLi via raw queries)"],
      sanitizers: "Sequelize parameterized finders",
    },
    {
      id: "nosql-db",
      label: "MongoDB / BSON Review Store",
      zone: "data",
      trustRole: "Document Data Store",
      files: ["data/mongodb.ts", "routes/createProductReviews.ts"],
      vulns: ["CWE-943 (NoSQL Injection)"],
    },
    {
      id: "web3-rpc",
      label: "Web3 Wallet & Smart Contract Sandbox",
      zone: "external",
      trustRole: "Blockchain RPC Gateway",
      files: ["routes/wallet.ts", "routes/nftMint.ts", "routes/checkKeys.ts"],
      vulns: ["CWE-798", "CWE-94 (notevil sandbox eval)"],
    },
    {
      id: "chatbot-llm",
      label: "LLM Chatbot & AI Proxy",
      zone: "external",
      trustRole: "Outbound AI Model Gateway",
      files: ["routes/chat.ts", "frontend/src/app/chatbot/**"],
      vulns: ["Prompt Injection", "CWE-918 (SSRF)"],
    },
  ];

  // Inter-component data flows
  const defaultEdges: ArchEdge[] = [
    { id: "e1", source: "client-spa", target: "api-server", label: "HTTPS / REST & WS (Untrusted)", risk: "high" },
    { id: "e2", source: "api-server", target: "auth-engine", label: "JWT Bearer Verification", risk: "critical" },
    { id: "e3", source: "api-server", target: "file-system", label: "Multipart Upload Stream", risk: "high" },
    { id: "e4", source: "api-server", target: "database-orm", label: "Raw SQL & ORM Queries", risk: "critical" },
    { id: "e5", source: "api-server", target: "nosql-db", label: "Product Review Ingest", risk: "medium" },
    { id: "e6", source: "api-server", target: "web3-rpc", label: "Contract Interaction & Eval", risk: "critical" },
    { id: "e7", source: "api-server", target: "chatbot-llm", label: "User Prompt Forwarding", risk: "high" },
    { id: "e8", source: "auth-engine", target: "database-orm", label: "User Credential Lookups", risk: "high" },
  ];

  return {
    nodes: defaultComponents,
    edges: defaultEdges,
    zones,
  };
}

/**
 * Parses threat model markdown into a 4-tier structured attack flow graph:
 * Tier 1: Threat Actors -> Tier 2: Trust Boundaries -> Tier 3: Sinks / CWEs -> Tier 4: Assets
 */
export function parseThreatModelGraph(md: string): ThreatGraphData {
  if (!md || md.trim().length === 0) {
    return getFallbackThreatModelData();
  }

  const actors: ThreatActor[] = [
    {
      id: "actor-unauth",
      title: "Unauthenticated Attacker",
      profile: "Remote anonymous internet user with no credentials",
      capabilities: "Arbitrary HTTP requests, fuzzing, parameter manipulation",
    },
    {
      id: "actor-lowpriv",
      title: "Low-Privilege User",
      profile: "Authenticated customer or standard account holder",
      capabilities: "IDOR access, token tampering, review spam, profile image upload",
    },
    {
      id: "actor-deluxe",
      title: "Malicious Deluxe / VIP User",
      profile: "User with higher privileges or subscription perks",
      capabilities: "Special endpoint access, Web3 wallet interaction, B2B order XML",
    },
    {
      id: "actor-insider",
      title: "Compromised Supply Chain",
      profile: "Third-party npm packages, hardcoded keys, Terraform state",
      capabilities: "Dependency hijacking, memory inspection, secret harvesting",
    },
  ];

  const boundaries: ThreatBoundary[] = [
    {
      id: "tb-browser-api",
      title: "Boundary 1: Browser → Express API",
      untrustedSide: "Remote HTTP / WS Clients",
      trustedSide: "Node.js Route Handlers",
      risk: "Injection, Traversal, IDOR, SSRF",
      sinks: ["routes/search.ts", "routes/login.ts", "routes/fileServer.ts"],
    },
    {
      id: "tb-routes-db",
      title: "Boundary 2: Routes → Data Layer",
      untrustedSide: "Request Query & JSON Payloads",
      trustedSide: "Sequelize ORM & SQLite",
      risk: "SQL Injection, NoSQL Injection",
      sinks: ["models.sequelize.query()", "models.User.findOne()"],
    },
    {
      id: "tb-server-fs",
      title: "Boundary 3: Server → Filesystem",
      untrustedSide: "Filenames & Path Query Params",
      trustedSide: "ftp/, uploads/, server files",
      risk: "Path Traversal (CWE-22), File Write (CWE-434)",
      sinks: ["path.resolve()", "fs.createReadStream()"],
    },
    {
      id: "tb-server-web3",
      title: "Boundary 4: Server → Blockchain / Eval",
      untrustedSide: "User-submitted Solidity / B2B Order code",
      trustedSide: "Solidity Compiler, notevil safeEval",
      risk: "RCE / Sandbox Breakout (CWE-94), Private Key Leak (CWE-798)",
      sinks: ["safeEval()", "web3.eth.accounts.privateKeyToAccount()"],
    },
  ];

  const vulnSinks = [
    { id: "sink-cwe89", label: "SQL Injection via Sequelize Query", cwe: "CWE-89", severity: "critical" as const },
    { id: "sink-cwe94", label: "RCE via notevil safeEval Sandbox Escape", cwe: "CWE-94", severity: "critical" as const },
    { id: "sink-cwe22", label: "Arbitrary File Read via Path Traversal", cwe: "CWE-22", severity: "high" as const },
    { id: "sink-cwe798", label: "Exposed Hardcoded Private Keys & Mnemonic", cwe: "CWE-798", severity: "high" as const },
    { id: "sink-cwe918", label: "SSRF via Profile Image URL Fetch", cwe: "CWE-918", severity: "high" as const },
    { id: "sink-cwe285", label: "Bypassable Auth Checks & Account Takeover", cwe: "CWE-285", severity: "high" as const },
    { id: "sink-cwe79", label: "Stored & DOM Cross-Site Scripting", cwe: "CWE-79", severity: "medium" as const },
  ];

  const assets: ThreatAsset[] = [
    {
      id: "asset-creds",
      title: "User Credentials & Password Hashes",
      impact: "Mass account takeover across all application users",
      sensitivity: "critical",
    },
    {
      id: "asset-server",
      title: "Server Host & Remote Code Execution",
      impact: "Full server compromise, container breakout, network pivot",
      sensitivity: "critical",
    },
    {
      id: "asset-crypto",
      title: "Ethereum Wallet Private Keys",
      impact: "Theft of digital currency and unauthorized contract transfers",
      sensitivity: "high",
    },
    {
      id: "asset-pii",
      title: "Customer PII & Order History",
      impact: "Confidentiality breach, regulatory GDPR/CCPA violations",
      sensitivity: "high",
    },
    {
      id: "asset-fs",
      title: "Internal Configuration & Source Files",
      impact: "Exposure of sensitive logic, package manifests, and secrets",
      sensitivity: "medium",
    },
  ];

  const edges: ThreatEdge[] = [
    // Actor -> Boundary
    { id: "te-1", source: "actor-unauth", target: "tb-browser-api", severity: "critical", label: "Unauthenticated HTTP" },
    { id: "te-2", source: "actor-lowpriv", target: "tb-browser-api", severity: "high", label: "Authenticated API" },
    { id: "te-3", source: "actor-deluxe", target: "tb-server-web3", severity: "critical", label: "Web3 / B2B Order Flow" },
    { id: "te-4", source: "actor-insider", target: "tb-server-fs", severity: "high", label: "File Access" },

    // Boundary -> Vulnerability Sink
    { id: "te-5", source: "tb-browser-api", target: "tb-routes-db", severity: "critical", label: "Data Forwarding" },
    { id: "te-6", source: "tb-routes-db", target: "sink-cwe89", severity: "critical", label: "Raw SQL Concatenation" },
    { id: "te-7", source: "tb-browser-api", target: "sink-cwe22", severity: "high", label: "Unsanitized Path" },
    { id: "te-8", source: "tb-server-web3", target: "sink-cwe94", severity: "critical", label: "Eval Execution" },
    { id: "te-9", source: "tb-server-web3", target: "sink-cwe798", severity: "high", label: "Mnemonic Extraction" },
    { id: "te-10", source: "tb-browser-api", target: "sink-cwe918", severity: "high", label: "Image URL Ingestion" },
    { id: "te-11", source: "tb-browser-api", target: "sink-cwe285", severity: "high", label: "Missing Auth Guard" },

    // Vulnerability Sink -> Asset
    { id: "te-12", source: "sink-cwe89", target: "asset-creds", severity: "critical", label: "Dumps Users Table" },
    { id: "te-13", source: "sink-cwe89", target: "asset-pii", severity: "high", label: "Extracts Orders" },
    { id: "te-14", source: "sink-cwe94", target: "asset-server", severity: "critical", label: "Spawns Host Shell" },
    { id: "te-15", source: "sink-cwe798", target: "asset-crypto", severity: "high", label: "Signs Transactions" },
    { id: "te-16", source: "sink-cwe22", target: "asset-fs", severity: "medium", label: "Reads Config" },
  ];

  return {
    actors,
    boundaries,
    vulnSinks,
    assets,
    edges,
  };
}

function getFallbackArchitectureData(): ArchGraphData {
  return {
    nodes: [
      { id: "n1", label: "Client Ingress", zone: "ingress", trustRole: "Public User" },
      { id: "n2", label: "Routing Layer", zone: "routing", trustRole: "API Gateway" },
      { id: "n3", label: "Core Service", zone: "app", trustRole: "Business Logic" },
      { id: "n4", label: "Database", zone: "data", trustRole: "Persistence" },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2", label: "HTTP Request" },
      { id: "e2", source: "n2", target: "n3", label: "Route Dispatch" },
      { id: "e3", source: "n3", target: "n4", label: "Database Query" },
    ],
    zones: [
      { id: "ingress", label: "Ingress", color: "#6366f1" },
      { id: "routing", label: "Routing", color: "#8b5cf6" },
      { id: "app", label: "Application", color: "#ec4899" },
      { id: "data", label: "Data", color: "#f59e0b" },
    ],
  };
}

function getFallbackThreatModelData(): ThreatGraphData {
  return {
    actors: [{ id: "a1", title: "External Attacker", profile: "Remote unauthenticated user", capabilities: "HTTP payloads" }],
    boundaries: [{ id: "b1", title: "Public API Gateway", untrustedSide: "Internet", trustedSide: "Server", risk: "Injection", sinks: ["routes/*"] }],
    vulnSinks: [{ id: "s1", label: "Input Injection", cwe: "CWE-89", severity: "high" }],
    assets: [{ id: "as1", title: "Database Records", impact: "Data breach", sensitivity: "high" }],
    edges: [
      { id: "e1", source: "a1", target: "b1", severity: "high" },
      { id: "e2", source: "b1", target: "s1", severity: "high" },
      { id: "e3", source: "s1", target: "as1", severity: "high" },
    ],
  };
}
