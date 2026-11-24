const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || 'https://fxxfhowztjlzvisurxga.supabase.co').replace(/\/+$/, '');

export async function callRentalFunction(name, payload, user) {
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('Sign in again to continue.');
  }

  const token = await user.getIdToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let result = {};
  try {
    result = await response.json();
  } catch {
    // Keep transport failures useful without showing HTML or proxy details.
  }

  if (!response.ok) {
    const error = new Error(
      typeof result?.message === 'string' && result.message.trim()
        ? result.message
        : `The rental service could not complete the request (HTTP ${response.status}).`,
    );
    error.code = typeof result?.code === 'string' ? result.code : 'backend-error';
    error.status = response.status;
    throw error;
  }

  return result;
}
