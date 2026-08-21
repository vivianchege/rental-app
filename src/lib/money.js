const MINOR_UNIT_FACTOR = 100;

export function toMinorUnits(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Amount must be a valid non-negative number.');
  }
  return Math.round(amount * MINOR_UNIT_FACTOR);
}

export function fromMinorUnits(value) {
  return Number(value || 0) / MINOR_UNIT_FACTOR;
}

export function parseMoney(value, { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || (!allowZero && amount <= 0) || (allowZero && amount < 0)) {
    throw new Error(allowZero ? 'Amount cannot be negative.' : 'Amount must be greater than zero.');
  }
  return fromMinorUnits(toMinorUnits(amount));
}

export function allocatePayment(amount, type, rentBalance, waterBalance) {
  const amountMinor = toMinorUnits(amount);
  const rentMinor = toMinorUnits(Math.max(0, Number(rentBalance || 0)));
  const waterMinor = toMinorUnits(Math.max(0, Number(waterBalance || 0)));

  let appliedRentMinor = 0;
  let appliedWaterMinor = 0;

  if (type === 'RENT') {
    appliedRentMinor = Math.min(amountMinor, rentMinor);
  } else if (type === 'WATER') {
    appliedWaterMinor = Math.min(amountMinor, waterMinor);
  } else if (type === 'COMBINED') {
    appliedRentMinor = Math.min(amountMinor, rentMinor);
    appliedWaterMinor = Math.min(amountMinor - appliedRentMinor, waterMinor);
  } else {
    throw new Error('Select a valid payment type.');
  }

  return {
    appliedRent: fromMinorUnits(appliedRentMinor),
    appliedWater: fromMinorUnits(appliedWaterMinor),
    excessAmount: fromMinorUnits(amountMinor - appliedRentMinor - appliedWaterMinor),
  };
}
