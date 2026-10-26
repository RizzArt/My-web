import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireAdmin() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

export async function requireUser() {
  const session = await auth();
  if (!session) redirect("/login");
  return session;
}

export async function requireSellerOrAdmin() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "SELLER" && session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

export async function requireSeller() {
  const session = await requireSellerOrAdmin();
  if (session.user.role !== "SELLER") redirect("/admin");
  return session;
}
