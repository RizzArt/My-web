import Link from "next/link";
import { requireAdmin } from "@/lib/auth-guards";
import { getStoreSettings, configured } from "@/lib/admin-settings";
import { AdminSettingsForm } from "@/components/admin-settings-form";
export const dynamic = "force-dynamic";
export default async function AdminSettingsPage() { await requireAdmin(); const settings = await getStoreSettings(); return <main className="mx-auto max-w-5xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Back office</p><h1 className="display mt-3 text-4xl font-bold sm:text-6xl">Admin settings</h1><p className="mt-4 text-ink/60">Secret tetap berada di environment dan tidak pernah dikirim ke browser.</p><Link href={"/admin/security" as never} className="mt-5 inline-flex rounded-full border border-ink/20 px-5 py-3 text-sm font-bold hover:border-coral hover:text-coral">Kelola keamanan admin dan MFA</Link><AdminSettingsForm settings={settings} smtpConfigured={configured("SMTP_PASS")} paymentConfigured={configured("MIDTRANS_SERVER_KEY") || configured("PAYMENT_API_KEY")} environment={process.env.NODE_ENV} /></main>; }
