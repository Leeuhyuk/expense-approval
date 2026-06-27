"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await signOut(auth).catch(() => {});
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      className="rounded-md border border-line-strong px-2.5 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-surface-2"
    >
      로그아웃
    </button>
  );
}
