import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const { acceptDueManualDeliveries } = vi.hoisted(() => ({ acceptDueManualDeliveries: vi.fn() }));
vi.mock("@/lib/delivery/service", () => ({ acceptDueManualDeliveries }));

import { POST } from "@/app/api/internal/jobs/auto-accept-manual-deliveries/route";

const service = readFileSync("src/lib/delivery/service.ts", "utf8");
const finance = readFileSync("src/lib/seller-finance.ts", "utf8");
const route = readFileSync("src/app/api/internal/jobs/auto-accept-manual-deliveries/route.ts", "utf8");
const unit = readFileSync("docs/digital-store-auto-accept.service", "utf8");
const timer = readFileSync("docs/digital-store-auto-accept.timer", "utf8");

const originalSecret = process.env.AUTO_ACCEPT_CRON_SECRET;

afterEach(() => {
  acceptDueManualDeliveries.mockReset();
  if (originalSecret === undefined) delete process.env.AUTO_ACCEPT_CRON_SECRET;
  else process.env.AUTO_ACCEPT_CRON_SECRET = originalSecret;
});

function request(secret?: string) {
  return new Request("http://localhost/api/internal/jobs/auto-accept-manual-deliveries", { method: "POST", headers: secret ? { "x-cron-secret": secret } : undefined });
}

describe("internal manual delivery auto-accept job", () => {
  it("fails closed when the secret is missing", async () => {
    delete process.env.AUTO_ACCEPT_CRON_SECRET;
    const response = await POST(request("anything"));
    expect(response.status).toBe(503);
    expect(acceptDueManualDeliveries).not.toHaveBeenCalled();
  });

  it("rejects missing and incorrect secrets", async () => {
    process.env.AUTO_ACCEPT_CRON_SECRET = "correct-secret";
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong-secret"))).status).toBe(401);
    expect(acceptDueManualDeliveries).not.toHaveBeenCalled();
  });

  it("accepts the correct secret and returns only a summary", async () => {
    process.env.AUTO_ACCEPT_CRON_SECRET = "correct-secret";
    acceptDueManualDeliveries.mockResolvedValue({ processed: 2, accepted: 1, skipped: 1, failed: 0 });
    const response = await POST(request("correct-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processed: 2, accepted: 1, skipped: 1, failed: 0 });
    expect(acceptDueManualDeliveries).toHaveBeenCalledOnce();
  });

  it("keeps the endpoint internal and the job canonical", () => {
    expect(route).toContain('runtime = "nodejs"');
    expect(route).toContain('dynamic = "force-dynamic"');
    expect(route).toContain('request.headers.get("x-cron-secret")');
    expect(route).toContain("timingSafeEqual");
    expect(service).toContain("acceptDueManualDeliveries");
    expect(service).toContain('source: "AUTO"');
    expect(service).toContain("completeManualDelivery");
  });

  it("guards eligibility, settlement, notifications, SSE, and races", () => {
    expect(service).toContain('deliveryMode: "MANUAL"');
    expect(service).toContain('status: "AWAITING_CONFIRMATION"');
    expect(service).toContain("sentAt: { not: null }");
    expect(service).toContain("buyerAcceptedAt: null");
    expect(service).toContain("autoAcceptAt: { lte: now }");
    expect(service).toContain('delivery.order.status !== "PAID"');
    expect(service).toContain('delivery.order.payment?.status !== "PAID"');
    expect(service).toContain('status: "DELIVERED"');
    expect(service).toContain("makeManualEarningAvailable");
    expect(finance).toContain('type: "SALE_AVAILABLE"');
    expect(service).toContain('title: "Pesanan selesai otomatis"');
    expect(service).toContain("publishNotification");
    expect(service).toContain('isolationLevel: "Serializable"');
    expect(service).toContain('code === "P2034"');
  });

  it("provides the non-secret hourly systemd templates", () => {
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain("User=harnet");
    expect(unit).toContain("EnvironmentFile=/home/harnet/digital-store/.auto-accept-cron.env");
    expect(unit).toContain("--fail --silent --show-error --max-time 30");
    expect(unit).toContain("x-cron-secret:${AUTO_ACCEPT_CRON_SECRET}");
    expect(unit).not.toContain("AUTO_ACCEPT_CRON_SECRET=");
    expect(timer).toContain("OnCalendar=hourly");
    expect(timer).toContain("Persistent=true");
  });
});
