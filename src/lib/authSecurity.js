const LOGIN_LOCKOUT_STEPS_MS = [
  30_000,
  60_000,
  180_000,
  300_000,
  900_000,
  1_800_000,
  3_600_000,
  18_000_000,
];

export const APP_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const getCurrentTimestamp = () => Date.now();

export const getNextPasswordFailure = (failedAttempts, now = Date.now()) => {
  const nextFailures = Math.max(0, Number(failedAttempts) || 0) + 1;
  const lockoutIndex = nextFailures - 5;
  const lockoutDuration = lockoutIndex < 0
    ? 0
    : LOGIN_LOCKOUT_STEPS_MS[Math.min(lockoutIndex, LOGIN_LOCKOUT_STEPS_MS.length - 1)];

  return {
    failedAttempts: nextFailures,
    lockedUntil: lockoutDuration ? now + lockoutDuration : 0,
  };
};

export const getRemainingLockoutSeconds = (lockedUntil, now = Date.now()) => (
  Math.max(0, Math.ceil((Number(lockedUntil) - now) / 1000))
);

export const formatLockoutDuration = (seconds) => {
  const remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (remaining >= 3600) {
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (remaining >= 60) {
    const minutes = Math.floor(remaining / 60);
    const extraSeconds = remaining % 60;
    return extraSeconds ? `${minutes}m ${extraSeconds}s` : `${minutes}m`;
  }
  return `${remaining}s`;
};
