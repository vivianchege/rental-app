import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_IDLE_TIMEOUT_MS,
  formatLockoutDuration,
  getNextPasswordFailure,
  getRemainingLockoutSeconds,
} from '../src/lib/authSecurity.js';

test('requires five wrong passwords before starting a lockout', () => {
  for (let failures = 0; failures < 4; failures += 1) {
    assert.deepEqual(getNextPasswordFailure(failures, 1000), {
      failedAttempts: failures + 1,
      lockedUntil: 0,
    });
  }
  assert.deepEqual(getNextPasswordFailure(4, 1000), {
    failedAttempts: 5,
    lockedUntil: 31_000,
  });
});

test('increases lockout delays and caps repeated delays at five hours', () => {
  const expectedDelays = [30, 60, 180, 300, 900, 1800, 3600, 18_000, 18_000];
  let failures = 4;
  for (const seconds of expectedDelays) {
    const next = getNextPasswordFailure(failures, 0);
    assert.equal(next.lockedUntil, seconds * 1000);
    failures = next.failedAttempts;
  }
});

test('reports remaining lockout time and the fifteen-minute app idle window', () => {
  assert.equal(getRemainingLockoutSeconds(30_500, 1000), 30);
  assert.equal(getRemainingLockoutSeconds(1000, 1000), 0);
  assert.equal(formatLockoutDuration(3661), '1h 1m');
  assert.equal(formatLockoutDuration(90), '1m 30s');
  assert.equal(APP_IDLE_TIMEOUT_MS, 900_000);
});
