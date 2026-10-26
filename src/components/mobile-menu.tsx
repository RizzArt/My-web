"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { removeCurrentPushSubscription } from "@/lib/push/client";
import { AiStudioNavLink } from "./ai-studio-nav-link";

type MenuProps = { user: { name?: string | null; email?: string | null; role?: string } | null };

const customerLinks = [["AI Studio", "/studio"], ["Beranda", "/"], ["Produk", "/products"], ["Keranjang", "/cart"], ["Pesan", "/messages"], ["Pesanan Saya", "/dashboard"], ["Saldo Saya", "/dashboard/wallet"], ["API Keys", "/dashboard/api#keys"], ["API Balance", "/dashboard/api#balance"], ["Jadi Penjual", "/become-a-seller"], ["Profil", "/settings"]];
const sellerLinks = [["AI Studio", "/studio"], ["Beranda", "/"], ["Produk", "/products"], ["Keranjang", "/cart"], ["Pesan", "/seller/messages"], ["Pesanan Saya", "/dashboard"], ["Dasbor Penjual", "/seller"], ["Saldo", "/seller/wallet"], ["Promosi", "/seller/promotions"], ["Tarik Saldo", "/seller/withdraw"], ["Produk Toko", "/seller/products"], ["Persediaan", "/seller/inventory"], ["Pesanan Toko", "/seller/orders"], ["Pengaturan Toko", "/seller/settings"], ["Profil", "/settings"]];
const adminLinks = [["AI Studio", "/studio"], ["Dasbor Admin", "/admin"], ["Pengaturan AI Studio", "/admin/studio"], ["AI API", "/admin/ai-api"], ["Kelola Akun", "/admin/accounts"], ["Pengajuan Refund", "/admin/refunds"], ["Pembatalan Pesanan", "/admin/cancellations"], ["Penarikan Saldo Pembeli", "/admin/customer-withdrawals"], ["Promosi", "/admin/promotions"], ["Pesan", "/admin/messages"], ["Pesanan", "/admin/orders"], ["Penarikan", "/admin/withdrawals"], ["Produk", "/admin/products"], ["Kategori", "/admin/categories"], ["Pembeli", "/admin/customers"], ["Pengajuan Penjual", "/admin/sellers"], ["Penjual", "/admin/sellers/approved"], ["Persediaan Digital", "/admin/inventory"], ["Pengiriman", "/admin/deliveries"], ["Pembayaran", "/admin/payments"], ["Pengiriman Email", "/admin/email-delivery"], ["Pengumuman", "/admin/broadcast"], ["Riwayat Audit", "/admin/audit-logs"], ["Pengaturan", "/admin/settings"], ["Status Sistem", "/admin/system"]];
const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

export function MobileMenu({ user }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerId = "mobile-navigation-drawer";

  const closeMenu = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => setMounted(true), []);
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [closeMenu, open]);

  const links = user?.role === "ADMIN" ? adminLinks : user?.role === "SELLER" ? sellerLinks : customerLinks;
  async function logout() { await removeCurrentPushSubscription(); await signOut({ callbackUrl: "/" }); }
  const drawer = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[100] xl:hidden" role="dialog" aria-modal="true" aria-labelledby={`${drawerId}-title`}>
      <button type="button" aria-label="Tutup menu" className="absolute inset-0 z-0 h-full w-full bg-ink/45" onClick={closeMenu} />
      <aside ref={drawerRef} id={drawerId} className="fixed inset-y-0 right-0 z-10 flex h-[100dvh] w-[85vw] max-w-[360px] flex-col overflow-y-auto overscroll-contain bg-sand px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-ink/10 pb-5">
          <div className="min-w-0 pr-4">
            <p id={`${drawerId}-title`} className="display text-xl font-bold">Riezz99</p>
            <p className="mt-2 break-words text-sm text-ink/60">{user?.name || user?.email || "Tamu"}</p>
            {user?.role === "ADMIN" && <span className="mt-2 inline-flex rounded-full bg-coral px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">ADMIN</span>}
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Tutup menu" onClick={closeMenu} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-ink/60 hover:bg-white hover:text-coral focus:outline-none focus:ring-2 focus:ring-coral">×</button>
        </div>
        <nav className="mt-6 space-y-1" aria-label="Navigasi mobile">
          {links.map(([label, href]) => { const route = href.split("#")[0]; const active = pathname === route || (route !== "/admin" && pathname.startsWith(`${route}/`)); return href === "/studio" ? <AiStudioNavLink key={`${label}-${href}`} active={active} mobile onClick={closeMenu} /> : <Link key={`${label}-${href}`} href={href as never} onClick={closeMenu} aria-current={active ? "page" : undefined} className={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${active ? "bg-ink text-white" : "hover:bg-white"}`}>{label}</Link>; })}
          {user?.role === "ADMIN" && <div className="mt-5 border-t border-ink/10 pt-4"><p className="px-4 pb-2 text-xs font-bold uppercase tracking-widest text-coral">Admin</p></div>}
        </nav>
        <div className="mt-auto shrink-0 border-t border-ink/10 pt-5">
          {user ? <button type="button" onClick={logout} className="w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-coral hover:bg-white">Keluar</button> : <Link href="/login" onClick={closeMenu} className="block rounded-xl bg-ink px-4 py-3 text-center text-sm font-bold text-white">Masuk</Link>}
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  return <>
    <button ref={menuButtonRef} type="button" aria-label="Buka menu navigasi" aria-expanded={open} aria-controls={drawerId} onClick={() => setOpen(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 bg-white transition hover:border-coral focus:outline-none focus:ring-2 focus:ring-coral xl:hidden"><span className="sr-only">Menu</span><span className="space-y-1.5"><i className="block h-0.5 w-5 bg-ink" /><i className="block h-0.5 w-5 bg-ink" /><i className="block h-0.5 w-5 bg-ink" /></span></button>
    {drawer}
  </>;
}
