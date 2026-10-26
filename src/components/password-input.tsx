"use client";

import { useState } from "react";

type PasswordInputProps = { id: string; name: string; autoComplete: "current-password" | "new-password"; label: string };

export function PasswordInput({ id, name, autoComplete, label }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}<span className="relative mt-2 block"><input id={id} name={name} type={visible ? "text" : "password"} required autoComplete={autoComplete} minLength={8} className="h-12 w-full rounded-xl border border-ink/15 bg-white px-4 pr-14 outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20" /><button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-xl text-ink/55 transition hover:text-coral focus:outline-none focus:ring-2 focus:ring-inset focus:ring-coral"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{visible ? <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 4.3A10.8 10.8 0 0 1 12 4c5.2 0 8.7 4 10 8a12.5 12.5 0 0 1-3.1 5.1M6.1 6.1A12.7 12.7 0 0 0 2 12c1.3 4 4.8 8 10 8 1.5 0 2.8-.3 4-.9" /></> : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>}</svg></button></span></label>;
}
