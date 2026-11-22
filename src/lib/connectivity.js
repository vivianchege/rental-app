const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Checks reachability of Firebase's public project configuration endpoint.
 * A response from Google is enough to establish internet access; this probe
 * never sends account credentials or reads any rental data.
 */
export async function probeInternetAccess({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal: parentSignal,
} = {}) {
  if (globalThis.navigator?.onLine === false || typeof fetchImpl !== 'function') return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    const endpoint = apiKey
      ? `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`
      : 'https://www.gstatic.com/generate_204';
    await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      mode: apiKey ? 'cors' : 'no-cors',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
