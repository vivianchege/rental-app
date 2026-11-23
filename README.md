# Ruiru Rentals

Ruiru Rentals is a React and Capacitor property-management app for landlords and managers. The website and Android APK use Firebase Authentication and Cloud Firestore.

## What it includes

- Landlord and manager workspaces with role-based access.
- Managers can submit new-tenant, tenant-removal, tenant-detail, and past-bill requests. The landlord reviews each request before protected records change. Manager detail edits keep the unit assignment read-only; removal keeps payment and billing history for audit.
- Houses and units, tenant directory, rent and water billing, payment ledger, expenses, utilities, maintenance, reports, and activity history.
- Past-month billing entry for the landlord and manager rent/water logging with landlord review.
- Repairs & Operations includes house repairs, septic cleanouts, and a garbage collection log. Managers can record pickups; recorded collection costs are included in operating expense totals.
- Payment reference checks: landlord-entered payments require a reference; managers can submit a pending payment without one, but the landlord must enter a reference before confirming it. References cannot be reused. Cash is not offered as a rent-payment method.
- Responsive light and dark themes, with the Ruiru Rentals logo in the Android app drawer.
- Shared workspace notifications for rental, payment, maintenance, utility, and account changes, plus one daily follow-up reminder for a randomly selected tenant with a large balance.
- A role-aware rental assistant. It reads workspace data on the server, keeps a conversation history, summarizes the latest 18 closed billing months, and lets the landlord ask about managers' recent activity and assistant conversations. It cannot change records. Managers can see only their own assistant history and permitted rental records.
- Native Google sign-in in Android and browser Google sign-in on the website.
- Android ledger Back control and system Back navigation.

## Rental assistant setup

The assistant calls Firebase Cloud Functions and Google Gemini through Google Cloud's Vertex AI service. No model API key is stored in the website or APK. The server verifies the signed-in role and workspace before reading records. Manager conversations are private to that manager and landlord-accessible within the same workspace; no other workspace is included. The assistant uses recent billing cycles and operational records, and it does not create or approve records.

To enable answers in a Firebase project, enable Cloud Functions and the Vertex AI API, attach a billing account, and grant the Functions runtime service account the Vertex AI User role (`roles/aiplatform.user`). The default model is `gemini-3.8-flash` using the global endpoint; set `RENTAL_ASSISTANT_MODEL` or `GOOGLE_CLOUD_LOCATION` in `functions/.env` if you need to change them. Deploy with:

For the production Firebase project `hse-app-b1d2b`, no callable functions were deployed at the latest review on November 23, 2026. The rental assistant and manager-account access controls remain unavailable in the live app. A Supabase Free project has been created, but its Edge Functions are not yet deployed or connected to Firebase; the app continues to use Firebase Auth and Firestore. Do not treat the Supabase setup as a working replacement until token verification, workspace authorization, secret provisioning, and live tests have passed.

```bash
npx firebase-tools deploy --only functions --project hse-app-b1d2b
```

Cloud Functions deployment requires the Firebase project to use the Blaze plan. Gemini model usage may incur separate Google Cloud charges; set budget alerts in Google Cloud before enabling regular use. The app shows an actionable setup error if the backend or model service is not configured.

## Sign-in and app security

- Firebase Authentication handles passwords. The app never stores them.
- On Android devices with enrolled biometrics, the app locks each time it goes to the background and prompts for the device's available biometric when reopened. The operating system chooses the available biometric; a password sign-in is available if biometric unlock is cancelled or unavailable.
- Without enrolled biometrics, an Android session expires after 15 minutes in the background and asks the user to sign in again.
- Five incorrect password attempts trigger a local cooldown of 30 seconds, then 1 minute, 3 minutes, 5 minutes, 15 minutes, 30 minutes, 1 hour, and 5 hours. Later failed attempts remain at 5 hours. A successful password sign-in clears the counter. Firebase also applies its own server-side protections.
- These local session and cooldown settings are stored with Capacitor Preferences on Android and browser storage on the web. They do not contain passwords.

## Firebase configuration

The public Firebase client settings for the registered web app are in `src/lib/firebaseClientConfig.js`; Android's registered app settings are in `android/app/google-services.json`. Firebase documents these client configuration values as public identifiers. They are not authorization credentials. Firestore rules and authenticated roles protect the data.

You can override the web settings for another environment by copying `.env.example` to `.env.local` and setting the six `VITE_FIREBASE_*` values. Never put service-account keys, private OAuth secrets, or other server credentials in a Vite variable or browser bundle.

The Firestore schema remains under `artifacts/{projectId}/public/data/{collection}`. `firestore.rules` is the server-side authorization boundary; client-side role checks only control the interface.

### Roles

Users need a Firebase custom claim or protected `users/{uid}` document with role `LANDLORD` or `MANAGER`. Manager profiles must be assigned to the correct landlord `workspaceId`. Do not let the browser promote an account to landlord. The current app retains compatibility with the existing legacy account UIDs while profiles are migrated.

Deploy rule changes to the project with:

```bash
npx firebase-tools deploy --only firestore:rules --project hse-app-b1d2b
```

## Run the website locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

## Build and install the Android APK

The package name is `ke.co.houseapprentals`. Both builds support Android 7.0+ (API 24+) and use the Ruiru Rentals logo. The standard build targets Android 16/API 36, is recommended for Android 10+ (API 29+), and uses Google Credential Manager. The older-device build targets API 28, is recommended for Android 7–9 (API 24–28), including the Galaxy S8 generation, and uses Google Play Services sign-in. Both use Tailwind CSS 3.4 and JavaScript output targeted to Chrome 72 for older Android WebViews. Keep Chrome updated on Android 7–9 because Chrome supplies WebView on those devices.

### Download

- [Android 10 and newer](https://github.com/vivianchege/rental-app/releases/latest/download/Ruiru-Rentals-1.6.2-Android-10-plus.apk)
- [Android 7–9, including Galaxy S8](https://github.com/vivianchege/rental-app/releases/latest/download/Ruiru-Rentals-1.6.2-Android-7-to-9.apk)

The Android 7–9 variant was previously smoke-tested on an Android 9 Samsung SM-J337A handset. Record a fresh device smoke check for each release before describing it as verified on a physical phone.

Both APKs have the same app ID and signing identity. Installing one updates/replaces the other while retaining the device's app data. The APKs are signed debug builds for direct installation and private sharing; they are not Play Store release builds.

### Build locally

Use Android Studio's bundled JDK and install Android SDK/platform tools. From the project root, build both APKs with the same process used for the GitHub release:

```bash
npm install
npm run build:android-apks
```

The generated files are placed in `android/app/build/outputs/shareable-apks/`. The script builds the older-device Google sign-in bundle with the legacy Gradle flavor, then builds the standard bundle. On Windows it uses `gradlew.bat`; on macOS/Linux it uses `gradlew`.

The app version comes from `package.json`; Gradle derives a monotonically increasing Android version code from it. The APKs are non-debuggable release builds signed with the same local Android debug key as the existing GitHub downloads. The build script verifies that signer before it copies either APK, so a different computer's debug key cannot silently produce incompatible updates. Keep this key safe; replacing it prevents Android from installing future APKs as updates. These APKs are for direct installation and private sharing, not Play Store distribution.

On Android, **Settings → Check updates** fetches the latest published GitHub release each time it is pressed. It reports the installed and latest versions when current, or opens an update dialog with the matching device APK and release notes. The APK downloads through Android Download Manager; Android still asks the user to approve installation. On the first update, Android may ask the user to allow installs from Ruiru Rentals. Return to the app and press the update button again after granting that setting.

## Checks

```bash
npm run lint
npm test
npm run build
```

The Node test suite covers money allocation, workspace access, password cooldowns, and update release parsing/version selection.

## Project layout

- `src/App.jsx` — portal screens, authentication, Firestore subscriptions, and app workflows.
- `src/lib/firebaseClientConfig.js` — public Firebase web-app configuration.
- `src/lib/money.js` — money validation and payment allocation.
- `src/lib/permissions.js` — roles and permissions.
- `src/lib/authSecurity.js` — app idle timeout and password cooldown calculations.
- `firestore.rules` — Firestore authorization and data validation.
- `android/` — Capacitor Android project and APK build configuration.

Financial totals use confirmed payments. Overpayments are retained as credit, duplicate transaction references are blocked, and tenant removal archives records rather than deleting financial history. Audit records are appended to `auditLogs`.
