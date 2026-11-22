# Rental assistant callable functions

`askRentalAssistant` and `getRentalAssistantHistory` are Firebase Functions v2 callable endpoints. They require a signed-in enabled account, use a protected `/users/{uid}` profile first and verified Firebase custom claims as a role fallback, and require a trusted workspace assignment. Rental data is read by the server from `artifacts/{Firebase project ID}/public/data`. Records are filtered to that workspace before aggregation. The three known legacy accounts may also read records with no `workspaceId` in `main-workspace`; an explicit different workspace is always excluded.

Assistant messages are stored in the Admin-only path `rentalAssistantChats/{workspaceId}/users/{uid}/messages`. Managers can load only their own history. A landlord can load a manager's history by calling `getRentalAssistantHistory` with that manager's UID; the function verifies that the manager belongs to the landlord's workspace. Landlord answers can use recent manager prompts and audit activity from that workspace. The assistant is read-only and receives no client-provided rental context.

## Vertex AI setup

The Functions runtime uses Application Default Credentials. No Gemini API key or client-side secret is used. Defaults are `RENTAL_ASSISTANT_MODEL=gemini-3.8-flash` and `GOOGLE_CLOUD_LOCATION=global`; the model page lists the global endpoint. Both can be overridden in `functions/.env` when needed.

1. Enable billing and the Vertex AI API (`aiplatform.googleapis.com`) for the Firebase Google Cloud project.
2. Grant the deployed Functions runtime service account the `roles/aiplatform.user` role.
3. If you need to override the defaults, copy `.env.example` to `.env` and set the model ID and a supported location.
4. For local emulator use, authenticate Application Default Credentials with the Google Cloud project and give the local identity Vertex AI access.
5. Install Functions dependencies and deploy the Functions when ready. Until the API, billing, IAM role, model, and location are configured, `askRentalAssistant` returns an actionable setup error; the callable does not claim the live model is available.

For local configuration, copy `functions/.env.example` to `functions/.env` and keep the latter out of version control:

```dotenv
RENTAL_ASSISTANT_MODEL=gemini-3.8-flash
GOOGLE_CLOUD_LOCATION=global
```

The callable permits up to 10 assistant requests per user per minute and 100 per user per UTC day, limits prompts to 4,000 characters, caps generated responses, and includes at most the latest 18 closed billing cycles. Its small operations context contains recent repairs, expenses, provider-water bills, septic services, garbage collections, and (for landlords only) water-vault resets.
