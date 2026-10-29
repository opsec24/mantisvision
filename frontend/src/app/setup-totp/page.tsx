"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Key, ArrowRight, AlertCircle, CheckCircle } from "lucide-react";
import { api, getToken } from "@/lib/api";

export default function SetupTotpPage() {
  const router = useRouter();
  const [totpData, setTotpData] = useState<{ totp_secret: string; otpauth_uri: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    api.setupTotp()
      .then(setTotpData)
      .catch((err) => setError(err.message || "Failed to generate 2FA secret."));
  }, [router]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await api.confirmTotp(verifyCode.trim());
      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Invalid 2FA code. Please ensure your clock is synced.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[75vh]">
      <div className="w-full max-w-lg bg-white/95 border border-purple-100/90 rounded-2xl shadow-md p-6 sm:p-8 backdrop-blur-md">
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 bg-purple-50 text-purple-700 rounded-2xl border border-purple-200/80 mb-3 shadow-xs">
            <ShieldCheck className="w-8 h-8 text-purple-700" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            Set Up Two-Factor Authentication (2FA)
          </h1>
          <p className="text-xs text-slate-500 text-center mt-1">
            Scan this QR code with Google Authenticator, 1Password, or Authy to secure your account.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2 text-xs text-rose-800 shadow-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {success ? (
          <div className="text-center py-6 space-y-2">
            <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto animate-bounce" />
            <h3 className="text-base font-bold text-slate-900">2FA Activated Successfully!</h3>
            <p className="text-xs text-slate-500">Redirecting you to the dashboard...</p>
          </div>
        ) : totpData ? (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-purple-100 mx-auto w-fit shadow-xs">
              <QRCodeSVG value={totpData.otpauth_uri} size={180} />
            </div>

            <div className="bg-purple-50/60 p-3.5 rounded-xl border border-purple-200/70 text-center">
              <p className="text-[11px] text-slate-500 mb-1 font-medium">Manual Entry Secret Key:</p>
              <code className="text-sm font-mono text-purple-900 font-bold tracking-wider select-all">
                {totpData.totp_secret}
              </code>
            </div>

            <form onSubmit={handleConfirm} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Verify Setup: Enter the 6-digit code from your app
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-center text-lg font-mono text-slate-900 tracking-widest focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || verifyCode.length < 6}
                className="w-full py-3 px-4 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-xs hover:-translate-y-0.5"
              >
                <span>{loading ? "Verifying..." : "Confirm & Enable 2FA"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
