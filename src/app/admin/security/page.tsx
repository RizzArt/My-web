import { AdminMfaPanel } from "@/components/admin-mfa-panel";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const session = await requireAdmin();
  const credential = await prisma.adminMfaCredential.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return <main className="mx-auto max-w-4xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Back office</p><h1 className="display mt-3 text-4xl font-bold sm:text-6xl">Keamanan admin</h1><p className="mt-4 text-ink/60">Kelola MFA tanpa pernah menyimpan secret atau recovery code di browser setelah halaman ini ditutup.</p><AdminMfaPanel enabled={Boolean(credential)} /></main>;
}
