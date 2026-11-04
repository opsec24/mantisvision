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

  const langfuseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL || "http://langfuse.localhost/sso";

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
    <header className="border-b border-purple-100/90 bg-white/90 backdrop-blur-md sticky top-0 z-50 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-6">
          <Link href="/dashboard" className="flex items-center space-x-2.5 font-bold text-lg tracking-tight text-slate-900 hover:opacity-95 transition-opacity">
            <div className="p-1.5 bg-purple-50 text-purple-700 rounded-xl border border-purple-200/80 shadow-xs">
              <Shield className="w-5 h-5 text-purple-700" />
            </div>
            <span>NewGen<span className="text-purple-700">SAST</span></span>
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
                        ? "bg-purple-50 text-purple-900 border border-purple-200 shadow-xs"
                        : "text-slate-600 hover:text-purple-900 hover:bg-purple-50/50"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? "text-purple-700" : "text-slate-400"}`} />
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
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium bg-slate-50 border border-slate-200 shadow-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  health.status === "ok" || health.status === "healthy"
                    ? "bg-emerald-500 animate-pulse"
                    : "bg-amber-500"
                }`}
              />
              <span className="text-slate-700 font-medium">
                {health.active_scans > 0 ? `${health.active_scans} Active Scans` : "System Healthy"}
              </span>
            </div>
          )}

          {/* Swarm Observability Link */}
          <Link
            href="/dashboard"
            className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-900 border border-purple-200 hover:bg-purple-100 transition-colors shadow-2xs"
            title="Native Swarm Observability & Trace Forensics"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse"></span>
            <span>Swarm Forensics</span>
          </Link>

          {/* User state */}
          {user ? (
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1.5 text-xs text-purple-900 bg-purple-50/80 px-2.5 py-1.5 rounded-xl border border-purple-200/70 font-semibold shadow-xs">
                <UserIcon className="w-3.5 h-3.5 text-purple-600" />
                <span className="max-w-[130px] truncate">{user.email}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-700 bg-rose-50/80 border border-rose-200 hover:bg-rose-100 hover:text-rose-800 transition-all shadow-xs"
                title="Log out and invalidate all active sessions"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-600" />
                <span>Log Out</span>
              </button>
            </div>
          ) : !isAuthPage ? (
            <Link
              href="/login"
              className="text-xs font-bold px-3.5 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white shadow-xs transition-all hover:-translate-y-0.5"
            >
              Sign In
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
