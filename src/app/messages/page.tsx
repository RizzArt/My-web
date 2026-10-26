import { requireUser } from "@/lib/auth-guards";
import { MessagesPage } from "@/components/messages-page";
export default async function Page() { await requireUser(); return <MessagesPage role="CUSTOMER" />; }
