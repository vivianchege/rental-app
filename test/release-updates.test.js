import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkForAppUpdate,
  compareSemanticVersions,
  normalizeInstalledVersion,
  normalizeSemanticVersion,
  ReleaseUpdateError,
} from '../src/lib/releaseUpdates.js';

const API_URL = 'https://api.github.com/repos/vivianchege/rental-app/releases/latest';

function createRelease({
  tag = 'v1.6.0',
  assets,
  body = '- Updated rent and payment workflows\n- Improved Android compatibility',
  htmlUrl = `https://github.com/vivianchege/rental-app/releases/tag/${tag}`,
} = {}) {
  const releaseAssets = assets ?? [
    {
      name: 'Ruiru-Rentals-1.6.0-Android-10-plus.apk',
      browser_download_url:
        `https://github.com/vivianchege/rental-app/releases/download/${tag}/Ruiru-Rentals-1.6.0-Android-10-plus.apk`,
    },
    {
      name: 'Ruiru-Rentals-1.6.0-Android-7-to-9.apk',
      browser_download_url:
        `https://github.com/vivianchege/rental-app/releases/download/${tag}/Ruiru-Rentals-1.6.0-Android-7-to-9.apk`,
    },
  ];
  return { tag_name: tag, html_url: htmlUrl, assets: releaseAssets, body };
}

function jsonResponse(value, overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    ...overrides,
  };
}

function fetchRelease(release) {
  return async (url) => {
    assert.equal(url, API_URL);
    return jsonResponse(release);
  };
}

test('normalizes leading v and Android two-part versions', () => {
  assert.equal(normalizeSemanticVersion('v1.5'), '1.5.0');
  assert.equal(normalizeSemanticVersion('1.5-legacy'), '1.5.0-legacy');
  assert.equal(normalizeSemanticVersion('v1.6.0-rc.2+build.7'), '1.6.0-rc.2+build.7');
  assert.equal(normalizeInstalledVersion('v1.6.2-legacy'), '1.6.2');
});

test('compares semantic versions including prerelease precedence and build metadata', () => {
  assert.equal(compareSemanticVersions('v1.5', '1.5.0'), 0);
  assert.equal(compareSemanticVersions('1.5.0-alpha.2', '1.5.0-alpha.10'), -1);
  assert.equal(compareSemanticVersions('1.5.0-rc.1', '1.5.0'), -1);
  assert.equal(compareSemanticVersions('1.5.0+one', '1.5.0+two'), 0);
  assert.equal(compareSemanticVersions('1.10.0', '1.9.9'), 1);
  assert.throws(() => compareSemanticVersions('1.05.0', '1.5.0'), /Invalid semantic version/);
  assert.throws(() => compareSemanticVersions('1.5.0-alpha.01', '1.5.0'), /Invalid semantic version/);
});

test('selects modern APK for Android API 29 and newer', async () => {
  const result = await checkForAppUpdate({
    currentVersion: '1.5',
    androidApiLevel: 35,
    fetchImpl: fetchRelease(createRelease()),
  });

  assert.deepEqual(result, {
    currentVersion: '1.5.0',
    latestVersion: '1.6.0',
    updateAvailable: true,
    installedNewerThanLatest: false,
    releaseUrl: 'https://github.com/vivianchege/rental-app/releases/tag/v1.6.0',
    apkDownloadUrl:
      'https://github.com/vivianchege/rental-app/releases/download/v1.6.0/Ruiru-Rentals-1.6.0-Android-10-plus.apk',
    androidApiLevel: 35,
    releaseNotes: ['Updated rent and payment workflows', 'Improved Android compatibility'],
  });
});

test('returns short plain-text release notes for the update dialog', async () => {
  const result = await checkForAppUpdate({
    currentVersion: '1.5.0',
    androidApiLevel: 35,
    fetchImpl: fetchRelease(createRelease({
      body: '# Ruiru Rentals 1.6.0\n\n- **Faster billing** for past months.\n- `Back` closes the current screen.\n\nMore details are in the release page.',
    })),
  });

  assert.deepEqual(result.releaseNotes, [
    'Ruiru Rentals 1.6.0',
    'Faster billing for past months.',
    'Back closes the current screen.',
    'More details are in the release page.',
  ]);
});

test('selects legacy APK for Android API 28 and accepts prerelease asset versions', async () => {
  const tag = 'v1.6.0-beta.2';
  const release = createRelease({
    tag,
    assets: [
      {
        name: 'Ruiru-Rentals-1.6.0-beta.2-Android-7-to-9.apk',
        browser_download_url:
          `https://github.com/vivianchege/rental-app/releases/download/${tag}/Ruiru-Rentals-1.6.0-beta.2-Android-7-to-9.apk`,
      },
    ],
  });

  const result = await checkForAppUpdate({
    currentVersion: '1.5.0',
    androidApiLevel: 28,
    fetchImpl: fetchRelease(release),
  });

  assert.equal(result.latestVersion, '1.6.0-beta.2');
  assert.equal(
    result.apkDownloadUrl,
    `https://github.com/vivianchege/rental-app/releases/download/${tag}/Ruiru-Rentals-1.6.0-beta.2-Android-7-to-9.apk`,
  );
});

test('does not offer a downgrade or same-version update', async () => {
  const release = createRelease({ tag: 'v1.5.0' });
  const result = await checkForAppUpdate({
    currentVersion: '1.6.0',
    androidApiLevel: 29,
    fetchImpl: fetchRelease(release),
  });

  assert.equal(result.latestVersion, '1.5.0');
  assert.equal(result.updateAvailable, false);
  assert.equal(result.installedNewerThanLatest, true);
  assert.equal(result.apkDownloadUrl, null);
});

test('reports the current build as latest without requiring APK assets', async () => {
  const result = await checkForAppUpdate({
    currentVersion: '1.6.1-legacy',
    androidApiLevel: 28,
    fetchImpl: fetchRelease(createRelease({ tag: 'v1.6.1', assets: [] })),
  });

  assert.equal(result.currentVersion, '1.6.1');
  assert.equal(result.latestVersion, '1.6.1');
  assert.equal(result.updateAvailable, false);
  assert.equal(result.installedNewerThanLatest, false);
  assert.equal(result.apkDownloadUrl, null);
});

test('treats the Android legacy flavor label as the same app release', async () => {
  const result = await checkForAppUpdate({
    currentVersion: '1.5-legacy',
    androidApiLevel: 28,
    fetchImpl: fetchRelease(createRelease({ tag: 'v1.5.0', assets: [] })),
  });

  assert.equal(result.currentVersion, '1.5.0');
  assert.equal(result.updateAvailable, false);
  assert.equal(result.apkDownloadUrl, null);
});

test('rejects malformed tags, missing assets, mismatched assets, and untrusted URLs', async (t) => {
  await t.test('malformed tag', async () => {
    const release = createRelease({ tag: 'release-1.6' });
    await assert.rejects(
      checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 30, fetchImpl: fetchRelease(release) }),
      { name: 'ReleaseUpdateError', code: 'INVALID_TAG' },
    );
  });

  await t.test('missing target apk', async () => {
    const release = createRelease({ assets: [] });
    await assert.rejects(
      checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 30, fetchImpl: fetchRelease(release) }),
      { code: 'MISSING_APK_ASSET' },
    );
  });

  await t.test('asset version does not match tag', async () => {
    const release = createRelease({
      assets: [{
        name: 'Ruiru-Rentals-1.4.0-Android-10-plus.apk',
        browser_download_url:
          'https://github.com/vivianchege/rental-app/releases/download/v1.6.0/Ruiru-Rentals-1.4.0-Android-10-plus.apk',
      }],
    });
    await assert.rejects(
      checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 30, fetchImpl: fetchRelease(release) }),
      { code: 'INVALID_APK_ASSET' },
    );
  });

  await t.test('external download URL', async () => {
    const release = createRelease({
      assets: [{
        name: 'Ruiru-Rentals-1.6.0-Android-10-plus.apk',
        browser_download_url: 'https://example.com/app.apk',
      }],
    });
    await assert.rejects(
      checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 30, fetchImpl: fetchRelease(release) }),
      { code: 'INVALID_APK_ASSET' },
    );
  });
});

test('reports HTTP and malformed JSON failures with stable error codes', async (t) => {
  await t.test('non-OK response', async () => {
    await assert.rejects(
      checkForAppUpdate({
        currentVersion: '1.5.0',
        androidApiLevel: 30,
        fetchImpl: async () => ({ ok: false, status: 503 }),
      }),
      { code: 'HTTP_ERROR' },
    );
  });

  await t.test('invalid JSON', async () => {
    await assert.rejects(
      checkForAppUpdate({
        currentVersion: '1.5.0',
        androidApiLevel: 30,
        fetchImpl: async () => jsonResponse(null, { json: async () => { throw new SyntaxError('bad json'); } }),
      }),
      { code: 'INVALID_JSON' },
    );
  });
});

test('passes a timeout AbortSignal and reports timeout failures', async () => {
  let receivedSignal;
  await assert.rejects(
    checkForAppUpdate({
      currentVersion: '1.5.0',
      androidApiLevel: 30,
      timeoutMs: 5,
      fetchImpl: (_url, options) => {
        receivedSignal = options.signal;
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
      },
    }),
    (error) => error instanceof ReleaseUpdateError && error.code === 'TIMEOUT',
  );
  assert.equal(receivedSignal.aborted, true);
});

test('validates app version, Android API level, timeout, and fetch implementation', async () => {
  await assert.rejects(
    checkForAppUpdate({ currentVersion: 'unknown', androidApiLevel: 30, fetchImpl: fetchRelease(createRelease()) }),
    /Invalid semantic version/,
  );
  await assert.rejects(
    checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 0, fetchImpl: fetchRelease(createRelease()) }),
    /androidApiLevel/,
  );
  await assert.rejects(
    checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 30, timeoutMs: 0, fetchImpl: fetchRelease(createRelease()) }),
    /timeoutMs/,
  );
  await assert.rejects(
    checkForAppUpdate({ currentVersion: '1.5.0', androidApiLevel: 30, fetchImpl: null }),
    /fetchImpl/,
  );
});
