import { isIP } from "node:net";

const TRUSTED_CLIENT_IP_HEADER = "x-riezz-trusted-client-ip";

/**
 * This value is set by Nginx only after the Cloudflare Tunnel origin boundary.
 * Never fall back to X-Forwarded-For or X-Real-IP here: clients can supply them.
 */
export function trustedClientIp(request: Request) {
  const value = request.headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim() ?? "";
  return isIP(value) ? value : null;
}

export function clientRateLimitIdentity(request: Request) {
  return trustedClientIp(request) ?? "untrusted-proxy";
}
