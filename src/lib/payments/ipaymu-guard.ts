type Payment = {
  provider?: string | null;
  externalId?: string | null;
};

export function hasIpaymuWalletLock(payment: Payment | null | undefined) {
  if (payment?.provider !== "IPAYMU") return false;
  return !/^ipaymu_draft:[a-z0-9_-]{1,30}:[a-zA-Z0-9_-]+$/.test(
    payment.externalId ?? "",
  );
}

export function assertIpaymuAlternativeAllowed(
  payment: Payment | null | undefined,
) {
  if (hasIpaymuWalletLock(payment)) {
    throw new Error(
      "VA sedang dibuat atau sudah aktif. Pembayaran saldo dikunci untuk mencegah pembayaran ganda.",
    );
  }
}
