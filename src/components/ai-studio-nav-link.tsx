import Link from "next/link";
import type { MouseEventHandler } from "react";

type AiStudioNavLinkProps = {
  active?: boolean;
  mobile?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export function AiStudioNavLink({ active = false, mobile = false, onClick }: AiStudioNavLinkProps) {
  return <Link
    href="/studio"
    aria-label="Buka AI Studio"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
    className={`ai-studio-nav ${mobile ? "ai-studio-nav--mobile" : "ai-studio-nav--desktop"} ${active ? "ai-studio-nav--active" : ""}`}
  >
    <span className="ai-studio-nav__icon" aria-hidden="true">AI</span>
    <span className="ai-studio-nav__label"><span className="ai-studio-nav__ai">AI</span> Studio</span>
    <span className="ai-studio-nav__chevron" aria-hidden="true">›</span>
  </Link>;
}
