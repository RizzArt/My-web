"use client";

import { useEffect, useRef, useState } from "react";

type PayPalButtonApi = { render: (target: HTMLElement) => void };
type PayPalSdk = { Buttons: (options: { createOrder: () => Promise<string>; onApprove: (data: { orderID: string }) => Promise<void>; onError: () => void }) => PayPalButtonApi };

function formatIdrRate(rate: string) {
  const amount = Number(rate);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 }).format(amount)
    : rate;
}

export function PayPalPayment({ orderId }: { orderId: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("Memuat PayPal...");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const configResponse = await fetch(`/api/orders/${encodeURIComponent(orderId)}/paypal/config`, { cache: "no-store" });
      const config = await configResponse.json() as { paypal?: { enabled?: boolean; clientId?: string; currency?: string } };
      if (!configResponse.ok || !config.paypal?.enabled || !config.paypal.clientId || !target.current) {
        throw new Error("PayPal sedang tidak tersedia untuk pesanan ini.");
      }
      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypal.clientId)}&currency=${encodeURIComponent(config.paypal.currency ?? "USD")}&intent=capture&components=buttons`;
      script.async = true;
      script.onload = () => {
        const sdk = (window as typeof window & { paypal?: PayPalSdk }).paypal;
        if (!active || !sdk || !target.current) return;
        sdk.Buttons({
          createOrder: async () => {
            const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/paypal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
            const data = await response.json() as { paypalOrderId?: string; amount?: string; currency?: string; exchangeRate?: string; error?: string };
            if (!response.ok || !data.paypalOrderId) throw new Error(data.error ?? "Order PayPal tidak dapat dibuat.");
            if (active) setMessage(`Total di PayPal: ${data.currency} ${data.amount}. Kurs pesanan: Rp ${formatIdrRate(data.exchangeRate ?? "")} per USD. Periksa nominal ini sebelum menyetujui pembayaran.`);
            return data.paypalOrderId;
          },
          onApprove: async (data) => {
            const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/paypal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "capture", paypalOrderId: data.orderID }) });
            const result = await response.json() as { paid?: boolean; review?: boolean; error?: string };
            if (!response.ok) throw new Error(result.error ?? "Capture PayPal gagal.");
            if (active) setMessage(result.review ? "Pembayaran tercatat untuk review; produk tidak dikirim otomatis." : "Pembayaran PayPal terverifikasi. Menyiapkan pesanan...");
            if (result.paid) window.location.assign(`/dashboard/orders/${orderId}`);
          },
          onError: () => { if (active) setMessage("PayPal belum dapat diproses. Jangan coba metode lain jika order PayPal sudah dibuat."); },
        }).render(target.current);
        setMessage("PayPal akan menampilkan total dalam USD. Kurs pesanan dan nominal final ditampilkan sebelum Anda menyetujui pembayaran.");
      };
      script.onerror = () => { if (active) setMessage("SDK PayPal tidak dapat dimuat."); };
      document.head.appendChild(script);
    };
    void load().catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "PayPal belum tersedia."); });
    return () => { active = false; };
  }, [orderId]);

  return <section className="mt-8 border-t border-ink/10 pt-6">
    <h2 className="text-xl font-bold">Bayar dengan PayPal</h2>
    <p className="mt-2 text-sm text-ink/65">Total PayPal ditampilkan dalam USD. Kurs pesanan disimpan saat pembayaran dibuat, jadi periksa nominal USD sebelum menyetujui.</p>
    <div ref={target} className="mt-4 min-h-11" />
    <p className="mt-3 text-sm" aria-live="polite">{message}</p>
  </section>;
}
