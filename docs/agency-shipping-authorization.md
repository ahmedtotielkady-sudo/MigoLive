# Agency and shipping authorization

## Agency rules enforced by the API

- Host agency applications are created with `POST /api/agencies/host-request` and remain pending until reviewed by an administrator.
- Approval creates/activates only a `type: host` agency. It does not change the user's global role and does not create shipping-agency membership.
- Shipping agencies are created only by administrators/owners through `POST /api/admin/agencies/shipping`.
- Only administrators/owners can add or deactivate shipping-agency members.
- `POST /api/shipping/topups` credits another active user's wallet only when the caller is an active member of an active shipping agency, or has the administrator/owner role. It writes a ledger transaction with the actor and agency identifiers.
- Host-agency membership is never accepted as shipping authorization. A client-supplied role, agency type, or permission is never trusted.

## Endpoints

- `POST /api/agencies/host-request`: authenticated user submits { name }.
- `GET /api/agencies/me`: authenticated user's agency memberships/ownership.
- `GET /api/admin/agencies/host-requests`: admin queue.
- `POST /api/admin/agencies/host-requests/:id/approve` and `/reject`: admin review.
- `POST /api/admin/agencies/shipping`: create an active shipping agency with an initial member.
- `POST /api/admin/agencies/shipping/:id/members`: add a shipping member.
- `DELETE /api/admin/agencies/shipping/:id/members/:userId`: deactivate a shipping member.
- `POST /api/shipping/topups`: shipping-authorized wallet credit; requires `userId`, positive integer `amount`, and `Idempotency-Key`.

These endpoints secure server-side operations. The existing agency UI in index.html still needs to be connected to these APIs before the full app flow is server-backed. Existing localStorage agency records are not migrated automatically.
