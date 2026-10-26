"use client";

import { useEffect, useState } from "react";

type Bank = { code: string; name: string; fee: number };
type PayPal = { enabled: boolean };

export function PaymentMethodSelector({ productIds }: { productIds: string[] }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [method, setMethod] = useState("default");
  const [bankCode, setBankCode] = useState("");
  const [paypal, setPaypal] = useState<PayPal>({ enabled: false });
  const productIdQuery = new URLSearchParams(productIds.map((productId) => ["productId", productId])).toString();

  useEffect(() => {
    let active = true;
    void fetch(`/api/payment-methods?${productIdQuery}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Metode belum tersedia.");
        return response.json();
      })
      .then((data: { vaBanks?: Bank[]; paypal?: PayPal }) => {
        if (!active || !Array.isArray(data.vaBanks)) return;
        const valid = data.vaBanks.filter((bank) =>
          typeof bank.code === "string" && typeof bank.name === "string" &&
          Number.isSafeInteger(bank.fee) && bank.fee >= 0
        );
        setBanks(valid);
        setBankCode(valid[0]?.code ?? "");
        setPaypal(data.paypal?.enabled === true ? data.paypal : { enabled: false });
      })
      .catch(() => {
        if (active) setBanks([]);
      });
    return () => { active = false; };
  }, [productIdQuery]);

  const bank = banks.find((item) => item.code === bankCode);
  return <section className="space-y-3 rounded-2xl bg-sand p-4">
    <label className="block text-sm font-bold" htmlFor="checkout-payment-method">
      Metode pembayaran
    </label>
    <select
      id="checkout-payment-method"
      name="paymentMethod"
      value={method}
      onChange={(event) => setMethod(event.target.value)}
      className="w-full rounded-xl border border-ink/15 bg-white px-4 py-3"
    >
      <option value="default">QRIS / Saldo Akun</option>
      {banks.length > 0 && <option value="ipaymu_va">Virtual Account bank</option>}
      {paypal.enabled && <option value="paypal">PayPal (USD)</option>}
    </select>
    {method === "ipaymu_va" && <>
      <label className="block text-sm font-bold" htmlFor="checkout-va-bank">
        Bank tujuan
      </label>
      <select
        id="checkout-va-bank"
        name="paymentBank"
        value={bankCode}
        onChange={(event) => setBankCode(event.target.value)}
        className="w-full rounded-xl border border-ink/15 bg-white px-4 py-3"
        required
      >
        {banks.map((item) => <option key={item.code} value={item.code}>
          {item.name} · biaya Rp {item.fee.toLocaleString("id-ID")}
        </option>)}
      </select>
      {bank && <p className="text-sm">
        Biaya admin Rp {bank.fee.toLocaleString("id-ID")} ditanggung pembeli.
        Total akhir ditampilkan sebelum kamu membuat VA.
      </p>}
      <p className="text-xs text-ink/65">Nomor WhatsApp/HP wajib untuk pembayaran VA.</p>
    </>}
    {method === "paypal" && <p className="text-sm">Total USD dihitung server dari kurs IDR/USD yang dikonfigurasi dan ditampilkan sebelum persetujuan PayPal.</p>}
  </section>;
}
