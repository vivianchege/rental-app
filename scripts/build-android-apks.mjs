import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const distDirectory = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'shareable-apks');
const isWindows = process.platform === 'win32';
const expectedSigningCertificate = '8d323d9a062327bdaf594f2922ef692ad6ebe193ec4339c01dde6acbacf7640f';
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
].filter(Boolean);
const androidSdkPath = sdkCandidates.find((candidate) => {
  return existsSync(path.join(candidate, 'platform-tools', isWindows ? 'adb.exe' : 'adb'));
});
if (!androidSdkPath) throw new Error('Android SDK not found. Set ANDROID_HOME or install the SDK in the standard Android Studio location.');

function run(command, args, env = process.env, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

function verifyReleaseSignature(apkPath) {
  const buildToolsDirectory = path.join(androidSdkPath, 'build-tools');
  const signerJars = readdirSync(buildToolsDirectory)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((version) => path.join(buildToolsDirectory, version, 'lib', 'apksigner.jar'))
    .filter(existsSync);
  if (!signerJars.length) throw new Error('Android SDK build-tools apksigner.jar was not found.');

  const result = spawnSync('java', ['-jar', signerJars[0], 'verify', '--print-certs', apkPath], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`APK signature validation failed: ${result.stderr || result.stdout}`);
  const fingerprint = /certificate SHA-256 digest: ([a-f\d]{64})/i.exec(result.stdout)?.[1]?.toLowerCase();
  if (fingerprint !== expectedSigningCertificate) {
    throw new Error('APK signer does not match the existing GitHub APK. Refusing to produce an incompatible update.');
  }
}

const variants = [
  { flavor: 'legacy', androidRange: '7-to-9', useLegacyGoogleAuth: true },
  { flavor: 'modern', androidRange: '10-plus', useLegacyGoogleAuth: false },
];

mkdirSync(distDirectory, { recursive: true });

for (const variant of variants) {
  const env = {
    ...process.env,
    ANDROID_HOME: androidSdkPath,
    ANDROID_SDK_ROOT: androidSdkPath,
    VITE_ANDROID_LEGACY_GOOGLE_AUTH: String(variant.useLegacyGoogleAuth),
  };
  const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const capacitorCli = path.join(repoRoot, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  run(process.execPath, [viteCli, 'build'], env);
  run(process.execPath, [capacitorCli, 'sync', 'android'], env);

  const androidDirectory = path.join(repoRoot, 'android');
  const gradleTask = `assemble${variant.flavor[0].toUpperCase()}${variant.flavor.slice(1)}Debug`;
  run(
    'java',
    ['-classpath', 'gradle/wrapper/gradle-wrapper.jar', 'org.gradle.wrapper.GradleWrapperMain', gradleTask.replace('Debug', 'Release')],
    env,
    androidDirectory,
  );

  const builtApk = path.join(
    repoRoot,
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    variant.flavor,
    'release',
    `app-${variant.flavor}-release.apk`,
  );
  const shareableApk = path.join(
    distDirectory,
    `Ruiru-Rentals-${packageInfo.version}-Android-${variant.androidRange}.apk`,
  );
  verifyReleaseSignature(builtApk);
  copyFileSync(builtApk, shareableApk);
  process.stdout.write(`Created ${path.relative(repoRoot, shareableApk)}\n`);
}
