"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Layers,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
} from "lucide-react";

export interface PublicSystemState {
  needsSetup: boolean;
  allowRegistration: boolean;
  authMode: "both" | "builtin" | "oidc";
  oidcConfigured: boolean;
  oidcProviderName: string;
}

interface AuthOnboardingViewProps {
  system: PublicSystemState;
  onAuthenticated: () => void;
}

export function AuthOnboardingView({ system, onAuthenticated }: AuthOnboardingViewProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [authMode, setAuthMode] = useState<"both" | "builtin" | "oidc">("both");
  const [showOidcSetup, setShowOidcSetup] = useState(false);
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcProviderName, setOidcProviderName] = useState("Single Sign-On (OIDC)");
  const [seedDemoData, setSeedDemoData] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Administrator",
          email,
          password,
          currency,
          allowRegistration,
          authMode,
          oidcIssuer,
          oidcClientId,
          oidcClientSecret,
          oidcProviderName,
          seedDemoData,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to complete initial setup.");
      } else {
        onAuthenticated();
      }
    } catch {
      setError("Network error while completing setup.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoginOrRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const endpoint = tab === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          password,
          currency,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Authentication failed.");
      } else {
        onAuthenticated();
      }
    } catch {
      setError("Network error during authentication.");
    } finally {
      setLoading(false);
    }
  };

  // 1. FIRST-LAUNCH ADMIN SETUP WIZARD
  if (system.needsSetup) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/50">
        <div className="w-full max-w-xl bg-slate-900/95 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                First-Launch Setup Wizard
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">
                Welcome to FinFlow Tracker
              </h1>
            </div>
          </div>

          <p className="text-sm text-slate-300 mb-6 leading-relaxed">
            No users exist yet. Create your primary <strong>Administrator</strong> account below and
            choose how authentication and user registration should work on this server.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Admin Display Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="Alex Rivera"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Default Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="CHF">CHF (Fr.)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Admin Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    placeholder="admin@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Admin Password (min. 6 chars)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Authentication Mode
                </label>
                <select
                  value={authMode}
                  onChange={(e) => setAuthMode(e.target.value as "both" | "builtin" | "oidc")}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white"
                >
                  <option value="both">Built-in Auth + OIDC (Recommended)</option>
                  <option value="builtin">Built-in Email & Password Only</option>
                  <option value="oidc">OIDC (Single Sign-On) Only</option>
                </select>
              </div>

              <label className="flex items-center justify-between gap-3 cursor-pointer pt-1">
                <div>
                  <span className="text-sm font-medium text-slate-200 block">
                    Allow Public Self-Registration
                  </span>
                  <span className="text-xs text-slate-400">
                    If disabled, only you (the Admin) can create new users.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={allowRegistration}
                  onChange={(e) => setAllowRegistration(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500 rounded"
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer pt-2 border-t border-slate-800/80">
                <div>
                  <span className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Pre-load Sample Category Tree, Accounts & Split Transactions
                  </span>
                  <span className="text-xs text-slate-400">
                    Seeds Private & Business accounts, nested folders, and example split expenses.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={seedDemoData}
                  onChange={(e) => setSeedDemoData(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500 rounded"
                />
              </label>

              <div className="pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowOidcSetup(!showOidcSetup)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  {showOidcSetup ? "Hide OIDC Settings" : "+ Configure OIDC Provider Now (Optional)"}
                </button>

                {showOidcSetup && (
                  <div className="mt-3 space-y-2.5">
                    <input
                      type="text"
                      placeholder="OIDC Issuer URL (e.g. https://auth.example.com/application/o/finflow)"
                      value={oidcIssuer}
                      onChange={(e) => setOidcIssuer(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="OIDC Client ID"
                        value={oidcClientId}
                        onChange={(e) => setOidcClientId(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                      />
                      <input
                        type="password"
                        placeholder="OIDC Client Secret"
                        value={oidcClientSecret}
                        onChange={(e) => setOidcClientSecret(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="OIDC Button Label (e.g. Single Sign-On)"
                      value={oidcProviderName}
                      onChange={(e) => setOidcProviderName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                    />
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {loading ? "Initializing Workspace..." : "Create Admin Account & Launch FinFlow"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. STANDARD LOGIN / REGISTRATION / OIDC SCREEN
  const showBuiltin = system.authMode === "both" || system.authMode === "builtin";
  const showOidc = system.authMode === "both" || system.authMode === "oidc";

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40">
      <div className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">FinFlow Finance Tracker</h1>
            <p className="text-xs text-slate-400">
              Hierarchical Category Tree • Private & Business Accounts
            </p>
          </div>
        </div>

        {showBuiltin && system.allowRegistration && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 mb-5">
            <button
              type="button"
              onClick={() => {
                setTab("login");
                setError(null);
              }}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === "login" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("register");
                setError(null);
              }}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === "register" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
            {error}
          </div>
        )}

        {showBuiltin && (
          <form onSubmit={handleLoginOrRegister} className="space-y-4">
            {tab === "register" && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Your Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="Alex Rivera"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {tab === "login" ? (
                <>
                  <KeyRound className="w-4 h-4" />
                  {loading ? "Signing in..." : "Sign In"}
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  {loading ? "Creating Account..." : "Register & Open Workspace"}
                </>
              )}
            </button>
          </form>
        )}

        {showOidc && (
          <div className={showBuiltin ? "mt-5 pt-5 border-t border-slate-800" : ""}>
            <a
              href="/api/auth/oidc/login"
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              Continue with {system.oidcProviderName || "Single Sign-On (OIDC)"}
            </a>
            {!system.oidcConfigured && (
              <p className="text-[11px] text-slate-500 text-center mt-2">
                Note: OIDC issuer/client ID can be configured via environment variables or the Admin
                panel.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
