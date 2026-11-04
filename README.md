# Ruiru Rentals

Ruiru Rentals is a React and Capacitor property-management app for landlords and managers. The website and Android APK use Firebase Authentication and Cloud Firestore.

## What it includes

- Landlord and manager workspaces with role-based access.
- Houses and units, tenant directory, rent and water billing, payment ledger, expenses, utilities, maintenance, reports, and activity history.
- Past-month billing entry for the landlord and manager rent/water logging with landlord review.
- Repairs & Operations includes house repairs, septic cleanouts, and a garbage collection log. Managers can record pickups; recorded collection costs are included in operating expense totals.
- Payment reference checks: landlord-entered payments require a reference; managers can submit a pending payment without one, but the landlord must enter a reference before confirming it. References cannot be reused. Cash is not offered as a rent-payment method.
- Responsive light and dark themes, with the Ruiru Rentals logo in the Android app drawer.
- Native Google sign-in in Android and browser Google sign-in on the website.
- Android ledger Back control and system Back navigation.

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

The package name is `ke.co.houseapprentals`. Both builds support Android 7.0+ (API 24+) and use the Ruiru Rentals logo. The standard download is recommended for Android 10+ (API 29+) and uses Google Credential Manager. The older-device download is recommended for Android 7–9 (API 24–28), including the Galaxy S8 generation, and uses Google Play Services sign-in. Both use Tailwind CSS 3.4 and JavaScript output targeted to Chrome 72 for older Android WebViews. Keep Chrome updated on Android 7–9 because Chrome supplies WebView on those devices.

### Download

- [Android 10 and newer](https://github.com/vivianchege/rental-app/releases/latest/download/Ruiru-Rentals-1.4-Android-10-plus.apk)
- [Android 7–9, including Galaxy S8](https://github.com/vivianchege/rental-app/releases/latest/download/Ruiru-Rentals-1.4-Android-7-to-9.apk)

The older-device APK was smoke-tested on an Android 9 Samsung SM-J337A handset. A physical Galaxy S8 was not available for testing.

Both APKs have the same app ID and signing identity. Installing one updates/replaces the other while retaining the device's app data. The APKs are signed debug builds for direct installation and private sharing; they are not Play Store release builds.

### Build locally

Use Android Studio's bundled JDK and install Android SDK/platform tools. From the project root, build the standard APK:

```bash
npm install
npm run build
npx cap sync android
```

In PowerShell, build and save both signed APKs:

```powershell
Push-Location android
.\gradlew.bat assembleDebug
Copy-Item .\app\build\outputs\apk\debug\app-debug.apk .\app\build\outputs\apk\debug\Ruiru-Rentals-1.4-Android-10-plus.apk
Pop-Location

npm run build -- --mode android-legacy
npx cap sync android
Push-Location android
.\gradlew.bat assembleDebug -PlegacyGoogleAuth=true
Copy-Item .\app\build\outputs\apk\debug\app-debug.apk .\app\build\outputs\apk\debug\Ruiru-Rentals-1.4-Android-7-to-9.apk
Pop-Location
```

The current Android version is **1.4** (version code **5**; the older-device APK displays **1.4-legacy**). Both builds use the local Android debug signing key so they can update the app already installed from this development machine. To sign with another key, add that key's SHA-1 fingerprint to the Android app in Firebase Console and download the refreshed `google-services.json`.

## Checks

```bash
npm run lint
npm test
npm run build
```

The Node test suite covers money allocation, workspace access, and the password cooldown schedule.

## Project layout

- `src/App.jsx` — portal screens, authentication, Firestore subscriptions, and app workflows.
- `src/lib/firebaseClientConfig.js` — public Firebase web-app configuration.
- `src/lib/money.js` — money validation and payment allocation.
- `src/lib/permissions.js` — roles and permissions.
- `src/lib/authSecurity.js` — app idle timeout and password cooldown calculations.
- `firestore.rules` — Firestore authorization and data validation.
- `android/` — Capacitor Android project and APK build configuration.

Financial totals use confirmed payments. Overpayments are retained as credit, duplicate transaction references are blocked, and tenant removal archives records rather than deleting financial history. Audit records are appended to `auditLogs`.
