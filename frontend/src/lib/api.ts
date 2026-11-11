// API Client for MantisVision backend

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function getToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("sast_auth_token");
  }
  return null;
}

export function setToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("sast_auth_token", token);
  }
}

export function removeToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("sast_auth_token");
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });

  // Read response stream exactly once to prevent "body stream already read"
  const rawText = await response.text();

  if (
    response.status === 401 &&
    !endpoint.includes("/api/auth/login") &&
    !endpoint.includes("/api/auth/register")
  ) {
    removeToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
    }
  }

  if (!response.ok) {
    let errorDetail = `HTTP error ${response.status}`;
    if (rawText && rawText.trim()) {
      try {
        const errJson = JSON.parse(rawText);
        errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
      } catch {
        errorDetail = rawText;
      }
    }
    throw new Error(errorDetail || `HTTP error ${response.status}`);
  }

  if (response.status === 204 || !rawText || !rawText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText as unknown as T;
  }
}

export interface TraceStep {
  id: string;
  scan_id: string;
  step_number: number;
  phase: string;
  agent_name: string;
  model?: string;
  has_thinking: boolean;
  thinking_preview?: string;
  thinking_content?: string;
  prompt_raw?: string;
  response_raw?: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_output?: string;
  candidate_vuln_title?: string;
  decision_status: string;
  decision_reason?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_usd: number;
  created_at: string;
}

export const api = {
  // Auth
  register: (data: { email: string; password: string }) =>
    request<{ id: string; email: string; totp_enabled: boolean }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<{ access_token?: string; requires_totp?: boolean; user_id?: string; email?: string }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify(data) }
    ),

  logout: async () => {
    try {
      await request<{ success: boolean; message: string }>("/api/auth/logout", {
        method: "POST",
      });
    } catch {}
    removeToken();
  },

  verifyTotp: (data: { email: string; totp_code: string }) =>
    request<{ access_token: string; token_type: string }>("/api/auth/verify-totp", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  setupTotp: () =>
    request<{ totp_secret: string; otpauth_uri: string }>("/api/auth/setup-totp", {
      method: "POST",
    }),

  confirmTotp: (code: string) =>
    request<{ success: boolean; message: string }>("/api/auth/confirm-totp", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  getMe: () =>
    request<{ id: string; email: string; totp_enabled: boolean; created_at: string }>("/api/auth/me"),

  // Scans
  listScans: () =>
    request<Array<{
      id: string;
      name?: string;
      source_type: string;
      source_target: string;
      branch?: string;
      status: string;
      current_phase?: string;
      budget_limit_usd?: number;
      cost_spent_usd: number;
      created_at: string;
      completed_at?: string;
      architecture_summary?: string;
      threat_model?: string;
      hunting_plan?: string;
      review_packet?: string;
      exploit_chains?: any;
      findings_count?: number;
    }>>("/api/scans"),

  getScan: (id: string) =>
    request<{
      id: string;
      name?: string;
      source_type: string;
      source_target: string;
      branch?: string;
      status: string;
      current_phase?: string;
      phase_models?: Record<string, any>;
    phase_efforts?: Record<string, any>;
      budget_limit_usd?: number;
      cost_spent_usd: number;
      created_at: string;
      completed_at?: string;
      architecture_summary?: string;
      threat_model?: string;
      hunting_plan?: string;
      review_packet?: string;
      exploit_chains?: any;
      findings: Array<{
        id: string;
        title: string;
        cwe?: string;
        severity: string;
        status: string;
        file_path?: string;
        line_number?: number;
        description?: string;
        poc_script?: string;
        poc_output?: string;
        patch_diff?: string;
      }>;
      stage_observations?: Record<string, string>;
      stage_observation_counts?: Record<string, number>;
    }>(`/api/scans/${id}`),

  getScanTraces: (
    id: string,
    params?: { phase?: string; tool?: string; status?: string; q?: string; limit?: number; offset?: number }
  ) => {
    const sp = new URLSearchParams();
    if (params?.phase) sp.set("phase", params.phase);
    if (params?.tool) sp.set("tool", params.tool);
    if (params?.status) sp.set("status", params.status);
    if (params?.q) sp.set("q", params.q);
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return request<{
      scan_id: string;
      total: number;
      traces: Array<TraceStep>;
    }>(`/api/scans/${id}/traces${qs}`);
  },

  getScanTracesSummary: (id: string) =>
    request<{
      scan_id: string;
      total_steps: number;
      total_reasoning_tokens: number;
      tools_breakdown: Record<string, number>;
      candidates_breakdown: Record<string, number>;
      phases_breakdown: Record<string, number>;
    }>(`/api/scans/${id}/traces/summary`),

  getSingleTrace: (scanId: string, traceId: string) =>
    request<TraceStep>(`/api/scans/${scanId}/traces/${traceId}`),

  createScan: (data: {
    name?: string;
    source_type: "git" | "local";
    source_target: string;
    branch?: string;
    git_token?: string;
    budget_limit_usd?: number;
    phase_models?: Record<string, any>;
    phase_efforts?: Record<string, any>;
    fresh?: boolean;
    model?: string;
    reasoning_effort?: string;
    focus?: string;
    exclude?: string[];
    max_tokens?: number;
    sandbox?: string;
    resume?: boolean;
    scan_mode?: string;
    objective?: string;
    seed_report?: string;
    deterministic_only?: boolean;
    no_replan?: boolean;
    parallel?: number;
    max_llm_calls?: number;
    api_base?: string;
  }) =>
    request<{ id: string; status: string; name?: string }>("/api/scans", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  purgeKnowledgeBase: (data: { source_target?: string; all_targets?: boolean }) =>
    request<{ message: string }>("/api/scans/purge-knowledge-base", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  cancelScan: (id: string) =>
    request<{ message: string }>(`/api/scans/${id}/cancel`, { method: "POST" }),

  retryScan: (id: string) =>
    request<{ id: string; status: string }>(`/api/scans/${id}/retry`, { method: "POST" }),

  resumeScan: (id: string) =>
    request<{ id: string; status: string }>(`/api/scans/${id}/resume`, { method: "POST" }),

  deleteScan: (id: string) =>
    request<{ message: string; id: string }>(`/api/scans/${id}`, { method: "DELETE" }),

  bulkDeleteScans: (scan_ids: string[]) =>
    request<{ message: string; deleted_count: number; deleted_ids: string[] }>(
      "/api/scans/bulk-delete",
      {
        method: "POST",
        body: JSON.stringify({ scan_ids }),
      }
    ),

  compareScans: (scan_ids: string[]) =>
    request<{
      same_repository: boolean;
      scans: Array<{
        id: string;
        name: string;
        source_type: string;
        source_target: string;
        branch?: string;
        status: string;
        phase_models?: Record<string, any>;
    phase_efforts?: Record<string, any>;
        cost_spent_usd: number;
        duration_seconds?: number;
        created_at: string;
        completed_at?: string;
        findings_count: number;
        reproduced_count: number;
        critical_count: number;
        high_count: number;
        medium_count: number;
        low_count: number;
      }>;
      phase_models: Record<string, Record<string, string>>;
      common_findings: Array<{
        id: string;
        title: string;
        cwe?: string;
        file_path?: string;
        line_number?: number;
        severity: string;
        detected_in_scan_ids: string[];
        scan_statuses: Record<string, string>;
        has_poc: Record<string, boolean>;
        has_patch: Record<string, boolean>;
        description?: string;
      }>;
      exclusive_findings: Record<string, Array<{
        id: string;
        title: string;
        cwe?: string;
        file_path?: string;
        line_number?: number;
        severity: string;
        detected_in_scan_ids: string[];
        scan_statuses: Record<string, string>;
        has_poc: Record<string, boolean>;
        has_patch: Record<string, boolean>;
        description?: string;
      }>>;
      all_findings: Array<{
        id: string;
        title: string;
        cwe?: string;
        file_path?: string;
        line_number?: number;
        severity: string;
        detected_in_scan_ids: string[];
        scan_statuses: Record<string, string>;
        has_poc: Record<string, boolean>;
        has_patch: Record<string, boolean>;
        description?: string;
      }>;
    }>(`/api/scans/compare?ids=${scan_ids.join(",")}`),

  // Settings: Providers & Models
  getProviders: () =>
    request<Array<{
      provider: string;
      api_key_masked?: string;
      api_base_url?: string;
      is_active: boolean;
      updated_at?: string;
    }>>("/api/settings/providers"),

  updateProvider: (provider: string, data: { api_key?: string; api_base_url?: string; is_active?: boolean }) =>
    request<{ message: string }>(`/api/settings/providers/${provider}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  discoverModels: (provider: string, data: { api_key?: string; api_base_url?: string }) =>
    request<{
      provider: string;
      connection_status: string;
      message: string;
      models: Array<{
        id: string;
        display_name: string;
        context_window: number;
        cost_per_m_in: number;
        cost_per_m_out: number;
      }>;
    }>(`/api/settings/providers/${provider}/discover-models`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  testAndWhitelistModels: (
    provider: string,
    data: {
      api_key?: string;
      api_base_url?: string;
      models: Array<{
        id: string;
        display_name: string;
        context_window?: number;
        cost_per_m_in?: number;
        cost_per_m_out?: number;
      }>;
      save_key?: boolean;
    }
  ) =>
    request<{
      provider: string;
      success: boolean;
      verified_count: number;
      results: Array<{
        id: string;
        display_name: string;
        status: "verified" | "failed";
        latency_ms?: number;
        message: string;
      }>;
    }>(`/api/settings/providers/${provider}/test-and-whitelist`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  testSingleModel: (modelId: string) =>
    request<{
      id: string;
      display_name: string;
      status: "verified" | "failed";
      latency_ms?: number;
      message: string;
    }>(`/api/settings/models/${encodeURIComponent(modelId)}/test`, {
      method: "POST",
    }),

  getModels: () =>
    request<Array<{
      id: string;
      provider: string;
      display_name: string;
      context_window: number;
      is_enabled: boolean;
      is_default_recon: boolean;
      is_default_reproduce: boolean;
      cost_per_m_in: number;
      cost_per_m_out: number;
    }>>("/api/settings/models"),

  updateModel: (id: string, data: Partial<{ is_enabled: boolean; cost_per_m_in: number; cost_per_m_out: number }>) =>
    request<{ message: string }>(`/api/settings/models/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  addModel: (data: {
    id: string;
    provider: string;
    display_name: string;
    context_window?: number;
    is_enabled?: boolean;
    cost_per_m_in?: number;
    cost_per_m_out?: number;
  }) =>
    request<{ message: string }>("/api/settings/models", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteModel: (id: string) =>
    request<{ message: string; id?: string }>(`/api/settings/models/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  clearAllModels: () =>
    request<{ message: string }>("/api/settings/models", {
      method: "DELETE",
    }),

  // Google Mantis Upstream Synchronizer
  getMantisStatus: () =>
    request<{
      commit_hash: string;
      short_hash: string;
      commit_message: string;
      commit_date: string;
      synced_at: string;
      upstream_repo: string;
      upstream_branch: string;
      skills_count: number;
      skills: Array<{ name: string; has_skill_md: boolean; size_bytes: number }>;
      engine: { type: string; precision: string; schema_version: number; status: string };
    }>("/api/settings/mantis/status"),

  checkMantisUpdates: (force: boolean = false) =>
    request<{
      has_updates: boolean;
      status: "UP_TO_DATE" | "UPDATES_AVAILABLE";
      safety_verdict: "SAFE" | "BREAKING_CHANGE" | "ADVISORY_WARNING";
      assessment: string;
      message?: string;
      breaking_issues?: string[];
      skills_delta?: {
        added: string[];
        modified: string[];
        removed: string[];
        total_upstream: number;
      };
      files_changed?: Array<{ path: string; additions: number; deletions: number }>;
      commit_log?: Array<{ commit_hash: string; short_hash: string; author: string; date: string; message: string }>;
      diff_snippet?: string;
      current_version: any;
      upstream_version: any;
    }>(`/api/settings/mantis/check-updates?force=${force}`, {
      method: "POST",
    }),

  applyMantisUpdate: (targetCommit?: string) =>
    request<{
      success: boolean;
      message: string;
      version: any;
      verification_checks?: any[];
      status?: string;
    }>("/api/settings/mantis/apply-update", {
      method: "POST",
      body: JSON.stringify({ target_commit: targetCommit }),
    }),

  // Audit Logs
  getAuditLogs: (params?: { action?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.action) q.append("action", params.action);
    if (params?.limit) q.append("limit", params.limit.toString());
    if (params?.offset) q.append("offset", params.offset.toString());
    return request<{
      items: Array<{
        id: string;
        user_email: string;
        action: string;
        resource_type: string;
        resource_id?: string;
        ip_address?: string;
        metadata?: any;
        created_at: string;
      }>;
      total: number;
    }>(`/api/audit?${q.toString()}`);
  },

  // Health
  getHealth: () =>
    request<{
      status: string;
      database: string;
      redis: string;
      docker: string;
      active_scans: number;
      queued_scans: number;
    }>("/api/health"),

  // Mantis Lab & Benchmarks
  getLabTargets: () =>
    request<
      Array<{
        id: string;
        name: string;
        target_type: "builtin" | "synthetic";
        path: string;
        file_count: number;
        flaw_count?: number;
        decoy_count?: number;
        seed?: number;
        size?: string;
        ground_truth_path?: string;
        description: string;
      }>
    >("/api/lab/targets"),

  generateSyntheticTarget: (data: { seed: number; size: "small" | "medium" | "large"; name?: string }) =>
    request<{
      id: string;
      name: string;
      target_type: string;
      path: string;
      file_count: number;
      flaw_count?: number;
      decoy_count?: number;
      seed?: number;
      size?: string;
      ground_truth_path?: string;
      description: string;
    }>("/api/lab/generate-target", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  runSurveyorBenchmark: (data: { mode: "synthetic" | "target"; target?: string; ground_truth?: string }) =>
    request<{
      status: string;
      stdout: string;
      metrics: any;
    }>("/api/lab/surveyor-benchmark", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  runStageBenchmark: (data: {
    stage: string;
    model?: string;
    effort?: string;
    toolset?: string;
    runs?: number;
    max_tokens?: number;
  }) =>
    request<{
      status: string;
      exit_code: number;
      stdout: string;
      stderr: string;
      metrics?: any;
    }>("/api/lab/stage-benchmark", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
