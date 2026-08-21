# House Management Portal

A React/Vite property-operations workspace for landlords and house managers. The current application uses Firebase Authentication and Cloud Firestore and keeps the existing data collections used by the started project.

## Architecture

- `src/App.jsx` contains the existing portal shell, screens, Firestore subscriptions, and workflows.
- `src/lib/money.js` contains minor-unit money validation and payment allocation.
- `src/lib/permissions.js` contains role and permission definitions used by the UI.
- `firestore.rules` is the server-side authorization boundary. Frontend checks are only for usability.
- Firestore data is currently stored under `artifacts/{projectId}/public/data/{collection}` to preserve the existing project schema.

The application supports the roles `LANDLORD` and `MANAGER`. A role must be supplied through a Firebase custom claim or a protected `users/{uid}` document. A manager should also have a `workspaceId` matching the landlord workspace and only the assigned property/unit records should be written into that workspace.

For migration compatibility, the current build recognizes the three existing account UIDs through the optional legacy UID values in `.env.example` and `firestore.rules`. Create the `users/{uid}` profiles below as soon as possible, then remove the legacy UID bridge from both files.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in the Firebase web-app values.
4. Deploy `firestore.rules` with `firebase deploy --only firestore:rules` from this directory.
5. Create the first landlord profile in a trusted administrative process. Do not let the browser promote a user to landlord.

Example profile shape:

```json
{
  "role": "LANDLORD",
  "workspaceId": "your-workspace-id",
  "permissions": []
}
```

For a manager, use `role: "MANAGER"` and assign only the permitted workspace/property scope. Existing legacy documents without `workspaceId`, `createdBy`, or `updatedBy` need a reviewed migration before production rules are enabled.

## Environment variables

See `.env.example` for placeholders. Required values are the six `VITE_FIREBASE_*` variables. Optional defaults are:

- `VITE_DEFAULT_CURRENCY=KES`
- `VITE_DEFAULT_TIMEZONE=Africa/Nairobi`

Firebase web API keys are identifiers, not authorization controls. Firestore rules and authenticated role data are the security boundary. Never put service-account credentials in Vite environment variables or the browser bundle.

## Development

```bash
npm run dev
```

The app will show a configuration message when the Firebase variables are missing rather than attempting to initialize an incomplete client.

## Verification

```bash
npm run lint
npm run build
```

There is currently no `npm test` script in the original project. The critical money helpers are isolated in `src/lib/money.js` so they can be covered by a unit-test runner in the next hardening pass.

## Data integrity and security notes

- Passwords are handled by Firebase Authentication; the app does not store passwords.
- Password reset feedback is generic so it does not reveal whether an email exists.
- Role resolution is based on custom claims or protected user profiles, not an email allowlist in source code.
- Move-in, payment confirmation, tenant archival, and maintenance completion use Firestore transactions where multiple records must remain consistent.
- Payment references are reserved transactionally to prevent duplicate processing.
- Tenant removal is archival; financial history is not deleted.
- Confirmed payments are used for financial totals. Overpayments are retained as `excessAmount`/credit instead of being discarded.
- Audit records are appended to `auditLogs`; normal UI actions do not edit or delete them.
- Financial calculations use integer minor units inside the money helper. Existing Firestore records remain in configured currency units for compatibility.
- File/document upload workflows, scheduled rent generation, CSV/PDF exports, server-side rate limiting, and automated backup/restore are not yet implemented in this client-only repository.

## Production deployment

Build the web application with `npm run build`, then deploy the generated `dist` directory through the chosen static host. Configure Firebase Authentication authorized domains and deploy Firestore rules before exposing the app.

For backup and recovery, configure Firebase scheduled exports to a protected Cloud Storage bucket. Do not expose Firestore export files or local database files through the static site. Review and migrate legacy records before turning on the strict workspace rules.

## Known limitations

This repository is a browser client, not a complete backend service. Sensitive workflows that require trusted server credentials, scheduled jobs, file scanning, rate limiting, or administrator-only user provisioning should be moved to Cloud Functions or another authenticated backend before production use with real financial records.
