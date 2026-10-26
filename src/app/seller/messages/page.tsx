import { requireSeller } from "@/lib/auth-guards";
import { MessagesPage } from "@/components/messages-page";
export default async function Page() { await requireSeller(); return <MessagesPage basePath="/seller/messages" role="SELLER" />; }
