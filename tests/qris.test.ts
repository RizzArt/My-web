import { describe, expect, it, afterEach } from "vitest";
import { createDynamicQris, crc16Ccitt, parseQrisTlv, validateQrisPayload } from "@/lib/payments/qris";
import { customerPaymentsAvailable } from "@/lib/payments/provider";

function payloadWithoutCrc(body: string) { const withCrc = `${body}6304`; return withCrc + crc16Ccitt(withCrc); }
const staticQris = payloadWithoutCrc("0002010102115802ID5913Riezz99 Store");

describe("QRIS static to dynamic", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => { delete process.env.QRIS_STATIC_PAYLOAD; delete process.env.PAYMENT_PROVIDER; process.env.NODE_ENV = originalNodeEnv; });

  it("accepts a valid static QRIS payload", () => { expect(validateQrisPayload(staticQris).find((item) => item.tag === "01")?.value).toBe("11"); });
  it("rejects an invalid CRC", () => { expect(() => validateQrisPayload(`${staticQris.slice(0, -1)}0`)).toThrow("CRC"); });
  it("rejects malformed TLV boundaries", () => { expect(() => parseQrisTlv("0002010102")).toThrow(); });
  it("changes static POI 010211 to dynamic 010212", () => { expect(createDynamicQris(staticQris, 15000)).toContain("010212"); });
  it("creates one exact amount tag", () => { const result = createDynamicQris(staticQris, 15000); expect(result).toContain("540515000"); expect(result.match(/54\d{2}/g)).toHaveLength(1); });
  it("changes the QRIS amount with the canonical order total", () => { expect(createDynamicQris(staticQris, 15000)).toContain("540515000"); expect(createDynamicQris(staticQris, 27500)).toContain("540527500"); });
  it("replaces an existing amount tag", () => { const source = payloadWithoutCrc("000201010211540410005802ID5913Riezz99 Store"); const result = createDynamicQris(source, 15000); expect(result.match(/54\d{2}/g)).toHaveLength(1); expect(result).toContain("540515000"); expect(result).not.toContain("54041000"); });
  it("recalculates a deterministic CRC", () => { const result = createDynamicQris(staticQris, 15000); expect(result.slice(-4)).toBe(crc16Ccitt(`${result.slice(0, -4)}`)); expect(result.slice(-4)).toMatch(/^[0-9A-F]{4}$/); });
  it("matches the CRC16/CCITT-FALSE known vector", () => { expect(crc16Ccitt("123456789")).toBe("29B1"); });
  it("produces output accepted by the validator", () => { expect(() => validateQrisPayload(createDynamicQris(staticQris, 15000))).not.toThrow(); });
  it("does not enable QRIS when the server payload is missing", () => { process.env.NODE_ENV = "production"; process.env.PAYMENT_PROVIDER = "qris_manual"; expect(customerPaymentsAvailable()).toBe(false); });
});
