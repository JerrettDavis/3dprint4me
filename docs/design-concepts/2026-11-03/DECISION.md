# Workspace design decision

Selected **A — Fluent task workspace**, incorporating C's compact, progressively disclosed partner details. Retain the native HTML/CSS/JavaScript stack and existing API contracts. The design references Fluent, Material and iOS/Metro conventions without adding a framework dependency.

Independent reviewers ranked the same three task prototypes:

| Reviewer | A: Fluent | B: Material | C: Focused flow | Recommendation |
| --- | ---: | ---: | ---: | --- |
| Flow audit | 24/25 | 21/25 | 21/25 | A |
| Accessibility judge | 23/25 | 19/25 | 22/25 | A |
| Prototype designer | — | — | — | A |

The unanimous recommendation supports stable grouped navigation, a clear primary task and nearby decision context. C contributes restrained disclosure for occasional partner use. The owner experience needs routine review first and deliberate disclosure for consequential account, finance and program changes. Mobile navigation must expose every destination through a visible, keyboard-accessible menu rather than rely on a clipped horizontal strip.

## Production interpretation

The prototypes explore visual structure and task hierarchy; they do not define business behavior. In particular:

- Proof approval and accrual wording must follow the existing production compensation contract. Prototype copy is illustrative and does not authorize changing when an obligation is earned or recorded.
- The successful sample-permission scenario is one fictional example. Production visits must continue to represent withheld permission and other accurate outcomes; do not make successful permission a universal requirement.
- Partner/Admin role switching exists only for comparing concepts. Production retains distinct authentication realms and authorization boundaries.
- Prototype navigation buttons announce out-of-sample destinations. Production uses real destination links with preserved routes, history and deep linking.
- No prototype button submits, approves, sends, pays or persists anything.

## Verification status

The standalone prototype passed JavaScript syntax and 12 direction/role/viewport overflow checks, with screenshots and a proof/theme interaction exercise. This evidence does not establish production correctness. Production integration, full regression tests, guide captures and visual review must be completed against the final implementation. This document makes no deployment or publication claim.
