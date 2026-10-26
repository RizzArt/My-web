import { requireSellerOrAdmin } from "@/lib/auth-guards";
export default async function SellerLayout({ children }: Readonly<{ children: React.ReactNode }>) { await requireSellerOrAdmin(); return children; }
