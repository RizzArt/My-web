import { requireUser } from "@/lib/auth-guards";
import { ConversationPage } from "@/components/conversation-page";
export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) { const session = await requireUser(); return <ConversationPage conversationId={(await params).conversationId} viewerId={session.user.id} />; }
