// Presentation only: stored values and business transitions remain unchanged.
const labels: Record<string, string> = {
  PENDING: "Menunggu proses", PENDING_REVIEW: "Menunggu peninjauan", APPROVED: "Disetujui",
  REJECTED: "Ditolak", PAID: "Dibayar", PROCESSING: "Diproses", COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan", EXPIRED: "Kedaluwarsa", FAILED: "Gagal", REFUNDED: "Dana dikembalikan",
  AVAILABLE: "Tersedia", REVERSED: "Dibatalkan", PAID_OUT: "Dicairkan", ACTIVE: "Aktif",
  BANK: "Transfer bank", E_WALLET: "Dompet digital", EWALLET: "Dompet digital",
  AUTO: "Pengiriman otomatis", MANUAL: "Pengiriman manual",
  SALE_PENDING: "Penjualan tertunda", SALE_AVAILABLE: "Pendapatan tersedia",
  WITHDRAW_RESERVED: "Saldo ditahan untuk penarikan", WITHDRAW_RELEASED: "Saldo penarikan dikembalikan",
  WITHDRAW_PAID: "Penarikan dibayar", REFUND_REVERSAL: "Penyesuaian pengembalian dana",
  ADMIN_ADJUSTMENT: "Penyesuaian saldo", PROMOTION_RESERVED: "Saldo promosi ditahan",
  PROMOTION_RELEASED: "Saldo promosi dikembalikan", PROMOTION_CHARGED: "Biaya promosi",
  REFUND_CREDIT: "Pengembalian dana", PURCHASE_DEBIT: "Pembayaran belanja",
  WITHDRAWAL_HOLD: "Saldo penarikan ditahan", WITHDRAWAL_RELEASE: "Saldo penarikan dikembalikan",
  FILE: "File digital", LICENSE_KEY: "Kunci lisensi", VOUCHER: "Voucher", ACCOUNT: "Akun", ACCESS_LINK: "Tautan akses",
  ASSIGNED: "Dialokasikan", DELIVERED: "Terkirim", SOLD: "Terjual",
};
export function displayLabel(value: string): string { return labels[value] ?? "Status belum tersedia"; }
