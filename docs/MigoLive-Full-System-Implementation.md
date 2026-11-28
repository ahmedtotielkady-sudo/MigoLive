# MigoLive — Full System Requirements Implementation

This is the single implementation checklist for `MigoLive_Full_System_Requirements_AR_v4.docx`. Do not create parallel implementations of an existing module. Extend the canonical models, routes, wallet, room state, and realtime services already in the repository.

Status meanings: `[x]` verified in current code, `[~]` partially present and requires completion/acceptance tests, `[ ]` not implemented or not verified. A feature is not complete merely because a model or endpoint exists.

## Core architecture and agencies

- [~] 1. Central server authority: MongoDB-backed accounts, wallet, room state, sessions and realtime exist; central agency workflows remain in progress.
- [~] 2. Separate host agencies, recharge agencies, commissions and owner controls without sharing privileges or balances.
- [~] 3. Host agencies: owner creation, manager membership, host membership and one-active-host-agency database uniqueness are added in PR #80. Still required: invitations/acceptance, supervisor permissions, activity-hours/day/gift metrics, monthly goals, performance tiers, host rewards, transfers with settlement, freeze reasons and reports.
- [~] 4. Recharge agencies: owner creation, package configuration, agency coin inventory, owner credit, distributor membership and transactional package charging are added in PR #80. Still required: distributor limits, low-balance alerts, statements, temporary recharge suspension, credit-limit policy and complete reconciliation.
- [~] 5. Commissions: package commission rate and calculated commission amount are captured in the agency ledger. Still required: versioned effective-dated commission rules, beneficiary accrual accounts, approvals, payouts and historical non-retroactive rule tests.
- [~] 6. Owner central panel: existing owner-only user/device controls exist. Still required: agency overview, finance summaries, agency lifecycle controls, package/rate editor, approvals, exports and agency audit UI.
- [ ] 7. Agency tiers and promotion/demotion criteria configurable by owner.
- [~] 8. Server-enforced role and agency scope checks; continue adversarial tests for every endpoint and prevent cross-agency reads/writes.
- [~] 9. Daily/monthly operational workflow: membership and charge ledger exist; statements, review, reconciliation and settlement remain.
- [ ] 10. Electronic contracts, withdrawal requests, support tickets, disputes, leaderboards, target rewards, warning rules and renewal notifications.
- [~] 11. App sections: agency APIs exist; owner/manager/distributor user interfaces remain.
- [~] 12. Delivery sequence: agency database/API foundation is in PR #80; continue integration and acceptance testing before enabling it in production.
- [ ] 13. Agency acceptance suite: isolation, role bypass, duplicate charging/retry, host transfer, wallet reconciliation, reports and suspension tests.
- [~] 14. Accounting: wallet and agency ledgers are append-oriented; add reversal-only corrections, explicit settlement states, currency reports and dual approval for large payouts.
- [ ] 15. Commercial decisions requiring owner approval: manager/supervisor delegation, host reward formula, prepaid vs credit terms, settlement cadence, setup fees/grace/targets and transfer policy. Do not invent or hard-code business rates.

## Rooms, gifts, wallet and safety

- [~] 16. Rooms: MongoDB room membership, server seat state and mic leases exist. Requirement specifies 24 microphones in 6-per-row layout; current schema/realtime accepts up to 25, so reconcile this before UI acceptance. Add reservation/locked states, role matrix, reports, events and complete concurrent reconnect tests.
- [~] 17. Gifts: server-priced catalog and idempotent wallet transaction exist. Still required: configurable owner catalog, animation assets, recipient eligibility, host/agency/app share distribution, group limits, gift objectives, rankings and reversal records.
- [~] 18. Wallet: canonical user coins, wallet mirror, transaction history and transactional idempotency exist. Verify all game, gift, recharge, adjustment and reconnect paths against one ledger; prevent negative balances and silent corrections.
- [~] 19. Room safety: current account/room controls exist; add reports, graduated moderation, appeal handling, room/app block scopes and anti-spam acceptance tests.
- [ ] 20. Activity, host, gift, room, agency and finance reporting with timezone and freshness metadata.
- [~] 21. Existing room, gift and wallet tests cover only part of the required concurrency and failure matrix; expand before launch.
- [~] 22. Room/gift integration exists in part; complete catalog, distribution, moderation, reporting and load-test phases.
- [~] 23. Preserve server-authoritative balances/room state, immutable original financial entries, explicit reversal entries, separated permissions and privacy-safe auditability.

## User/device security and real voice

- [~] 24. User/device records: owner-only device registry, device/app/OS metadata, single active account session and password hashing exist. Still required: previous-device history views, phone/email verification and MFA state, secure password-reset tokens, force-change flow, session revocation UX, retention policy and audit every sensitive read/action. Never expose or store plaintext passwords.
- [x] 25. Device/user administration routes enforce the verified owner role on the server; retain owner-only access and explicit authorization checks for every new endpoint.
- [~] 26. LiveKit SFU integration and server-controlled microphone publishing exist. Still required: production configuration and TURN validation, actual two-device/multi-speaker tests, audio route switching, reconnect and mute/kick revocation tests, monitoring, capacity alerts and horizontal scaling drills.

## PR #80 — current scope

- [x] Add agency and agency-membership data models.
- [x] Enforce one active host-agency membership per user with a partial unique index.
- [x] Add an append-oriented agency ledger and owner audit-log model.
- [x] Add owner-only agency creation, configuration and recharge-inventory credit endpoints.
- [x] Add manager-scoped membership management and owner/manager-only roster and ledger views.
- [x] Add server-priced, idempotent, MongoDB-transactional agency package charging that updates agency inventory, canonical user coins, wallet mirror and wallet transaction together.
- [x] Add `agency_charge` to the wallet transaction type.
- [x] Mount agency routes and initialize agency indexes before the API starts.
- [x] Add regression tests for schema constraints, authorization, package pricing and duplicate-charge protection.
- [ ] CI test run must pass.
- [ ] Owner panel and agency user interfaces must be integrated.
- [ ] Remaining requirements above must be implemented and accepted; PR #80 alone is not completion of the entire specification.

## Non-negotiable release gates

1. Do not merge a change with failing backend or Android checks.
2. Do not expose agency controls until server-side authorization and cross-agency isolation tests pass.
3. Do not enable financial actions until duplicate/retry/disconnect tests and ledger reconciliation pass.
4. Do not claim voice is live until two real devices on different networks can hear each other and mute/kick actually stops publication.
5. Do not claim the specification is complete until every unchecked item is implemented or explicitly approved as out of scope by the owner.
