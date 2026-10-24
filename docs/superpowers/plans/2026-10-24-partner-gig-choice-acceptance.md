# Native voluntary gig acceptance plan

**Spec:** Private `testing/features/gig-choice.feature`; remaining scenario audit.
**Scope:** Reuse fresh reviewed programs and real enrollment/issued acknowledgments.
Add the three missing named journeys. A direct fourth case now verifies offline visit and gig-submission replay; earlier
cold-reopen and batch replay remain supplemental. No real invitations, professional approval or payments occur.

- [x] Fresh $50 immutable offer: display objective criteria, accept/reserve, record
  ten unique permitted business visits, submit and open actual owner review. Verify
  submitted remains unpaid and no optional activity/uniform/clock-in is required.
- [x] Decline without reservation/obligation or account penalty; accept a future offer
  under the unchanged program policy.
- [x] Stop unsafe accepted work with a reason visible to the owner, no geolocation or
  route fields, preserved obligations and future offer eligibility.
- [x] Review results and update packet mappings; all 36 native cases pass.
  Application source is unchanged from the complete regression and visual run.
- [x] Commit/push and inspect the exact hosted CI head.

Committed `e3b7209`; hosted run `40111472553` passed recovery/PostgreSQL/native cases
and entered full regression. Later hosted status remains separate evidence.

Use browser/API positive controls and fresh records. Do not seed accepted work or
infer future eligibility solely from absence of a penalty label.
