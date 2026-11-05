"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Shield,
  Activity,
  Settings,
  History,
  PlusCircle,
  ExternalLink,
  LogOut,
  User as UserIcon,
  GitCompare,
  FlaskConical,
} from "lucide-react";
import { api, getToken, removeToken } from "@/lib/api";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [health, setHealth] = useState<{
    status: string;
    active_scans: number;
    queued_scans: number;
  } | null>(null);

  useEffect(() => {
    const token = getToken();
    if (token) {
      api.getMe()
        .then((res) => setUser({ email: res.email }))
        .catch(() => {
          removeToken();
          setUser(null);
        });
    }

    // Health check polling
    const fetchHealth = () => {
      api.getHealth()
        .then(setHealth)
        .catch(() => setHealth({ status: "degraded", active_scans: 0, queued_scans: 0 }));
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {}
    setUser(null);
    router.push("/login");
  };

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: Activity },
    { label: "New Scan", href: "/scans/new", icon: PlusCircle },
    { label: "Benchmarks & Lab", href: "/benchmarks", icon: FlaskConical },
    { label: "Compare", href: "/scans/compare", icon: GitCompare },
    { label: "Audit Log", href: "/audit", icon: History },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  const isAuthPage = pathname === "/login" || pathname === "/setup-totp";

  return (
    <header className="border-b border-slate-800/90 bg-[#090d16]/90 backdrop-blur-md sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-6">
          <Link href="/dashboard" className="flex items-center space-x-3 font-bold text-lg tracking-tight text-white hover:opacity-95 transition-opacity">
            <div className="p-1.5 bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 text-slate-950 rounded-xl shadow-md shadow-amber-500/20">
              <Shield className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div className="flex items-center space-x-2">
              <span>NewGen<span className="text-amber-400">SAST</span></span>
              <span className="hidden xl:inline-block text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-amber-950/80 text-amber-300 border border-amber-800/80">
                ENTERPRISE SWARM
              </span>
            </div>
          </Link>

          {!isAuthPage && (
            <nav className="hidden md:flex items-center space-x-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? "bg-amber-950/60 text-amber-300 border border-amber-500/50 shadow-xs glow-amber-btn"
                        : "text-slate-300 hover:text-amber-300 hover:bg-slate-800/60 border border-transparent"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? "text-amber-400" : "text-slate-400"}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Right side controls */}
        <div className="flex items-center space-x-3">
          {/* System Health Pill */}
          {health && (
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-mono font-medium bg-slate-900/90 border border-slate-800 shadow-xs text-slate-300">
              <span
                className={`w-2 h-2 rounded-full ${
                  health.status === "ok" || health.status === "healthy"
                    ? "bg-emerald-400 shadow-xs shadow-emerald-400/50 animate-pulse"
                    : "bg-amber-400 shadow-xs shadow-amber-400/50"
                }`}
              />
              <span>
                {health.active_scans > 0 ? `${health.active_scans} Active Scans` : "Engine Ready"}
              </span>
            </div>
          )}

          {/* Swarm Observability Link */}
          <Link
            href="/dashboard"
            className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-amber-950/40 text-amber-300 border border-amber-800/70 hover:bg-amber-900/50 transition-colors shadow-2xs"
            title="Native Swarm Observability & Trace Forensics"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            <span>Swarm Telemetry</span>
          </Link>

          {/* User state */}
          {user ? (
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1.5 text-xs text-slate-200 bg-slate-900/90 px-2.5 py-1.5 rounded-xl border border-slate-800 font-semibold shadow-xs">
                <UserIcon className="w-3.5 h-3.5 text-amber-400" />
                <span className="max-w-[130px] truncate">{user.email}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-300 bg-rose-950/50 border border-rose-800/70 hover:bg-rose-900/60 hover:text-white transition-all shadow-xs"
                title="Log out and invalidate all active sessions"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span>Log Out</span>
              </button>
            </div>
          ) : !isAuthPage ? (
            <Link
              href="/login"
              className="text-xs font-bold px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 transition-all hover:-translate-y-0.5"
            >
              Sign In
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
