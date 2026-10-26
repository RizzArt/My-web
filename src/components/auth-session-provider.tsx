"use client";

import { useEffect } from "react";
import type { Session } from "next-auth";
import { getSession, SessionProvider } from "next-auth/react";

export function AuthSessionProvider({ session, children }: { session: Session | null; children: React.ReactNode }) {
  const authenticated = Boolean(session);

  useEffect(() => {
    if (!authenticated) return;
    void getSession({ broadcast: false });
  }, [authenticated]);

  return <SessionProvider session={session} refetchInterval={15 * 60} refetchOnWindowFocus refetchWhenOffline={false}>{children}</SessionProvider>;
}
