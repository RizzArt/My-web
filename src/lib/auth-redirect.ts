import type { Role } from "@prisma/client";

const DEFAULT_REDIRECT = "/auth/redirect";

export function destinationForRole(role: Role | string | undefined) {
  if (role === "ADMIN") return "/admin";
  if (role === "SELLER") return "/seller";
  return "/dashboard";
}

/** Only accept a same-origin URL. Auth.js passes absolute URLs to this callback. */
export function safeInternalRedirect(url: string, baseUrl: string, fallback = DEFAULT_REDIRECT) {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url, base);
    if (target.origin !== base.origin || target.pathname.startsWith("//")) return new URL(fallback, base).toString();
    return target.toString();
  } catch {
    return new URL(fallback, baseUrl).toString();
  }
}

/** Client-side callback values are kept relative so they cannot become open redirects. */
export function safeInternalPath(value: string | null | undefined, fallback = DEFAULT_REDIRECT) {
  if (!value) return fallback;
  try {
    const target = new URL(value, "https://riezz99.biz.id");
    if (target.origin !== "https://riezz99.biz.id" || target.pathname.startsWith("//")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
