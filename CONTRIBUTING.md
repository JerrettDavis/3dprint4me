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

## Pull request description

Include:

- Customer or operational problem solved
- Routes and states affected
- Security/privacy impact
- Pricing or legal copy impact
- Verification commands and results
- Updated screenshots for visible changes
