import { createHmac } from "node:crypto";
import { trustedClientIp } from "@/lib/trusted-client-ip";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function configuredHostname() {
  return process.env.STAGING_DIAGNOSTIC_HOSTNAME?.trim().toLowerCase() ?? "";
}

function diagnosticsSecret() {
  const secret = process.env.STAGING_DIAGNOSTIC_SECRET;
  if (!secret) throw new Error("STAGING_DIAGNOSTIC_SECRET wajib dikonfigurasi saat diagnostik staging aktif.");
  return secret;
}

export function stagingSecurityDiagnosticsEnabled(hostname: string) {
  return process.env.STAGING_ISOLATED_ENVIRONMENT === "true"
    && process.env.STAGING_SECURITY_DIAGNOSTICS_ENABLED === "true"
    && Boolean(configuredHostname())
    && hostname.trim().toLowerCase() === configuredHostname();
}

export function stagingSecurityDiagnosticSnapshot(request: Request) {
  const clientIp = trustedClientIp(request);
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
  const forwardedFor = request.headers.get("x-forwarded-for")?.trim() ?? "";

  return {
    trustedIdentityAccepted: Boolean(clientIp),
    // The public IP is never returned. A stable per-staging fingerprint is enough
    // to compare a normal request with one carrying forged forwarding headers.
    identityFingerprint: clientIp ? createHmac("sha256", diagnosticsSecret()).update(`staging-proxy:${clientIp}`).digest("hex").slice(0, 24) : null,
    // Next.js restores a missing X-Forwarded-For from its direct loopback peer.
    // That value is safe: Nginx already removed any client-supplied value.
    forwardedForCleared: forwardedFor === "" || LOOPBACK_ADDRESSES.has(forwardedFor),
    realIpRewrittenToLoopback: LOOPBACK_ADDRESSES.has(realIp),
  };
}
