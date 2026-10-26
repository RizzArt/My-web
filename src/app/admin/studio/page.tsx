import { requireAdmin } from "@/lib/auth-guards";
import { AdminStudioForm } from "@/components/admin-studio-form";
export const dynamic = "force-dynamic";
export default async function Page() { await requireAdmin(); return <main className="mx-auto max-w-5xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Back office</p><h1 className="display mt-3 text-4xl font-bold sm:text-6xl">AI Studio</h1><p className="mt-4 text-ink/60">Kontrol model, harga Studio Credit, dan kredit pengguna.</p><AdminStudioForm /></main>; }
