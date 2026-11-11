import "./globals.css";
import React from "react";
import Header from "@/components/Header";
import AuthGuard from "@/components/AuthGuard";

export const metadata = {
  title: "MantisVision - Offensive Security & Exploit Telemetry Platform",
  description: "Professional Penetration Testing, Autonomous Vulnerability Verification & Exploit Telemetry Platform powered by Mantis ADK 2.0",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="flex flex-col min-h-screen text-slate-100 antialiased selection:bg-amber-500/30 selection:text-amber-200">
        <Header />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <AuthGuard>{children}</AuthGuard>
        </main>
        <footer className="border-t border-[#0C356A]/60 bg-[#07172C]/90 backdrop-blur py-4 text-center text-xs text-slate-400">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="flex items-center space-x-1.5 font-medium">
              <span>Mantis<span className="text-amber-400 font-bold">Vision</span> Platform &copy; {new Date().getFullYear()}</span>
              <span className="text-slate-600">&bull;</span>
              <span className="text-slate-400">Offensive Security &amp; Exploit Verification</span>
            </span>
            <span className="flex items-center space-x-1.5 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block shadow-sm shadow-amber-500/50"></span>
              <span className="text-amber-400 font-semibold">Autonomous Core</span>
              <span className="text-slate-600">&bull;</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shadow-sm shadow-emerald-500/50"></span>
              <span className="text-emerald-400 font-semibold">Verified Telemetry</span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
