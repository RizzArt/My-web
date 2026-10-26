"use client";

import { useEffect } from "react";

export function ReceiptPrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);

  return <button type="button" onClick={() => window.print()} className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white hover:bg-coral">
    Cetak / Simpan PDF
  </button>;
}
