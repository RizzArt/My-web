export const STUDIO_TOPUP_PACKAGES = {
  STUDIO_100: { code: "STUDIO_100", name: "100 Studio Credit", price: 10_000, credits: 100 },
} as const;

export type StudioTopUpPackageCode = keyof typeof STUDIO_TOPUP_PACKAGES;

export function getStudioTopUpPackage(code: string) {
  return STUDIO_TOPUP_PACKAGES[code as StudioTopUpPackageCode] ?? null;
}
