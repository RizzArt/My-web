import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sensitiveJsonHeaders } from "@/lib/security/same-origin";
import { requireActiveAdmin } from "@/lib/active-admin";

export const dynamic = "force-dynamic";

type LegacyCountRow = { count: bigint };
type LegacyRequestRow = { id: string; createdAt: Date; updatedAt: Date; modelPublicId: string };
type LegacyConstraintRow = { convalidated: boolean; contype: string; definition: string };
const EXPECTED_LEGACY_CONSTRAINT = `CHECK status <> 'COMPLETED'::"AiApiRequestStatus" OR "providerRequestId" IS NOT NULL`;
const normalizeConstraint = (value: string) => value.replace(/[()]/g, "").replace(/\s+/g, " ").trim();

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: sensitiveJsonHeaders });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!await requireActiveAdmin(session.user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  const [users, requests, legacyCountRows, legacyRequests, legacyConstraint] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, role: { in: ["CUSTOMER", "ADMIN"] } }, select: { id: true, email: true, name: true, role: true, aiApiWallet: { select: { availableMicros: true, reservedMicros: true, isFrozen: true, keys: { where: { status: "ACTIVE" }, select: { id: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.aiApiRequest.count({ where: { status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } } }),
    prisma.$queryRaw<LegacyCountRow[]>`SELECT COUNT(*)::bigint AS count FROM "AiApiRequest" AS request WHERE request."status" = 'COMPLETED' AND request."providerRequestId" IS NULL`,
    prisma.$queryRaw<LegacyRequestRow[]>`SELECT request."id", request."createdAt", request."updatedAt", model."publicId" AS "modelPublicId" FROM "AiApiRequest" AS request JOIN "AiApiModel" AS model ON model."id" = request."modelId" WHERE request."status" = 'COMPLETED' AND request."providerRequestId" IS NULL ORDER BY request."createdAt" ASC, request."id" ASC LIMIT 20`,
    prisma.$queryRaw<LegacyConstraintRow[]>`SELECT convalidated, contype, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'AiApiRequest_completed_provider_identity' AND conrelid = '"AiApiRequest"'::regclass AND contype = 'c' LIMIT 1`,
  ]);
  const legacyCount = Number(legacyCountRows[0]?.count ?? BigInt(0));
  const constraint = legacyConstraint[0];
  const constraintValidated = constraint?.contype === "c" && normalizeConstraint(constraint.definition) === EXPECTED_LEGACY_CONSTRAINT ? constraint.convalidated : null;
  return NextResponse.json({ currentUserId: session.user.id, users: users.map((user) => ({ id: user.id, email: user.email, name: user.name, role: user.role, wallet: user.aiApiWallet ? { availableMicros: user.aiApiWallet.availableMicros.toString(), reservedMicros: user.aiApiWallet.reservedMicros.toString(), isFrozen: user.aiApiWallet.isFrozen, activeKeyCount: user.aiApiWallet.keys.length } : null })), unresolvedRequestCount: requests, legacyIntegrity: { completedWithoutProviderIdentityCount: legacyCount, constraintValidated, requests: legacyRequests.map((request) => ({ id: request.id, createdAt: request.createdAt, updatedAt: request.updatedAt, model: request.modelPublicId })) } }, { headers: sensitiveJsonHeaders });
}
