import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { destinationForRole } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

export default async function AuthRedirectPage() {
  const session = await auth();
  redirect(session ? destinationForRole(session.user.role) : "/login");
}
