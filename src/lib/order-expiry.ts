export const UNPAID_ORDER_TIMEOUT_MS = 10 * 60 * 1000;

export function getUnpaidOrderDeadline(createdAt: Date | string | number) {
  return new Date(new Date(createdAt).getTime() + UNPAID_ORDER_TIMEOUT_MS);
}

export function isUnpaidOrderExpired(createdAt: Date | string | number, now = new Date()) {
  return getUnpaidOrderDeadline(createdAt).getTime() <= new Date(now).getTime();
}
