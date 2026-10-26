type Balance = { availableMicros: bigint; reservedMicros: bigint };
type Mutation = Balance & { availableDeltaMicros: bigint; reservedDeltaMicros: bigint };
const ZERO = BigInt(0);

function assertState(state: Balance) {
  if (state.availableMicros < ZERO || state.reservedMicros < ZERO) throw new Error("Saldo API tidak valid.");
}
function assertPositive(value: bigint) {
  if (value <= ZERO) throw new Error("Nilai harus positif.");
}

export function reserveBalance(state: Balance, amount: bigint): Mutation {
  assertState(state);
  assertPositive(amount);
  if (state.availableMicros < amount) throw new Error("Saldo API tidak mencukupi.");
  return { availableMicros: state.availableMicros - amount, reservedMicros: state.reservedMicros + amount, availableDeltaMicros: -amount, reservedDeltaMicros: amount };
}

export function finalizeReservation(state: Balance, reservedAmount: bigint, finalCharge: bigint): Mutation {
  assertState(state);
  assertPositive(reservedAmount);
  if (finalCharge < ZERO || finalCharge > reservedAmount) throw new Error("Biaya final melampaui reservasi.");
  if (state.reservedMicros < reservedAmount) throw new Error("Saldo reserved tidak konsisten.");
  const release = reservedAmount - finalCharge;
  return { availableMicros: state.availableMicros + release, reservedMicros: state.reservedMicros - reservedAmount, availableDeltaMicros: release, reservedDeltaMicros: -reservedAmount };
}

export function releaseReservation(state: Balance, reservedAmount: bigint): Mutation {
  assertState(state);
  assertPositive(reservedAmount);
  if (state.reservedMicros < reservedAmount) throw new Error("Saldo reserved tidak konsisten.");
  return { availableMicros: state.availableMicros + reservedAmount, reservedMicros: state.reservedMicros - reservedAmount, availableDeltaMicros: reservedAmount, reservedDeltaMicros: -reservedAmount };
}
