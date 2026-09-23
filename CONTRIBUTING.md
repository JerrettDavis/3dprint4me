# Contributing

## Development

```bash
npm run dev
```

The public site has no package-install step. Python tooling is required for browser tests, the audit, and screenshots:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
```

## Required checks

Run before a pull request:

```bash
npm test
npm run screenshots
```

A change should not reduce the audit total, introduce browser console errors, break light/dark themes, or create horizontal overflow at 390 CSS pixels.

## Delivery workflow

Architecture and behavior changes follow one traceable sequence:

1. **Specification-driven:** state the customer or operational behavior, invariants, boundaries, and failure semantics before implementation.
2. **Behavior-driven:** express material outcomes as observable Given/When/Then scenarios in test names or nearby test documentation. The existing Node and pytest runners are sufficient; do not add a feature-file framework solely for syntax.
3. **Test-driven:** add one failing characterization, contract, or behavior test; confirm the expected failure; implement the smallest coherent change; then refactor while green.
4. **Verified:** run focused tests during development, then `npm test`. Run and inspect `npm run screenshots` for any visible change.

The domain vocabulary and context ownership are defined in [`docs/DOMAIN-LANGUAGE.md`](docs/DOMAIN-LANGUAGE.md). Significant dependency decisions require an ADR in `docs/adr/`.

## Content changes

- Keep service language outcome-oriented.
- Do not present browser estimates as final prices.
- Keep the typical-turnaround statement qualified.
- Verify portfolio licensing and image ownership.
- Update canonical, sitemap, Open Graph, and structured data when adding routes.
- Recalculate the CSP hash when adding or changing an inline script. `npm run validate` reports the required hash.

## Code conventions

- Prefer small, explicit browser modules and server adapters.
- Keep secrets outside `public/`.
- Revalidate all customer input server-side.
- Keep integrations optional and preserve a useful failure state.
- Avoid dependencies for behavior that can be implemented clearly with platform APIs.
- Add tests for bug fixes and provider contract assumptions.
- Keep Vercel handlers focused on bounded parsing, one application call, and response serialization.
- Domain and use-case modules must not import provider SDKs or HTTP transports.
- Provider adapters depend on domain/application contracts; domain code never depends on adapters.
- Prefer feature-owned modules over global technical-layer or generic `utils` directories.
- Run `npm run validate` to enforce public, secret, CSP, asset, syntax, and architecture boundaries.

## Pull request description

Include:

- Customer or operational problem solved
- Routes and states affected
- Security/privacy impact
- Pricing or legal copy impact
- Verification commands and results
- Updated screenshots for visible changes
