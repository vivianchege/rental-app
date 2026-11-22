import test from 'node:test';
import assert from 'node:assert/strict';
import { probeInternetAccess } from '../src/lib/connectivity.js';

test('internet probe succeeds when the Firebase endpoint responds', async () => {
  const result = await probeInternetAccess({
    apiKey: 'public-key',
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(result, true);
});

test('internet probe fails when the endpoint cannot be reached', async () => {
  const result = await probeInternetAccess({
    apiKey: 'public-key',
    fetchImpl: async () => { throw new TypeError('offline'); },
  });
  assert.equal(result, false);
});
