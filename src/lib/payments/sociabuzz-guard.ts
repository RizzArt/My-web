export function hasActiveSociaBuzzInvoice(
  payment: { provider: string | null; externalId: string | null; status?: string } | null,
) {
  return (payment?.status === undefined || payment.status === "PENDING") &&
    payment?.provider === "SOCIABUZZ" &&
    Boolean(payment.externalId?.startsWith("scbz:"));
}

export function assertSociaBuzzAlternativeAllowed(
  payment: { provider: string | null; externalId: string | null; status?: string } | null,
) {
  if (hasActiveSociaBuzzInvoice(payment)) {
    throw new Error(
      "Invoice QRIS sudah diproses. Periksa status pembayaran sebelum mengganti metode atau membatalkan pesanan.",
    );
  }
}
