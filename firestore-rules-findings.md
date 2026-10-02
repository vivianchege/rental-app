# Firestore rules review notes

This note records the Firestore access patterns found while implementing the Ruiru Rentals prompt. The app uses the Standard Firestore database in project `hse-app-b1d2b` and scopes data under `/artifacts/{appId}/public/data/{collection}/{recordId}`.

## Collections and app operations

| Collection | App reads | App writes |
| --- | --- | --- |
| `houses` | Realtime full collection snapshot | Landlord create; Landlord/Manager status updates; Landlord tenant workflow updates |
| `tenants` | Realtime full collection snapshot | Landlord create/update/delete; Landlord/Manager payment balance updates; Landlord/Manager billing changes; Landlord reset balance updates |
| `payments` | Realtime full collection snapshot | Landlord/Manager create; Landlord confirm/update/delete during reset |
| `repairs` | Realtime full collection snapshot | Landlord/Manager create/update; Landlord reset delete |
| `septicLogs` | Realtime full collection snapshot | Landlord/Manager create; Landlord reset delete |
| `masterWaterBills` | Realtime full collection snapshot | Landlord/Manager create; Landlord reset delete |
| `billingCycles` | Realtime full collection snapshot | Landlord create/close; readable by Managers for cycle-scoped payment entry |
| `tenantCycles` | Realtime full collection snapshot | Landlord create/close/reset/pay updates; Managers read and adjust expected bills |

There are no Firestore `where`, `orderBy`, or `limit` queries in the app. Reads are full collection listeners. The new cycle documents include workspace and actor metadata to match the existing rules' authorization checks.

## Existing authorization behavior and risks

- The rules authorize from a trusted custom claim, a landlord-managed user profile, or the existing hardcoded legacy UIDs. Client-side role and email checks are not the rules' security boundary.
- Legacy records without a `workspaceId` are now readable only by the designated legacy landlord/manager accounts, not every account with a landlord role.
- Existing data writes require `workspaceId` and `createdBy` on create, and `updatedBy` on update. App writes were missing those fields and therefore did not match this rules contract.
- All deletes were denied, so the app's existing tenant removal and the requested landlord reset could not succeed.
- Managers could not read the new billing-cycle collections. Billing UI cycle reads therefore needed narrowly scoped manager read access.
- Manager payment creation is limited to pending entries for an existing tenant in the same workspace and an open billing cycle with a matching tenant-cycle record. Manager updates are restricted to operational fields and the tenant-cycle expected-bill/status fields used by the app.
- Managers cannot create house, tenant, or billing-cycle records; their create allow-list is limited to operational workflows.
- Landlord deletes are limited to the reset collections and tenant deregistration; houses and billing-cycle history cannot be deleted through these rules.
- Existing non-cycle records do not have a complete, centralized schema validator or consistent size/type limits. This remains a broader rules-hardening item beyond the cycle validation added for these changes.
- `tenants` include phone/contact information. Access remains limited to authenticated workspace roles; avoid adding broader read access.

## New cycle validation

`billingCycles` documents use an auto ID mirrored by `id`, month/year/index, `OPEN`/`CLOSED` status, ISO date strings, and workspace/actor metadata. Updates are limited to closing an open cycle.

`tenantCycles` documents are keyed by `{tenantId}_{cycleId}` and hold identity, house, expected/paid rent and water, status, created time, and workspace/actor metadata. Updates preserve the identity and creation fields and may change only billing amounts, status, and update actor.
