import Link from "next/link";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand-logo group inline-flex items-center gap-1.5" aria-label="Riezz99 beranda">
    <span className="brand-logo__mark" aria-hidden="true" />
    <span className="display text-xl font-bold tracking-[-.06em] sm:text-[1.4rem]">Riezz<span className="brand-logo__digits text-coral"><span className="brand-logo__digit brand-logo__digit--first">9</span><span className="brand-logo__digit brand-logo__digit--second">9</span></span></span>
    {!compact && <span className="hidden text-[9px] font-bold uppercase tracking-[.16em] text-ink/45 sm:inline">Digital Marketplace</span>}
  </Link>;
}
