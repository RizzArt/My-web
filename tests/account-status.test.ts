import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { JWT } from "next-auth/jwt";

const db = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: db.findUnique } } }));
import { changeAccountStatus, refreshActiveToken } from "@/lib/account-status";

beforeEach(() => vi.resetAllMocks());

function transaction(role = "CUSTOMER", isActive = true) {
  const findUnique = vi.fn()
    .mockResolvedValueOnce({ role: "ADMIN", isActive: true })
    .mockResolvedValueOnce({ id: "target", role, isActive });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const create = vi.fn().mockResolvedValue({});
  return {
    tx: { user: { findUnique, updateMany }, auditLog: { create } } as unknown as Prisma.TransactionClient,
    findUnique, updateMany, create,
  };
}
const token = { id: "target", role: "CUSTOMER" } as JWT;

describe("account bans", () => {
  it.each(["CUSTOMER", "SELLER"])("rejects an existing token for banned %s", async (role) => {
    db.findUnique.mockResolvedValue({ role, isActive: false });
    expect(await refreshActiveToken({ ...token, role: role as JWT["role"] })).toBeNull();
  });
  it("rejects deleted accounts", async () => {
    db.findUnique.mockResolvedValue(null);
    expect(await refreshActiveToken(token)).toBeNull();
  });
  it("keeps active users and refreshes their role", async () => {
    db.findUnique.mockResolvedValue({ role: "SELLER", isActive: true });
    expect(await refreshActiveToken(token)).toMatchObject({ id: "target", role: "SELLER", active: true });
  });
  it.each(["CUSTOMER", "SELLER"])("bans %s and audits the reason", async (role) => {
    const t = transaction(role);
    await changeAccountStatus(t.tx, "admin", "target", false, "Spam");
    expect(t.updateMany.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(t.create.mock.calls[0][0].data).toMatchObject({
      action: "ACCOUNT_BANNED", actorId: "admin", entityId: "target",
      metadata: { reason: "Spam", previousIsActive: true, isActive: false },
    });
  });
  it("unbans a buyer", async () => {
    const t = transaction("CUSTOMER", false);
    await changeAccountStatus(t.tx, "admin", "target", true, "");
    expect(t.create.mock.calls[0][0].data.action).toBe("ACCOUNT_UNBANNED");
  });
  it("protects admin accounts", async () => {
    const t = transaction("ADMIN");
    await expect(changeAccountStatus(t.tx, "admin", "target", false, "Spam")).rejects.toThrow("buyer dan seller");
    expect(t.updateMany).not.toHaveBeenCalled();
  });
  it("rechecks the acting admin in the transaction", async () => {
    const t = transaction();
    t.findUnique.mockReset().mockResolvedValue({ role: "ADMIN", isActive: false });
    await expect(changeAccountStatus(t.tx, "admin", "target", false, "Spam")).rejects.toThrow("Akses admin");
    expect(t.updateMany).not.toHaveBeenCalled();
  });
  it("requires a ban reason", async () => {
    const t = transaction();
    await expect(changeAccountStatus(t.tx, "admin", "target", false, "")).rejects.toThrow("Alasan");
    expect(t.updateMany).not.toHaveBeenCalled();
  });
  it("does not duplicate an unchanged status", async () => {
    const t = transaction("CUSTOMER", false);
    expect(await changeAccountStatus(t.tx, "admin", "target", false, "Spam")).toEqual({ changed: false, isActive: false });
    expect(t.create).not.toHaveBeenCalled();
  });
  it("rejects a concurrent status change without adding an audit event", async () => {
    const t = transaction();
    t.updateMany.mockResolvedValue({ count: 0 });
    await expect(changeAccountStatus(t.tx, "admin", "target", false, "Spam")).rejects.toThrow("Status akun berubah");
    expect(t.create).not.toHaveBeenCalled();
  });
});
