import { requireUser } from "@/lib/auth-guards";
import { StudioPage } from "@/components/studio-page";
export const dynamic = "force-dynamic";
export default async function Page() { await requireUser(); return <StudioPage />; }
