// API Client for NewGenSAST backend

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
      source_type: string;
      source_target: string;
      branch?: string;
      status: string;
      current_phase?: string;
      budget_limit_usd?: number;
      cost_spent_usd: number;
      created_at: string;
      completed_at?: string;
      findings_count?: number;
    }>>("/api/scans"),

  getScan: (id: string) =>
    request<{
      id: string;
      source_type: string;
      source_target: string;
      branch?: string;
      status: string;
      current_phase?: string;
      phase_models?: Record<string, string>;
      budget_limit_usd?: number;
      cost_spent_usd: number;
      created_at: string;
      completed_at?: string;
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
    }>(`/api/scans/${id}`),

  createScan: (data: {
    source_type: "git" | "local";
    source_target: string;
    branch?: string;
    git_token?: string;
    budget_limit_usd?: number;
    phase_models?: Record<string, string>;
  }) =>
    request<{ id: string; status: string }>("/api/scans", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  cancelScan: (id: string) =>
    request<{ message: string }>(`/api/scans/${id}/cancel`, { method: "POST" }),

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
};
