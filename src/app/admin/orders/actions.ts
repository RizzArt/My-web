"use server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
type ActionResult = { ok: true } | { ok: false; error: string };

async function callAdminEndpoint(path: string, init?: RequestInit): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return { ok: false, error: "Sesi admin tidak valid." };
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  if (!host) return { ok: false, error: "Konfigurasi alamat aplikasi tidak tersedia." };
  const endpointHeaders = new Headers(init?.headers);
  endpointHeaders.set("Cookie", requestCookies.toString());
  if (process.env.NODE_ENV === "production" && process.env.MANUAL_PAYMENT_TEST_MODE === "true" && process.env.MANUAL_PAYMENT_TEST_TOKEN) endpointHeaders.set("x-manual-payment-test-token", process.env.MANUAL_PAYMENT_TEST_TOKEN);
  try { const response = await fetch(`${protocol}://${host}${path}`, { ...init, headers: endpointHeaders, cache: "no-store" }); if (response.ok) return { ok: true }; const payload = await response.json().catch(() => null) as { error?: string } | null; return { ok: false, error: payload?.error && payload.error.length < 180 ? payload.error : "Aksi admin gagal diproses." }; } catch { return { ok: false, error: "Tidak dapat menghubungi layanan order." }; }
}
export async function markOrderPaid(orderId: string, reason: string): Promise<ActionResult> { if (!reason.trim()) return { ok: false, error: "Alasan verifikasi wajib diisi." }; return callAdminEndpoint(`/api/admin/orders/${encodeURIComponent(orderId)}/mark-paid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); }
export async function retryOrderEmail(orderId: string): Promise<ActionResult> { return callAdminEndpoint(`/api/admin/orders/${encodeURIComponent(orderId)}/retry-email`, { method: "POST" }); }
export async function changeDeliveryEmail(orderId: string, email: string, reason: string): Promise<ActionResult> { if (!email.trim() || !reason.trim()) return { ok: false, error: "Email dan alasan perubahan wajib diisi." }; return callAdminEndpoint(`/api/admin/orders/${encodeURIComponent(orderId)}/delivery-email`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, reason }) }); }
