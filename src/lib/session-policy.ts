export const ADMIN_ABSOLUTE_SESSION_SECONDS = 24 * 60 * 60;
export const CUSTOMER_ABSOLUTE_SESSION_SECONDS = 7 * 24 * 60 * 60;

type SessionPolicyToken = {
  role?: string;
  sessionStartedAt?: number;
  iat?: number;
};

export function initialSessionStartedAt(token: SessionPolicyToken, nowMs = Date.now()) {
  if (Number.isFinite(token.sessionStartedAt) && Number(token.sessionStartedAt) > 0) {
    return Number(token.sessionStartedAt);
  }
  if (Number.isFinite(token.iat) && Number(token.iat) > 0) {
    return Number(token.iat) * 1000;
  }
  return nowMs;
}

export function applyAbsoluteSessionPolicy<T extends SessionPolicyToken>(token: T, nowMs = Date.now()): T | null {
  const startedAt = token.sessionStartedAt;
  if (!Number.isFinite(startedAt) || Number(startedAt) <= 0 || Number(startedAt) > nowMs) return null;

  const maxAgeSeconds = token.role === "ADMIN"
    ? ADMIN_ABSOLUTE_SESSION_SECONDS
    : CUSTOMER_ABSOLUTE_SESSION_SECONDS;
  if (nowMs - Number(startedAt) >= maxAgeSeconds * 1000) return null;
  return token;
}
