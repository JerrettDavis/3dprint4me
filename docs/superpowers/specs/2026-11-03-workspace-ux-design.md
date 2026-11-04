# Partner and administration workspace redesign

## Intent and authority

The user requests a comprehensive review and improvement of the UI shown in the handbook, especially partners and administrators: simple, straightforward, familiar and polished. They explicitly authorize autonomous design exploration and democratic subagent selection. This authorizes local implementation and verification; deployment remains a separate release action.

## Evidence

The current implementation is in the linked `feat/partner-live-qa` worktree. Existing dirty screenshot and UX audit files predate this task and must be preserved. The older primary checkout is not an appropriate production baseline. Relevant product contracts are PARTNER-PORTAL.md, PARTNER-OFFLINE.md, ARCHITECTURE.md and PARTNER-API.md.

Visual inspection confirms excessive top chrome, clipped flat mobile navigation, repeated equally prominent teal blocks, generic decision controls, and administrative pages mixing routine review with creation and consequential mutations. Guide captures at 1440×810 and 390×520 often omit the useful next action.

## Explored directions

A. Fluent task workspace: grouped stable navigation, focused work area and scannable records.
B. Material workbench: review tables with contextual action surfaces.
C. iOS/Metro focus: reduced chrome and focused task detail with progressive disclosure.

Two independent auditors provisionally rank A first (24/25 and 23/25) against task clarity, accessibility, mobile usability, administration depth and feasibility. Visual prototype voting must confirm or amend that selection. Votes are public and recorded with rationale; no mailbox executable is available, so collaboration messages are the voting transport.

## Proposed implementation direction

Use A as the shared foundation, borrowing focused partner forms from C and scannable administration records from B. These are assistant design choices under the user's autonomous direction. Keep the existing native HTML/CSS/JavaScript stack and blue/teal identity; adding Tailwind or a framework is unnecessary for the requested visual and interaction outcome.

- Group all existing destinations by work, records and account/setup. Desktop gets stable grouped navigation; mobile gets a labeled expandable menu with current destination and announced expanded state. No horizontal scrolling is required to discover destinations.
- Reduce chrome. Live QA access becomes a quiet secondary link; QA mode remains unmistakable. Clearance status remains available without dominating every task. Preserve actionable reasons and the distinction between unavailable new work and existing obligations.
- Partner home presents work and the next useful action. Offer details retain exact terms and fees, with explicit state-specific decisions. Recording visits, submissions, optional tracking and offline drafts remain distinct voluntary activities.
- Visit forms group business facts, optional permissioned contact and device drafts. Consent and storage warnings remain visible before their relevant action; no hidden required fields block unrelated paths.
- Administration separates record review from creation and consequential changes. Use deliberate labeled disclosures for recovery/access changes, financial corrections, cancellation and setup. Routine balances, status and next review remain scannable.
- The hashless administration landing opens daily gig review, with submitted/disputed work surfaced before other records; program setup remains available as an explicit secondary destination. Do not invent visit-approval or payment behavior to imitate prototype data.
- Use restrained neutral surfaces, blue context, teal actions, consistent 8-pixel spacing rhythm, readable 16-pixel body text, modest headings, visible boundaries and one clear primary action per task. Avoid decorative metric tiles and oversized empty surfaces.
- Preserve every existing route, history behavior, API payload, revision check, authorization rule, privacy boundary and launch gate. Preserve recoverable uncertain submissions and idempotency. No credentials or real account data enter artifacts.
- Route changes update document title and move focus to the new content when appropriate; menu interaction preserves keyboard access and focus. Consequential forms retain their confirmations and exact semantics.
- Match record-detail routes to the parent navigation area. Close mobile navigation on selection and focus current-generation content after user navigation/back-forward, never after background refresh or failed submission. Use native disclosures for local actions and preserve errors outside collapsible surfaces.
- Include the main work inbox and work detail in the administration review. Its oversized empty-state heading, excessive filter spacing and footer-only tool navigation need a coherent workspace treatment matching partner administration. Preserve explicit record selection and all existing work actions.

## Verification and completion

Test keyboard menu operation, selected destination on deep links/reload, route focus/title, no overflow at 390 pixels and landscape, light/dark/system themes, reduced motion, explicit gig actions, consent paths, draft recovery, account recovery and financial disclosures. Retain meaningful workflow tests rather than preserving tests of superseded horizontal-strip layout.

Run generated QA shell build and cache versioning as required; run npm test and npm run screenshots, inspect preview-board.png and representative actual task captures. Refresh handbook captures and explanatory text, run docs checks and review the resulting guide. Independent review must assess both code behavior and rendered screens against this scope. Completion requires the partner and admin flows, tests, screenshot evidence and documentation to agree; prototypes or passing layout checks alone do not establish completion.
