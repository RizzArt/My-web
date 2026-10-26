"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PromotionSlide } from "@/lib/promotions";

export type Promo = PromotionSlide;
export const PROMO_AUTO_SLIDE_INTERVAL = 6000;

export function getVisiblePromos(promos: Promo[] | null | undefined): Promo[] {
  return (Array.isArray(promos) ? promos : []).filter((item) => item.active && isSafePromoHref(item.ctaHref));
}

export function isSafePromoHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("\\\\");
}

export function shouldAutoSlide(slideCount: number, paused: boolean, reducedMotion: boolean) {
  return slideCount > 1 && !paused && !reducedMotion;
}

export function PromoSlider({ promos }: { promos: Promo[] }) {
  const slides = useMemo(() => getVisiblePromos(promos), [promos]);
  const [current, setCurrent] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const [pointerPaused, setPointerPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStart = useRef<number | null>(null);
  const paused = manualPaused || pointerPaused || focusPaused;

  useEffect(() => { setCurrent((value) => Math.min(value, Math.max(slides.length - 1, 0))); }, [slides.length]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!shouldAutoSlide(slides.length, paused, reducedMotion)) return;
    const timer = window.setInterval(() => setCurrent((value) => (value + 1) % slides.length), PROMO_AUTO_SLIDE_INTERVAL);
    return () => window.clearInterval(timer);
  }, [slides.length, paused, reducedMotion]);
  if (!slides.length) return null;
  const previous = () => setCurrent((value) => (value + slides.length - 1) % slides.length);
  const next = () => setCurrent((value) => (value + 1) % slides.length);
  return <section className="promo-slider" aria-label="Promosi" aria-roledescription="carousel" onMouseEnter={() => setPointerPaused(true)} onMouseLeave={() => setPointerPaused(false)} onFocusCapture={() => setFocusPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusPaused(false); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); previous(); } if (event.key === "ArrowRight") { event.preventDefault(); next(); } }}>
    <div className="relative overflow-hidden rounded-[1.6rem] bg-ink text-white shadow-soft">
      <div className="promo-slider__track" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { if (touchStart.current === null) return; const distance = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current; if (Math.abs(distance) > 40) (distance < 0 ? next : previous)(); touchStart.current = null; }} style={{ transform: `translateX(-${current * 100}%)` }}>{slides.map((slide, index) => <Link key={slide.id} href={slide.ctaHref as never} className="promo-slider__slide block" tabIndex={index === current ? 0 : -1} aria-hidden={index !== current} aria-label={`Buka promosi ${slide.storeName ?? slide.title}`}>
        <div className="promo-slider__orb promo-slider__orb--one" /><div className="promo-slider__orb promo-slider__orb--two" />
        {slide.bannerUrl && <img src={slide.bannerUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} className="absolute inset-0 h-full w-full object-cover opacity-35" />}<div className="relative max-w-xl"><span className="text-[10px] font-bold uppercase tracking-[.2em] text-mint">{slide.badge ?? "Promosi penjual"}</span><h2 className="display mt-3 text-2xl font-bold leading-tight sm:text-4xl">{slide.storeName ?? slide.title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-white/65 sm:text-base">{slide.storeName ? `${slide.title} · ${slide.subtitle}` : slide.subtitle}</p><span className="mt-5 inline-flex rounded-full bg-coral px-4 py-2.5 text-xs font-bold transition sm:text-sm">{slide.ctaLabel} <span className="ml-2">→</span></span></div>
      </Link>)}</div>
      {slides.length > 1 && <><button type="button" aria-label="Promosi sebelumnya" onClick={previous} className="absolute right-14 top-3 min-h-0 min-w-0 rounded-full bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20">←</button><button type="button" aria-label="Promosi berikutnya" onClick={next} className="absolute right-3 top-3 min-h-0 min-w-0 rounded-full bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20">→</button><button type="button" aria-label={manualPaused ? "Lanjutkan pergeseran promosi" : "Jeda pergeseran promosi"} aria-pressed={manualPaused} onClick={() => setManualPaused((value) => !value)} className="absolute bottom-3 left-3 min-h-0 min-w-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">{manualPaused ? "Putar" : "Jeda"}</button><div className="absolute bottom-5 right-5 flex gap-1.5">{slides.map((slide, index) => <button key={slide.id} type="button" aria-label={`Buka slide ${index + 1}`} aria-current={current === index} onClick={() => setCurrent(index)} className={`min-h-0 min-w-0 rounded-full transition-all ${current === index ? "h-1.5 w-6 bg-coral" : "h-1.5 w-1.5 bg-white/40"}`} />)}</div></>}
    </div>
  </section>;
}
