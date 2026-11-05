import "./globals.css";
import React from "react";
import Header from "@/components/Header";
import AuthGuard from "@/components/AuthGuard";

export const metadata = {
  title: "NewGenSAST - AI-Powered Vulnerability & Patching Platform",
  description: "Autonomous Agentic SAST & Dynamic Vulnerability Remediation Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex flex-col min-h-screen text-slate-100 antialiased selection:bg-amber-500/30 selection:text-amber-200">
        <Header />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <AuthGuard>{children}</AuthGuard>
        </main>
        <footer className="border-t border-slate-800/80 bg-[#090d16]/80 backdrop-blur py-4 text-center text-xs text-slate-400">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              NewGenSAST Platform &copy; {new Date().getFullYear()} &bull; Autonomous Multi-Agent Security Engine
            </span>
            <span className="flex items-center space-x-1.5 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block shadow-sm shadow-amber-500/50"></span>
              <span className="text-amber-400 font-semibold">Obsidian Amber Aurora</span>
              <span className="text-slate-600">&bull;</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shadow-sm shadow-emerald-500/50"></span>
              <span className="text-emerald-400 font-semibold">Verified Exploit Telemetry</span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
