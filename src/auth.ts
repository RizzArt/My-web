import NextAuth from "next-auth";
import { CredentialsSignin } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { refreshActiveToken } from "@/lib/account-status";
import { prisma } from "@/lib/prisma";
import { safeInternalRedirect } from "@/lib/auth-redirect";
import { clearRateLimit, consumeRateLimit, isRateLimited, LOGIN_FAILURE_MAX_PER_ACCOUNT, LOGIN_FAILURE_MAX_PER_IP, LOGIN_FAILURE_WINDOW_MS } from "@/lib/security-rate-limit";
import { clientRateLimitIdentity } from "@/lib/trusted-client-ip";
import { verifyAdminMfaLogin } from "@/lib/admin-mfa-service";
import { applyAbsoluteSessionPolicy, initialSessionStartedAt } from "@/lib/session-policy";

const authSecret = process.env.AUTH_SECRET;
if (process.env.NODE_ENV === "production" && !authSecret) throw new Error("AUTH_SECRET wajib dikonfigurasi di production.");
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const providers: Provider[] = [Credentials({
  name: "credentials",
  credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" }, mfaCode: { label: "MFA code", type: "text" } },
  async authorize(credentials, request) {
    const email = String(credentials?.email ?? "").toLowerCase();
    const password = String(credentials?.password ?? "");
    const mfaCode = String(credentials?.mfaCode ?? "").trim();
    if (!email || !password) return null;
    const clientIp = clientRateLimitIdentity(request);
    const accountLimit = { scope: "login-account", identifier: email, limit: LOGIN_FAILURE_MAX_PER_ACCOUNT, windowMs: LOGIN_FAILURE_WINDOW_MS };
    const ipLimit = { scope: "login-ip", identifier: clientIp, limit: LOGIN_FAILURE_MAX_PER_IP, windowMs: LOGIN_FAILURE_WINDOW_MS };
    const [accountRate, ipRate] = await Promise.all([isRateLimited(accountLimit), isRateLimited(ipLimit)]);
    if (!accountRate.allowed || !ipRate.allowed) return null;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      await Promise.all([consumeRateLimit(accountLimit), consumeRateLimit(ipLimit)]);
      return null;
    }
    if (!user.emailVerified) {
      const error = new CredentialsSignin();
      error.code = "email-not-verified";
      throw error;
    }
    if (user.role === "ADMIN") {
      const mfa = await verifyAdminMfaLogin(user.id, mfaCode);
      if (mfa.required && !mfa.verified) {
        await Promise.all([consumeRateLimit(accountLimit), consumeRateLimit(ipLimit)]);
        const error = new CredentialsSignin();
        error.code = mfaCode ? "mfa-invalid" : "mfa-required";
        throw error;
      }
    }
    await clearRateLimit(accountLimit);
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  },
})];

providers.push(Google({
  clientId: process.env.AUTH_GOOGLE_ID ?? "",
  clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
}));

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 60 * 60 },
  secret: authSecret,
  trustHost: true,
  cookies: { sessionToken: { name: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } } },
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const email = user.email?.trim().toLowerCase();
      if (!email || profile?.email_verified !== true) return "/login?error=google-email-unverified";

      let databaseUser = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, adminMfaCredential: { select: { id: true } } } });
      if (databaseUser?.passwordHash) return "/login?error=google-email-exists";
      if (databaseUser && !databaseUser.isActive) return false;
      if (!databaseUser) {
        try {
          databaseUser = await prisma.user.create({ data: { name: user.name, email, passwordHash: null, emailVerified: new Date(), role: "CUSTOMER" }, select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, adminMfaCredential: { select: { id: true } } } });
        } catch (error) {
          if ((error as { code?: string }).code !== "P2002") throw error;
          databaseUser = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, adminMfaCredential: { select: { id: true } } } });
          if (!databaseUser || databaseUser.passwordHash) return "/login?error=google-email-exists";
          if (!databaseUser.isActive) return false;
        }
      }
      if (databaseUser.role === "ADMIN" && databaseUser.adminMfaCredential) return "/login?error=admin-mfa-password-required";
      user.id = databaseUser.id;
      user.name = databaseUser.name ?? user.name;
      user.email = databaseUser.email;
      user.role = databaseUser.role;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.sessionStartedAt = Date.now();
        const current = await prisma.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });
        if (!current) return null;
        token.sessionVersion = current.sessionVersion;
      }
      if (!token.id || token.sessionVersion === undefined) return null;
      token.sessionStartedAt = initialSessionStartedAt(token);
      const activeToken = await refreshActiveToken(token);
      return activeToken ? applyAbsoluteSessionPolicy(activeToken) : null;
    },
    session({ session, token }) { if (session.user && token.id && token.role) { session.user.id = token.id; session.user.role = token.role; } return session; },
    redirect({ url, baseUrl }) { return safeInternalRedirect(url, baseUrl); },
  },
});
