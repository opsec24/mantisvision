"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, KeyRound, Lock, Mail, ArrowRight, AlertCircle, Check } from "lucide-react";
import { api, setToken } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams?.get("redirect") || "/dashboard";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fillAdmin = () => {
    setEmail("admin@company.internal");
    setPassword("AdminSecure2026!");
    setMode("login");
    setError(null);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (mode === "register") {
        await api.register({ email, password });
        setSuccessMsg("Account created! Logging in...");
        const res = await api.login({ email, password });
        if (res.access_token) {
          setToken(res.access_token);
          router.push(redirectTarget);
          return;
        } else if (res.requires_totp) {
          setRequiresTotp(true);
          return;
        }
      }

      const res = await api.login({ email, password });
      if (res.requires_totp) {
        setRequiresTotp(true);
      } else if (res.access_token) {
        setToken(res.access_token);
        router.push(redirectTarget);
      }
    } catch (err: any) {
      setError(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await api.verifyTotp({ email, totp_code: totpCode.trim() });
      if (res.access_token) {
        setToken(res.access_token);
        router.push(redirectTarget);
      }
    } catch (err: any) {
      setError(err.message || "Invalid 2FA code. Please check your authenticator app.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[75vh]">
      <div className="w-full max-w-md bg-white/95 border border-purple-100/90 rounded-2xl shadow-md p-6 sm:p-8 backdrop-blur-md">
        {/* Brand header */}
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 bg-purple-50 text-purple-700 rounded-2xl border border-purple-200/80 mb-3 shadow-xs">
            <Shield className="w-8 h-8 text-purple-700" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            {mode === "login" ? "Sign In to" : "Create Account on"} NewGen<span className="text-purple-700">SAST</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Internal Collaborative Security Platform &bull; Testing Mode
          </p>
        </div>

        {/* Tab switcher */}
        {!requiresTotp && (
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl mb-5 border border-slate-200">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); }}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                mode === "login" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(null); }}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                mode === "register" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Register
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2 text-xs text-rose-800 shadow-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-2 text-xs text-emerald-800 shadow-xs">
            <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {!requiresTotp ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Company Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="analyst@company.internal"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-xs hover:-translate-y-0.5"
            >
              <span>{loading ? "Processing..." : mode === "login" ? "Continue" : "Create Account"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {/* Quick admin login helper */}
            <div className="mt-4 pt-4 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={fillAdmin}
                className="text-xs font-semibold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg border border-purple-200 transition-colors"
              >
                Autofill default admin credentials
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleTotpSubmit} className="space-y-4">
            <div className="text-center mb-2">
              <div className="inline-flex p-2.5 bg-purple-50 text-purple-700 rounded-full mb-1 border border-purple-200">
                <KeyRound className="w-5 h-5 text-purple-700" />
              </div>
              <p className="text-xs text-slate-600">
                Enter the 6-digit code from your authenticator app for{" "}
                <span className="font-bold text-slate-900">{email}</span>
              </p>
            </div>

            {email === "admin@company.internal" && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <div className="font-bold">Admin 2FA Secret Key:</div>
                <div className="font-mono text-slate-900 select-all bg-white px-2 py-1 rounded border border-amber-200 font-semibold">
                  DQ5BDTU3SRMJELJLRQVHQIGD7CORJ7G3
                </div>
                <div className="text-[11px] text-amber-700">
                  Add this key to Google Authenticator / 1Password if not yet added.
                </div>
              </div>
            )}

            <div>
              <input
                type="text"
                maxLength={6}
                autoFocus
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full text-center tracking-widest text-2xl font-mono py-2.5 bg-slate-50 border border-purple-300 rounded-xl text-slate-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-purple-200"
              />
            </div>

            <button
              type="submit"
              disabled={loading || totpCode.length < 6}
              className="w-full py-3 px-4 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-xs"
            >
              <span>{loading ? "Verifying Token..." : "Verify & Sign In"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRequiresTotp(false);
                setTotpCode("");
              }}
              className="w-full text-xs text-slate-500 hover:text-slate-800 mt-2 text-center font-medium"
            >
              &larr; Back to password sign-in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-8 h-8 border-2 border-purple-700 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
