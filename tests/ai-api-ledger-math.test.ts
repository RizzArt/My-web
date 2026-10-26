import { describe, expect, it } from "vitest";
import { finalizeReservation, releaseReservation, reserveBalance } from "@/lib/ai-api/ledger-math";

describe("AI API reserve-finalize-release invariants", () => {
  it("moves available funds into reserved funds without changing total liability", () => {
    expect(reserveBalance({ availableMicros: 100n, reservedMicros: 20n }, 30n)).toEqual({
      availableMicros: 70n,
      reservedMicros: 50n,
      availableDeltaMicros: -30n,
      reservedDeltaMicros: 30n,
    });
  });

  it("finalizes actual usage and releases only the unused reservation", () => {
    expect(finalizeReservation({ availableMicros: 70n, reservedMicros: 50n }, 30n, 18n)).toEqual({
      availableMicros: 82n,
      reservedMicros: 20n,
      availableDeltaMicros: 12n,
      reservedDeltaMicros: -30n,
    });
  });

  it("releases the exact unused reservation for the observed MiniMax prompt overhead", () => {
    expect(finalizeReservation(
      { availableMicros: 978_012_500n, reservedMicros: 21_987_500n },
      21_987_500n,
      5_512_500n,
    )).toEqual({
      availableMicros: 994_487_500n,
      reservedMicros: 0n,
      availableDeltaMicros: 16_475_000n,
      reservedDeltaMicros: -21_987_500n,
    });
  });

  it("releases a definitely-unbilled reservation in full", () => {
    expect(releaseReservation({ availableMicros: 70n, reservedMicros: 50n }, 30n)).toEqual({
      availableMicros: 100n,
      reservedMicros: 20n,
      availableDeltaMicros: 30n,
      reservedDeltaMicros: -30n,
    });
  });

  it("fails closed on insufficient, excessive, or negative values", () => {
    expect(() => reserveBalance({ availableMicros: 10n, reservedMicros: 0n }, 11n)).toThrow("Saldo API");
    expect(() => finalizeReservation({ availableMicros: 0n, reservedMicros: 10n }, 10n, 11n)).toThrow("reservasi");
    expect(() => releaseReservation({ availableMicros: 0n, reservedMicros: 9n }, 10n)).toThrow("reserved");
    expect(() => reserveBalance({ availableMicros: 10n, reservedMicros: 0n }, -1n)).toThrow();
  });
});
