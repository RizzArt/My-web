import { requireSeller } from "@/lib/auth-guards";
import { ConversationPage } from "@/components/conversation-page";
export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) { const session = await requireSeller(); return <ConversationPage basePath="/seller/messages" conversationId={(await params).conversationId} viewerId={session.user.id} />; }
