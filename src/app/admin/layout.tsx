import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
  return children;
}
