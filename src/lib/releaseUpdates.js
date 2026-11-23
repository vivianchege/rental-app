const LATEST_RELEASE_URL =
  'https://api.github.com/repos/vivianchege/rental-app/releases/latest';
const REPOSITORY_PATH = ['vivianchege', 'rental-app'];
const MAX_TIMEOUT_MS = 2_147_483_647;
const VERSION_RE =
  /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseVersion(value) {
  if (typeof value !== 'string') throw new TypeError('Version must be a string.');
  const match = VERSION_RE.exec(value.trim());
  if (!match) throw new TypeError(`Invalid semantic version: ${value}`);

  const [, major, minor, patch = '0', prerelease = '', build = ''] = match;
  const prereleaseIds = prerelease ? prerelease.split('.') : [];
  if (prereleaseIds.some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) {
    throw new TypeError(`Invalid semantic version: ${value}`);
  }
  return {
    major,
    minor,
    patch,
    prereleaseIds,
    normalized: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}${build ? `+${build}` : ''}`,
  };
}

function compareNumeric(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrereleaseId(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumeric(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Compare SemVer values; returns -1, 0, or 1. Build metadata is ignored. */
export function compareSemanticVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  for (const key of ['major', 'minor', 'patch']) {
    const result = compareNumeric(left[key], right[key]);
    if (result) return result;
  }

  const a = left.prereleaseIds;
  const b = right.prereleaseIds;
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const result = comparePrereleaseId(a[i], b[i]);
    if (result) return result;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Removes a leading v and pads Android's two-part versionName with patch zero. */
export function normalizeSemanticVersion(version) {
  return parseVersion(version).normalized;
}

function parseInstalledVersion(value) {
  // Gradle uses -legacy as an APK flavor suffix for the same app release.
  if (typeof value === 'string') {
    const legacy = /^(v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)-legacy$/.exec(value.trim());
    if (legacy) return parseVersion(legacy[1]);
  }
  return parseVersion(value);
}

export function normalizeInstalledVersion(value) {
  return parseInstalledVersion(value).normalized;
}

export class ReleaseUpdateError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ReleaseUpdateError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function failure(code, message, cause) {
  return new ReleaseUpdateError(code, message, cause);
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup() {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

function isTimeout(error, signal) {
  return signal.aborted || error?.name === 'TimeoutError';
}

function githubUrl(value, path, errorCode, label) {
  let url;
  let segments;
  try {
    url = new URL(value);
    segments = url.pathname.split('/').map(decodeURIComponent);
  } catch (cause) {
    throw failure(errorCode, `The release ${label} URL is malformed.`, cause);
  }
  if (
    url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password ||
    url.port || url.search || url.hash || segments.length !== path.length + 1 || segments[0] !== '' ||
    path.some((part, index) => segments[index + 1] !== part)
  ) {
    throw failure(errorCode, `The release ${label} URL is not a valid GitHub URL.`);
  }
  return url.href;
}

function selectApk(assets, version, tag, androidApiLevel) {
  const platform = androidApiLevel >= 29 ? '10-plus' : '7-to-9';
  const pattern = new RegExp(`^Ruiru-Rentals-(.+)-Android-${platform}\\.apk$`);
  const candidates = [];

  for (const asset of assets) {
    const match = typeof asset?.name === 'string' && pattern.exec(asset.name);
    if (!match) continue;
    let assetVersion;
    try {
      assetVersion = parseVersion(match[1]);
    } catch (cause) {
      throw failure('INVALID_APK_ASSET', `Invalid version in APK asset name: ${asset.name}`, cause);
    }
    if (compareSemanticVersions(assetVersion.normalized, version.normalized) !== 0) {
      throw failure('INVALID_APK_ASSET', `APK asset version does not match release tag: ${asset.name}`);
    }
    candidates.push(asset);
  }

  if (!candidates.length) throw failure('MISSING_APK_ASSET', `No ${platform} APK matches ${version.normalized}.`);
  if (candidates.length !== 1) throw failure('INVALID_APK_ASSET', `Duplicate ${platform} APK assets.`);
  return githubUrl(
    candidates[0].browser_download_url,
    [...REPOSITORY_PATH, 'releases', 'download', tag, candidates[0].name],
    'INVALID_APK_ASSET',
    'APK download',
  );
}

function releaseNoteLines(body) {
  if (typeof body !== 'string') return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => line.slice(0, 220));
}

/** Fetch latest release info and return a platform-specific APK only if newer. */
export async function checkForAppUpdate({
  currentVersion,
  androidApiLevel,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const current = parseInstalledVersion(currentVersion);
  if (!Number.isInteger(androidApiLevel) || androidApiLevel < 1) {
    throw new TypeError('androidApiLevel must be a positive integer.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a fetch function.');

  const timeout = timeoutSignal(timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(LATEST_RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: timeout.signal,
      });
    } catch (cause) {
      if (isTimeout(cause, timeout.signal)) throw failure('TIMEOUT', 'GitHub update check timed out.', cause);
      throw failure('NETWORK_ERROR', 'Unable to reach GitHub for updates.', cause);
    }

    if (typeof response?.ok !== 'boolean') throw failure('INVALID_RESPONSE', 'GitHub returned an invalid response.');
    if (!response.ok) throw failure('HTTP_ERROR', `GitHub returned HTTP ${response.status ?? 'error'}.`);
    if (typeof response.json !== 'function') throw failure('INVALID_RESPONSE', 'GitHub response has no JSON body.');

    let release;
    try {
      release = await response.json();
    } catch (cause) {
      if (isTimeout(cause, timeout.signal)) throw failure('TIMEOUT', 'GitHub update check timed out.', cause);
      throw failure('INVALID_JSON', 'GitHub returned malformed release JSON.', cause);
    }
    if (!release || typeof release !== 'object' || Array.isArray(release)) {
      throw failure('INVALID_RESPONSE', 'GitHub release data must be an object.');
    }

    let latest;
    try {
      latest = parseVersion(release.tag_name);
    } catch (cause) {
      throw failure('INVALID_TAG', 'GitHub release has an invalid semantic version tag.', cause);
    }
    const releaseUrl = githubUrl(
      release.html_url,
      [...REPOSITORY_PATH, 'releases', 'tag', release.tag_name],
      'INVALID_RELEASE_URL',
      'page',
    );
    const versionComparison = compareSemanticVersions(latest.normalized, current.normalized);
    const updateAvailable = versionComparison > 0;
    let apkDownloadUrl = null;
    if (updateAvailable) {
      if (!Array.isArray(release.assets)) throw failure('INVALID_ASSETS', 'GitHub release assets must be an array.');
      apkDownloadUrl = selectApk(release.assets, latest, release.tag_name, androidApiLevel);
    }

    return {
      currentVersion: current.normalized,
      latestVersion: latest.normalized,
      updateAvailable,
      installedNewerThanLatest: versionComparison < 0,
      releaseUrl,
      apkDownloadUrl,
      androidApiLevel,
      releaseNotes: releaseNoteLines(release.body),
    };
  } finally {
    timeout.cleanup();
  }
}
