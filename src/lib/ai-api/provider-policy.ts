// AI API resale policy only. SEKAI image Studio has a separate admission path.
// The retained provider still lacks a verified balance/reconciliation/idempotency
// contract. This is a release-reviewed policy, not an environment/admin override.
const GRIPHUB_CUSTOMER_BILLING_VERIFIED: boolean = false;

export function customerBillingProviderAdmitted(provider: string): boolean {
  return provider === "GRIPHUB" && GRIPHUB_CUSTOMER_BILLING_VERIFIED;
}
