# Ruiru Rentals

Ruiru Rentals is a React and Capacitor property-management app for landlords and managers. The website and Android APK use Firebase Authentication and Cloud Firestore. Supabase Edge Functions provide the server-side rental assistant and landlord manager-account controls without requiring Firebase Cloud Functions.

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

## Rental assistant and manager-account setup

Firebase Authentication and Firestore remain the identity and rental-data stores. The app sends the signed-in Firebase ID token to these Supabase Edge Functions:

- `rental-assistant`: reads only the caller's workspace, stores conversation history and rate limits in Firestore, and provides landlord-only summaries of verified manager activity. It is read-only.
- `manager-accounts`: verifies the landlord and workspace, then lists, disables/enables, or deletes manager sign-in accounts. Disabled/deleted Firestore profiles deny access immediately; deleting a manager keeps rental records.

Supabase's gateway JWT check is disabled for these two functions because the app's existing bearer token is a Firebase token. Each handler validates the Firebase token signature, project, issuer, audience, expiry, and subject itself, then checks the current Firebase Auth account and trusted role/workspace data before accessing Firebase. Do not remove those in-function checks.

The rental assistant uses the Gemini Developer API with `gemini-3.5-flash-lite`. Before a prompt is sent, the server pseudonymizes known tenant, manager, and unit names/IDs; it also redacts emails, phone numbers, transaction references, and recognizable IDs. The server restores workspace labels only after Gemini replies. Financial amounts and months remain in the prompt so the assistant can answer record questions. Google states that free-tier Gemini content may be used to improve its products, so use this option only with that data handling understood. See [Gemini API pricing and data use](https://ai.google.dev/gemini-api/docs/pricing).

### Required server secrets

Create a dedicated service account in Google Cloud for Firebase project `hse-app-b1d2b`. Grant only the Firebase Authentication Admin role and Cloud Datastore User role needed for the account controls and Firestore data operations. Create a JSON key and store the complete JSON only as a Supabase Edge Function secret; never commit it or put it in a `VITE_*` variable.

Create a Gemini API key in Google AI Studio. Add these secrets in the Supabase dashboard under **Edge Functions → Secrets** for project `fxxfhowztjlzvisurxga`:

```text
FIREBASE_PROJECT_ID=hse-app-b1d2b
FIREBASE_SERVICE_ACCOUNT_JSON=<complete service-account JSON>
GEMINI_API_KEY=<Google AI Studio API key>
RENTAL_ASSISTANT_MODEL=gemini-3.5-flash-lite
```

Restrict the Gemini key to the Generative Language API when creating it. Never send either key in chat, the repository, or the website/APK build. Adding or changing function secrets does not require a redeploy.

### Deploy Edge Functions

The Supabase project is `fxxfhowztjlzvisurxga`. From the repository root, deploy each handler with Supabase JWT verification disabled because Firebase verification happens in the code:

```bash
npx supabase functions deploy manager-accounts --project-ref fxxfhowztjlzvisurxga --no-verify-jwt
npx supabase functions deploy rental-assistant --project-ref fxxfhowztjlzvisurxga --no-verify-jwt
```

The same setting is recorded in `supabase/config.toml`. The app calls the project URL configured by `VITE_SUPABASE_URL` (the production URL is `https://fxxfhowztjlzvisurxga.supabase.co`). These two features do not require Firebase Cloud Functions or Firebase's Blaze plan. The existing `functions/` folder is the older implementation and is not used by the current app path.

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
