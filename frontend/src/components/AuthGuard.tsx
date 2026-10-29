"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken, removeToken, api } from "@/lib/api";

const PUBLIC_ROUTES = ["/login", "/setup-totp"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  const isPublic = PUBLIC_ROUTES.some((route) => pathname === route || pathname?.startsWith(route));

  useEffect(() => {
    if (isPublic) {
      setAuthorized(true);
      setLoading(false);
      return;
    }

    const token = getToken();
    if (!token) {
      setAuthorized(false);
      setLoading(false);
      const redirectUrl = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : "/login";
      router.replace(redirectUrl);
      return;
    }

    // Verify token validity against the server
    let mounted = true;
    api.getMe()
      .then(() => {
        if (mounted) {
          setAuthorized(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          removeToken();
          setAuthorized(false);
          setLoading(false);
          const redirectUrl = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : "/login";
          router.replace(redirectUrl);
        }
      });

    return () => {
      mounted = false;
    };
  }, [pathname, isPublic, router]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] space-y-3">
        <div className="w-8 h-8 border-2 border-purple-700 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-semibold text-slate-400">Verifying security session...</p>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return <>{children}</>;
}
