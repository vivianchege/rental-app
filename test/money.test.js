import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePayment, parseMoney, toMinorUnits } from '../src/lib/money.js';

test('allocates partial rent payments without changing the source balance', () => {
  const result = allocatePayment(8000, 'RENT', 20000, 0);
  assert.deepEqual(result, { appliedRent: 8000, appliedWater: 0, excessAmount: 0 });
});

test('allocates combined payments to rent, then water, then credit', () => {
  const result = allocatePayment(30000, 'COMBINED', 20000, 5000);
  assert.deepEqual(result, { appliedRent: 20000, appliedWater: 5000, excessAmount: 5000 });
});

test('uses minor units for decimal-safe arithmetic', () => {
  assert.equal(toMinorUnits('10.25'), 1025);
  assert.equal(parseMoney('0', { allowZero: true }), 0);
  assert.throws(() => parseMoney('-1'), /greater than zero/);
});
