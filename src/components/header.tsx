import Link from "next/link";
import { auth } from "@/auth";
import { MobileMenu } from "./mobile-menu";
import { BrandLogo } from "./brand-logo";
import { NotificationCenter } from "./notification-center";
import { prisma } from "@/lib/prisma";
import { MessageLink } from "./realtime/message-link";
import { AiStudioNavLink } from "./ai-studio-nav-link";

export async function Header() {
  const session = await auth();
  let notificationData: { id: string; title: string; message: string; link: string | null; isRead: boolean; createdAt: string }[] = [];
  let unreadCount = 0;
  let pendingRefundCount = 0;
  let pendingCancellationCount = 0;
  if (session?.user?.id) {
    try {
      const [notifications, count] = await Promise.all([
        prisma.notification.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
        prisma.notification.count({ where: { userId: session.user.id, isRead: false } }),
      ]);
      notificationData = notifications.map((notification) => ({ ...notification, createdAt: notification.createdAt.toISOString() }));
      unreadCount = count;
      if (session.user.role === "ADMIN") {
        [pendingRefundCount, pendingCancellationCount] = await Promise.all([
          prisma.refundRequest.count({ where: { status: "PENDING" } }),
          prisma.cancellationRequest.count({ where: { status: "PENDING" } }),
        ]);
      }
    } catch { /* Header remains available during first-time database setup. */ }
  }
  const chatPath = session?.user.role === "ADMIN" ? "/admin/messages" : session?.user.role === "SELLER" ? "/seller/messages" : "/messages";
  return <>
<header className="sticky top-0 z-40 border-b border-ink/10 bg-sand/90 backdrop-blur">
<div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
<BrandLogo />
<nav className="hidden items-center gap-5 text-sm font-medium xl:flex">
<AiStudioNavLink />
<Link href="/products" className="hover:text-coral">Produk</Link>
<Link href="/dashboard" className="hover:text-coral">Dashboard</Link>{session?.user.role === "CUSTOMER" && <><Link href={"/dashboard/wallet" as never} className="hover:text-coral">Saldo Saya</Link><Link href={"/dashboard/api#keys" as never} className="hover:text-coral">API Keys</Link><Link href={"/dashboard/api#balance" as never} className="hover:text-coral">API Balance</Link></>}{session?.user.role === "SELLER" && <Link href="/seller/promotions" className="hover:text-coral">Promosi</Link>}{session?.user.role === "ADMIN" && <details className="admin-nav-menu"><summary aria-label="Buka menu admin">Admin{pendingRefundCount + pendingCancellationCount > 0 && <span className="rounded-full bg-coral px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingRefundCount + pendingCancellationCount}</span>}<span aria-hidden="true">⌄</span></summary><div className="admin-nav-menu__panel"><Link href="/admin">Dasbor Admin</Link><Link href={"/admin/ai-api" as never}>AI API</Link><Link href="/admin/promotions">Promosi</Link><Link href="/admin/refunds">Pengajuan Refund{pendingRefundCount > 0 && <span>{pendingRefundCount}</span>}</Link><Link href="/admin/cancellations">Pembatalan Pesanan{pendingCancellationCount > 0 && <span>{pendingCancellationCount}</span>}</Link><Link href="/admin/customer-withdrawals">Penarikan Pembeli</Link></div></details>}</nav>
<div className="flex min-w-0 items-center gap-1.5 text-sm sm:gap-2">{!session && <Link href="/login" className="hidden rounded-full bg-ink px-4 py-2 font-semibold text-white transition hover:bg-coral sm:inline">Masuk / Daftar</Link>}{session && <>
<NotificationCenter initialNotifications={notificationData} initialUnreadCount={unreadCount} userId={session.user.id} role={session.user.role} />
<MessageLink href={chatPath} />
</>}{<Link href="/cart" className="hidden rounded-full border border-ink/20 px-4 py-2 font-semibold hover:border-coral hover:text-coral sm:inline">Cart</Link>}<MobileMenu user={session?.user ?? null} />
</div>
</div>
</header>
</>;
}
