// Keep the app mailer on the patched release while NextAuth retains its v8 peer.
import nodemailer from "nodemailer-secure";
import { publicAppUrl } from "@/lib/password-reset";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

function escape(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export async function sendEmail(message: EmailMessage) {
  const provider = process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "production" ? "smtp" : "console");
  if (provider === "console") {
    // Do not print license keys, passwords, or account credentials to logs.
    console.info("[email:dev] message generated", { to: message.to, subject: message.subject });
    return;
  }
  if (provider !== "smtp") throw new Error(`Unsupported email provider: ${provider}`);
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw new Error("SMTP_HOST and SMTP_FROM are required");
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === "true", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  await transport.sendMail({ from: process.env.SMTP_FROM, to: message.to, subject: message.subject, html: message.html, text: message.text });
}

export async function sendEmailVerificationCode(input: { to: string; code: string }) {
  const text = [
    "Halo,",
    "",
    `Kode verifikasi Anda: ${input.code}`,
    "Kode berlaku selama 10 menit.",
    "",
    "Jika Anda tidak membuat akun Riezz99, abaikan email ini.",
  ].join("\n");
  await sendEmail({
    to: input.to,
    subject: "Kode Verifikasi Riezz99",
    text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1d1f"><h1 style="color:#f26b5e">Riezz99</h1><p>Kode verifikasi Anda:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${input.code}</p><p>Kode berlaku selama 10 menit.</p><p>Jika Anda tidak membuat akun Riezz99, abaikan email ini.</p></div>`,
  });
}

export async function sendPasswordResetEmail(input: { to: string; name?: string | null; token: string }) {
  // Fragments are never sent in HTTP requests, keeping this bearer token out of proxy logs.
  const link = `${publicAppUrl()}/reset-password#token=${encodeURIComponent(input.token)}`;
  const safeName = escape(input.name?.trim() || "pengguna");
  const text = [`Halo ${input.name?.trim() || "pengguna"},`, "", "Kami menerima permintaan untuk mengatur ulang password akun Riezz99.", "Buka tautan berikut dalam 30 menit:", link, "", "Tautan ini hanya dapat digunakan sekali. Jika Anda tidak meminta reset password, abaikan email ini."].join("\n");
  await sendEmail({
    to: input.to,
    subject: "Atur Ulang Password Riezz99",
    text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1d1f;max-width:600px;margin:auto"><h1 style="color:#f26b5e">Riezz99</h1><p>Halo ${safeName},</p><p>Kami menerima permintaan untuk mengatur ulang password akun Riezz99.</p><p><a href="${escape(link)}" style="display:inline-block;background:#1d1d1f;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">Atur ulang password</a></p><p>Tautan berlaku 30 menit dan hanya dapat digunakan sekali.</p><p>Jika Anda tidak meminta reset password, abaikan email ini.</p></div>`,
  });
}

export async function sendGoogleSignInHelpEmail(input: { to: string; name?: string | null }) {
  const safeName = escape(input.name?.trim() || "pengguna");
  const text = [`Halo ${input.name?.trim() || "pengguna"},`, "", "Akun Riezz99 ini menggunakan login Google dan belum memiliki password lokal.", "Silakan kembali ke halaman login dan pilih Lanjutkan dengan Google.", "", "Jika Anda tidak meminta bantuan login, abaikan email ini."].join("\n");
  await sendEmail({
    to: input.to,
    subject: "Login Google Riezz99",
    text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1d1f;max-width:600px;margin:auto"><h1 style="color:#f26b5e">Riezz99</h1><p>Halo ${safeName},</p><p>Akun Riezz99 ini menggunakan login Google dan belum memiliki password lokal.</p><p>Silakan kembali ke halaman login dan pilih <strong>Lanjutkan dengan Google</strong>.</p><p>Jika Anda tidak meminta bantuan login, abaikan email ini.</p></div>`,
  });
}

export type DeliveryEmail = { productName: string; type: string; detail: string; link?: string; expiresAt?: Date | null };
export async function sendDigitalDeliveryEmail(input: { to: string; customerName: string; orderNumber: string; deliveries: DeliveryEmail[] }) {
  const safeName = escape(input.customerName);
  const rows = input.deliveries.map((delivery) => {
    const detail = escape(delivery.detail);
    const link = delivery.link ? `<p><a href="${escape(delivery.link)}">Open delivery</a>${delivery.expiresAt ? ` (expires ${escape(delivery.expiresAt.toISOString())})` : ""}</p>` : `<p><strong>${detail}</strong></p>`;
    return `<li><strong>${escape(delivery.productName)}</strong> (${escape(delivery.type)})${link}</li>`;
  }).join("");
  const text = [`Hi ${input.customerName},`, `Order ${input.orderNumber} is PAID.`, ...input.deliveries.map((item) => `${item.productName} [${item.type}]: ${item.link ?? item.detail}${item.expiresAt ? ` (expires ${item.expiresAt.toISOString()})` : ""}`), "Do not share your digital credentials or delivery links."].join("\n");
  await sendEmail({ to: input.to, subject: `Your Kolektif order ${input.orderNumber} is ready`, text, html: `<h1>Order ${escape(input.orderNumber)} is PAID</h1><p>Hi ${safeName},</p><p>Your digital products are ready:</p><ul>${rows}</ul><p><strong>Please do not share digital credentials.</strong></p>` });
}

export const sendOrderPaidEmail = sendDigitalDeliveryEmail;
