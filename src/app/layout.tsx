import type { Metadata } from "next";
import { Header } from "@/components/header";
import Link from "next/link";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { auth } from "@/auth";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { metadataBase: new URL(SITE_URL), title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` }, description: SITE_DESCRIPTION, manifest: "/manifest.webmanifest", icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" }, alternates: { canonical: SITE_URL }, openGraph: { type: "website", locale: "id_ID", siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, url: SITE_URL }, twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION } };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { const year = new Date().getFullYear(); const session = await auth(); return <html lang="id"><body><AuthSessionProvider session={session}><RealtimeProvider enabled={Boolean(session?.user?.id)}><a href="#main-content" className="skip-link">Lewati ke konten</a><Header /><div id="main-content" tabIndex={-1}>{children}</div><footer className="mt-16 border-t border-ink/10"><div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 text-sm text-ink/60"><div><span className="display font-bold text-ink">Riezz99</span><p className="mt-1">Marketplace Produk Digital</p></div><nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Tautan informasi"><Link href="/products">Produk</Link><Link href="/about">Tentang</Link><Link href="/faq">FAQ</Link><Link href="/terms">Syarat & Ketentuan</Link><Link href="/privacy">Privasi</Link><Link href="/refund-policy">Kebijakan Refund</Link><Link href="/contact">Kontak</Link></nav><p className="border-t border-ink/10 pt-4">© {year} Riezz99</p></div></footer></RealtimeProvider></AuthSessionProvider></body></html>; }
