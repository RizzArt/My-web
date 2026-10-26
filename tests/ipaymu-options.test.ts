import { describe, expect, it } from "vitest";
import { parseVaBanks } from "../src/lib/payments/ipaymu-options";

const channel = {
  Code: "bni", Name: "BNI", FeatureStatus: "active", HealthStatus: "online",
  TransactionFee: { ActualFee: 3500, ActualFeeType: "FLAT", AdditionalFee: 0 },
};

describe("iPaymu VA banks", () => {
  it("uses fees from the account response", () => {
    expect(parseVaBanks([{ Code: "va", Channels: [channel] }]))
      .toEqual([{ code: "bni", name: "BNI", fee: 3500 }]);
  });
  it("excludes inactive and offline banks", () => {
    expect(parseVaBanks([{ Code: "va", Channels: [
      { ...channel, FeatureStatus: "inactive" },
      { ...channel, HealthStatus: "offline" },
    ] }])).toEqual([]);
  });
  it("rejects unsupported or invalid fee calculations", () => {
    expect(parseVaBanks([{ Code: "va", Channels: [
      { ...channel, TransactionFee: { ActualFee: -1, ActualFeeType: "FLAT" } },
      { ...channel, TransactionFee: { ActualFee: 1, ActualFeeType: "PERCENT" } },
    ] }])).toEqual([]);
  });
  it("includes a separately declared additional fee", () => {
    expect(parseVaBanks([{ Code: "va", Channels: [{
      ...channel,
      TransactionFee: { ActualFee: 3500, ActualFeeType: "FLAT", AdditionalFee: 500 },
    }] }])[0].fee).toBe(4000);
  });
});
