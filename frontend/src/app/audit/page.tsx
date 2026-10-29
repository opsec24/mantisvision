"use client";

import React, { useEffect, useState } from "react";
import {
  History,
  Shield,
  Search,
  Filter,
  Clock,
  User,
  Globe,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedAction, setSelectedAction] = useState("");
  const [expandedMeta, setExpandedMeta] = useState<Record<string, boolean>>({});

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLogs({
        action: selectedAction || undefined,
        limit: 50,
      });
      setLogs(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || "Failed to fetch audit logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedAction]);

  const getActionBadge = (action: string) => {
    if (action.startsWith("auth.login")) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
          {action}
        </span>
      );
    }
    if (action.startsWith("auth.failed") || action.includes("failed")) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
          {action}
        </span>
      );
    }
    if (action.startsWith("scan.")) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
          {action}
        </span>
      );
    }
    if (action.startsWith("settings.")) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          {action}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-purple-100/90">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-purple-600"></span>
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Security Compliance
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-1 flex items-center space-x-2">
            <History className="w-6 h-6 text-purple-700" />
            <span>Immutable Audit Trail</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cryptographically sealed, append-only security logs. Database rules and constraints prevent tampering.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="p-2 text-slate-500 hover:text-purple-900 bg-white hover:bg-purple-50 rounded-xl border border-slate-200 shadow-xs transition-all"
          title="Refresh Log Stream"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white/95 border border-purple-100/90 rounded-2xl p-4 shadow-xs backdrop-blur-md">
        <Filter className="w-4 h-4 text-purple-700" />
        <span className="text-xs font-semibold text-slate-700">Action Filter:</span>
        <select
          value={selectedAction}
          onChange={(e) => setSelectedAction(e.target.value)}
          className="px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-purple-600 focus:bg-white font-mono"
        >
          <option value="">All Actions ({total})</option>
          <option value="auth.login">auth.login</option>
          <option value="auth.totp_verified">auth.totp_verified</option>
          <option value="scan.start">scan.start</option>
          <option value="scan.cancel">scan.cancel</option>
          <option value="settings.key_update">settings.key_update</option>
          <option value="settings.model_whitelist">settings.model_whitelist</option>
          <option value="patch.download">patch.download</option>
        </select>
      </div>

      {/* Logs Table */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-700" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-rose-600 font-medium">{error}</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No audit records found matching your filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5 font-bold">Timestamp</th>
                  <th className="px-6 py-3.5 font-bold">User Email</th>
                  <th className="px-6 py-3.5 font-bold">Action</th>
                  <th className="px-6 py-3.5 font-bold">Resource</th>
                  <th className="px-6 py-3.5 font-bold">Origin IP</th>
                  <th className="px-6 py-3.5 font-bold text-right">Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((log) => {
                  const isMetaOpen = expandedMeta[log.id];
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-purple-50/30 transition-colors">
                        <td className="px-6 py-3.5 text-slate-500 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5 font-mono">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{new Date(log.created_at).toLocaleString()}</span>
                          </div>
                        </td>

                        <td className="px-6 py-3.5 font-bold text-slate-900">
                          <div className="flex items-center space-x-1.5">
                            <User className="w-3.5 h-3.5 text-purple-700" />
                            <span>{log.user_email}</span>
                          </div>
                        </td>

                        <td className="px-6 py-3.5 whitespace-nowrap font-mono">{getActionBadge(log.action)}</td>

                        <td className="px-6 py-3.5 text-slate-600 font-mono">
                          {log.resource_type}
                          {log.resource_id && (
                            <span className="text-slate-400 block text-[10px] truncate max-w-[120px]">
                              {log.resource_id}
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-3.5 text-slate-600 font-mono whitespace-nowrap">
                          <div className="flex items-center space-x-1">
                            <Globe className="w-3.5 h-3.5 text-slate-400" />
                            <span>{log.ip_address || "127.0.0.1"}</span>
                          </div>
                        </td>

                        <td className="px-6 py-3.5 text-right">
                          {log.metadata && Object.keys(log.metadata).length > 0 ? (
                            <button
                              onClick={() => setExpandedMeta({ ...expandedMeta, [log.id]: !isMetaOpen })}
                              className="inline-flex items-center space-x-1 text-xs text-purple-700 hover:text-purple-900 font-bold font-mono"
                            >
                              <span>{isMetaOpen ? "Hide" : "Inspect"}</span>
                              {isMetaOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>

                      {isMetaOpen && log.metadata && (
                        <tr>
                          <td colSpan={6} className="bg-slate-900 p-4 font-mono text-xs border-y border-slate-800 text-slate-200">
                            <span className="text-[10px] text-purple-300 uppercase font-bold">Audit Context Metadata</span>
                            <pre className="mt-1.5 p-3 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
