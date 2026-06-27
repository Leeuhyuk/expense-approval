"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      const idToken = await cred.user.getIdToken();
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("session");
      router.push("/");
      router.refresh();
    } catch {
      setErr("로그인 실패 — 이메일 또는 비밀번호를 확인하세요.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div
        className="w-full max-w-[380px] rounded-[14px] border border-line bg-white p-8"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="text-[13px] font-semibold tracking-[0.14em] text-accent">내부 보고 시스템</div>
        <h1 className="mt-1.5 text-[22px] font-extrabold tracking-[-0.02em]">결재 시스템 로그인</h1>
        <p className="mt-1 text-[13px] text-muted">결재자 계정으로 로그인하세요.</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-label">이메일</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="rounded-lg border border-line-strong px-3.5 py-2.5 text-[14px] outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-label">비밀번호</span>
            <input
              type="password"
              required
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="current-password"
              className="rounded-lg border border-line-strong px-3.5 py-2.5 text-[14px] outline-none focus:border-accent"
            />
          </label>

          {err && (
            <div className="rounded-lg bg-reject-bg px-3 py-2.5 text-[12.5px] font-semibold text-reject-text">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-[9px] bg-accent px-3 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {loading ? "로그인 중…" : "로그인"}
          </button>
        </form>
      </div>
    </main>
  );
}
