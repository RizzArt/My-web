import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  committed: false,
  admins: [{ id: "admin-one" }, { id: "admin-two" }],
  notifications: new Map<string, Record<string, unknown>>(),
  jobs: new Map<string, Record<string, unknown>>(),
  findAdmins: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      const result = await operation({
        user: { findMany: state.findAdmins },
        notification: {
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            for (const row of data) {
              if (!state.notifications.has(String(row.id))) {
                state.notifications.set(String(row.id), {
                  ...row, createdAt: new Date(), isRead: false, conversationId: null,
                });
              }
            }
          },
          findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.map((id) => state.notifications.get(id)),
        },
        pushJob: {
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            for (const row of data) {
              if (!state.jobs.has(String(row.dedupeKey))) {
                state.jobs.set(String(row.dedupeKey), row);
              }
            }
          },
        },
      });
      state.committed = true;
      return result;
    },
  },
}));
vi.mock("@/lib/realtime/publish", () => ({
  publishNotification: state.publish,
}));

import { adminNotifiedTransaction } from "@/lib/admin-notifications";

const event = {
  eventKey: "seller-application:application-one",
  title: "Pengajuan Seller Baru",
  message: "Pengajuan menunggu review.",
  link: "/admin/sellers",
};

beforeEach(() => {
  state.committed = false;
  state.admins = [{ id: "admin-one" }, { id: "admin-two" }];
  state.notifications.clear();
  state.jobs.clear();
  state.findAdmins.mockReset();
  state.findAdmins.mockImplementation(async () => state.admins);
  state.publish.mockReset();
  state.publish.mockImplementation(async () => {
    expect(state.committed).toBe(true);
  });
});

describe("Admin activity notifications", () => {
  it("notifies active admins and publishes only after commit", async () => {
    const result = await adminNotifiedTransaction(
      async () => ({ id: "application-one" }), () => event
    );
    expect(result.id).toBe("application-one");
    expect(state.findAdmins).toHaveBeenCalledWith({
      where: { role: "ADMIN", isActive: true }, select: { id: true },
    });
    expect(state.notifications.size).toBe(2);
    expect(state.jobs.size).toBe(2);
    expect(state.publish).toHaveBeenCalledTimes(2);
  });

  it("does not notify when the business operation fails", async () => {
    await expect(adminNotifiedTransaction(
      async () => { throw new Error("Pengajuan ditolak"); }, () => event
    )).rejects.toThrow("Pengajuan ditolak");
    expect(state.findAdmins).not.toHaveBeenCalled();
    expect(state.notifications.size).toBe(0);
    expect(state.jobs.size).toBe(0);
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("repeated events preserve one inbox entry and push job per admin", async () => {
    await adminNotifiedTransaction(async () => null, () => event);
    await adminNotifiedTransaction(async () => null, () => event);
    expect(state.notifications.size).toBe(2);
    expect(state.jobs.size).toBe(2);
    for (const notification of state.notifications.values()) {
      expect(notification.isRead).toBe(false);
      expect(state.jobs.has(`notification:${notification.id}`)).toBe(true);
    }
  });

  it("skips admin delivery for an operation with no admin event", async () => {
    await adminNotifiedTransaction(async () => "ok", () => null);
    expect(state.findAdmins).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
  });
});
