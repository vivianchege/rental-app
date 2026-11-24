# Legacy Firebase Cloud Functions

The app's current rental assistant and manager-account actions use the Supabase Edge Functions under `supabase/functions/`. The functions in this folder are the older Firebase Cloud Functions implementation and are not called by the current frontend.

Do not deploy this folder to production to enable the assistant or manager controls; Firebase Cloud Functions deployment requires the Firebase Blaze plan. Keep this source only for reference until all clients have moved to the Supabase endpoints.

For the current backend setup, required secrets, Firebase token validation, Gemini data handling, and Supabase deployment commands, see the [root README](../README.md#rental-assistant-and-manager-account-setup).
