import "./globals.css";
import React from "react";
import Header from "@/components/Header";
import AuthGuard from "@/components/AuthGuard";

export const metadata = {
  title: "NewGenSAST - AI-Powered Vulnerability & Patching Platform",
  description: "Autonomous Agentic SAST Harness inspired by Google Mantis",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex flex-col min-h-screen text-slate-900 antialiased selection:bg-purple-100 selection:text-purple-900">
        <Header />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <AuthGuard>{children}</AuthGuard>
        </main>
        <footer className="border-t border-purple-100/80 bg-white/60 backdrop-blur py-4 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              NewGenSAST Platform &copy; {new Date().getFullYear()} &bull; Self-Hosted Internal Edition
            </span>
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-600 inline-block"></span>
              <span>Imperial Studio Aesthetic</span>
              <span className="text-slate-300">&bull;</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span>
              <span>Honey Amber Telemetry</span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
