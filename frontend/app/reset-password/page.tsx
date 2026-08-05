"use client";

import { useEffect, useState } from "react";
import { confirmPasswordReset } from "@/lib/logistics-api";

function getQueryParam(name: string) {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string>("client");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setToken(getQueryParam("token"));
    const roleParam = getQueryParam("role");
    if (roleParam === "carrier" || roleParam === "client" || roleParam === "driver") {
      setRole(roleParam);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setMessage("Reset token is missing. Please use the link from your email.");
      return;
    }
    if (!email.trim()) {
      setMessage("Enter your email address.");
      return;
    }
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const response = await confirmPasswordReset({
        email: email.trim().toLowerCase(),
        role: role as "client" | "carrier" | "driver",
        token,
        new_password: password,
      });
      setMessage(response.detail || "Password reset successfully. You can now sign in.");
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : "Unable to reset password.";
      setMessage(messageText);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#020B16] px-4 py-12 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-700 bg-[#031227]/90 p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-white">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter the email and a new password for your account.
        </p>
        {message && (
          <div className="mt-4 rounded-2xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        )}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-400/80"
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">New password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-400/80"
              placeholder="New password"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-400/80"
              placeholder="Confirm password"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#031227] transition hover:bg-slate-100 disabled:opacity-60"
          >
            {submitting ? "Resetting..." : "Reset password"}
          </button>
          <div className="text-center text-sm text-slate-400">
            Role: <span className="font-medium text-white">{role}</span>
          </div>
        </form>
      </div>
    </div>
  );
}
