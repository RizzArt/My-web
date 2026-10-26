import { requireAdmin } from "@/lib/auth-guards";
import { AdminAiApiManager } from "@/components/admin-ai-api-manager";

export const dynamic = "force-dynamic";

export default async function AdminAiApiPage() {
  await requireAdmin();
  return <main className="api-pro-shell min-h-[calc(100vh-4rem)] px-4 py-10 sm:px-6 sm:py-14"><AdminAiApiManager /></main>;
}
