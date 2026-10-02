# Firestore rules review notes

The app uses the Standard Firestore database in project `hse-app-b1d2b` and stores operational data at `/artifacts/{appId}/public/data/{collection}/{recordId}`. Client-side money and role checks are convenience only; Firestore rules are the authorization boundary.

## Access patterns

| Collection | Reads | Writes |
| --- | --- | --- |
| `houses`, `tenants`, `payments`, `repairs`, `septicLogs`, `masterWaterBills` | Realtime workspace listeners; legacy accounts retain unfiltered compatibility reads | Role-scoped create/update; landlord reset deletes for payments and operational logs; tenant removal archives the tenant |
| `billingCycles`, `tenantCycles` | Landlord and manager workspace listeners | Landlord creates/closes cycles and updates cycle balances; managers may update only the open-cycle water share/status |
| `expenses`, `notifications`, `paymentReferences`, `waterVaultResets`, `auditLogs` | Workspace/role-scoped listeners as used by the app | Existing operational workflows; landlord-only water reset and audit operations |
| `/users/{uid}` | Own profile; same-workspace manager profiles for landlords | Landlord may provision manager profiles in their workspace; client users cannot grant themselves a role |

Non-legacy landlord and manager collection listeners include `where('workspaceId', '==', workspaceId)` so the query matches the rules. The three hardcoded legacy accounts still use unfiltered listeners for old records that may have no workspace field.

## Validation and authorization

- New billing-cycle records validate their allowed fields, IDs, status, workspace/actor metadata, string lengths, and numeric ranges. Tenant-cycle creation requires an open billing-cycle document in the same workspace in the same write batch.
- Payment creation validates a fixed schema and amount allocations. Manager-created payments must remain pending and point to a matching tenant-cycle and open billing cycle. Landlord confirmation can only transition a pending payment to confirmed and can only change the status/allocation fields.
- Cycle updates are restricted to closing an open cycle; tenant-cycle updates preserve tenant/cycle identity and creation metadata. Managers can only change the water share/status while the parent cycle is open.
- Tenant rent/deposit data is checked on creation and whenever `houseId`, `expectedRent`, or `depositAmount` changes: the rent must match the assigned unit's rent, and the deposit must equal that rent. Unrelated balance-only payment/reset updates leave legacy lease fields untouched and are not blocked by stale or incomplete pricing fields.
- The explicit landlord reset may zero paid totals/status in open and closed tenant-cycle records. It validates the cycle/tenant identity, workspace, expected-charge numeric ranges, parent-cycle state, and reset status; its field-diff allow-list preserves every other existing field, including older metadata.
- Monthly rent targets and deposits are derived from the assigned unit's `rent`. A monthly water-share entry replaces the amount on the open `tenantCycles` record (rather than accumulating repeated submissions), so it no longer attempts an extra `lastAdjustment` tenant-field write that manager rules reject.
- Managers cannot create houses, tenants, or billing cycles, or update permanent tenant lease terms. Their updates are limited to property repair status, repair resolution, and current-cycle water-share adjustments.
- Deletes are denied by default. Landlord deletion is limited to payments, payment references, repairs, septic logs, and master water bills in the landlord's workspace. Tenant records are archived rather than deleted; houses and cycle history cannot be deleted through these rules.
- The reset workflow filters compatibility reads back to the active workspace before preparing any tenant-balance update or operational-record delete batch. Legacy records without a workspace ID remain supported only for the legacy accounts; records from other workspaces are left untouched rather than causing a whole batch to be rejected.
- User profile reads are limited to the owner and same-workspace landlords. Role assignment is not accepted from a user's own profile write.
- Tenant documents contain phone/contact PII. Reads remain behind authenticated role/workspace rules.

## Devil's-advocate review (static)

| Attempt | Result |
| --- | --- |
| Unauthenticated list/get/create/update/delete | Denied by default; all explicit paths require authentication and role/workspace checks. |
| Manager creates a landlord, tenant, house, or billing cycle | Denied by manager create allow-list and profile role checks. |
| Manager creates a confirmed payment, omits `cycleId`, targets a closed cycle, or adds an unknown payment field | Denied by payment schema, pending-only manager rule, and open-cycle/tenant-cycle relationship checks. |
| Manager changes a property's rent or writes a monthly water share to the tenant's permanent record | Denied; managers can change only the current cycle's water share, while property rent is set from the unit and managed by the landlord. |
| Landlord resets paid balances on a legacy tenant with stale/missing rent or deposit fields | Allowed if the update changes no lease fields; the strict unit/rent/deposit invariant still applies to lease-term changes. |
| Manager updates payment allocation or changes cycle ownership/creation fields | Denied; managers have no payment update path, and cycle update allow-lists protect immutable fields. |
| Add an unknown field or oversized string to a payment/cycle record | Denied by `hasOnly()` schemas and explicit length bounds. |
| Update a closed billing cycle or change a tenant-cycle's identity | Denied by status-transition and affected-field checks. |
| Cross-workspace access by a non-legacy profile | Denied by workspace queries and `sameWorkspace` checks. |
| Cross-workspace access by a hardcoded legacy UID | The compatibility branches currently permit project-wide reads for legacy accounts so old unscoped records remain readable. This is a known migration risk; remove the legacy UID bridge after migrating all records and profiles. |
| Resource exhaustion/schema pollution in non-cycle operational collections | Not fully prevented yet: those existing collections retain broad field schemas and do not all have per-field size/type validators. Add collection-specific validators before opening the app to broader use. |

The review above is a static rules/code review, not an emulator-based attack test. Firebase CLI dry-run successfully compiled the current rules. Behavioral authorization tests against an emulator and a final manual review are still recommended before broad production rollout. A reset spans multiple Firestore batches, so if a batch is denied or times out, some earlier batches may already have committed; the UI now identifies the failing phase and warns before retrying.
