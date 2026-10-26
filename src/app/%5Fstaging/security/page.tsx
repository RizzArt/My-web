import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { StagingSecurityDiagnostics } from "@/components/staging-security-diagnostics";
import { stagingSecurityDiagnosticsEnabled } from "@/lib/staging-security-diagnostics";

export default async function StagingSecurityPage() {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get("host")?.split(":")[0] ?? "";
  if (!stagingSecurityDiagnosticsEnabled(hostname)) notFound();
  return <StagingSecurityDiagnostics />;
}
