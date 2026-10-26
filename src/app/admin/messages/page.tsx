import { requireAdmin } from "@/lib/auth-guards";
import { MessagesPage } from "@/components/messages-page";
export default async function Page() { await requireAdmin(); return <MessagesPage basePath="/admin/messages" role="ADMIN" />; }
