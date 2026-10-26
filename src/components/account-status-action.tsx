"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountStatusAction({
  userId, label, isActive,
}: { userId: string; label: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act() {
    if (busy) return;
    let reason = "";
    if (isActive) {
      const answer = window.prompt(`Alasan ban akun ${label} (3–500 karakter):`);
      if (answer === null) return;
      reason = answer.trim();
      if (reason.length < 3 || reason.length > 500) {
        setMessage("Alasan harus 3–500 karakter.");
        return;
      }
    }
    if (!window.confirm(isActive
      ? `Ban akun ${label}? Login dan akses akun akan diblokir.`
      : `Aktifkan kembali akun ${label}?`)) return;

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Status gagal disimpan.");
      setMessage(isActive ? "Akun berhasil dibanned." : "Akun berhasil diaktifkan.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tidak dapat terhubung.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-4">
    <button type="button" disabled={busy} onClick={() => void act()}
      className={`min-h-11 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50 ${
        isActive ? "border border-red-200 text-red-700 hover:bg-red-50" : "bg-ink text-white"
      }`}>
      {busy ? "Menyimpan..." : isActive ? "Ban akun" : "Aktifkan kembali"}
    </button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </div>;
}
