import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetPasswordLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><script dangerouslySetInnerHTML={{ __html: "(function(){var h=window.location.hash;if(h){var t=new URLSearchParams(h.slice(1)).get('token');if(t){window.__riezz99ResetToken=t;}window.history.replaceState(null,'',window.location.pathname);}})();" }} />{children}</>;
}
