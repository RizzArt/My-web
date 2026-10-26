import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { CustomerAiApiConsole } from "@/components/customer-ai-api-console";

export const dynamic = "force-dynamic";

export default async function CustomerAiApiPage() {
  const session = await requireUser();
  if (session.user.role !== "CUSTOMER") redirect((session.user.role === "ADMIN" ? "/admin/ai-api" : "/seller") as never);
  return <main className="api-pro-shell min-h-[calc(100vh-4rem)] px-4 py-10 sm:px-6 sm:py-14"><CustomerAiApiConsole /></main>;
}
