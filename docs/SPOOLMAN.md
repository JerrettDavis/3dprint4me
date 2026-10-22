# Spoolman inventory sync

Implementation in progress; live activation has not occurred.

The provider uses Spoolman 0.27.0's read-only API. It requests currency at
`/api/v1/setting/currency` (the `value` is a JSON-encoded string) and all spools
at `/api/v1/spool?allow_archived=true`, with no pagination limit. The response
must fit 16 MiB and 5,000 spools within a 30-second deadline, and its
`x-total-count` must match the returned array. A partial or invalid snapshot
never changes inventory. Redirects are rejected and provider errors are sanitized.

Official source contracts: [spool endpoint](https://github.com/Donkie/Spoolman/blob/v0.27.0/spoolman/api/v1/spool.py)
and [response models](https://github.com/Donkie/Spoolman/blob/v0.27.0/spoolman/api/v1/models.py).
Spool price overrides filament price. Spool cost uses initial net grams, falling
back to the filament's nominal grams; filament price uses filament nominal grams.
Unknown price or denominator stays unknown. Only USD source prices are usable
in the application's USD cost basis. Source prices are recorded costs, not a
claim of independently verified purchase receipts. Freight is local and explicit.

Stock is one row per physical spool. Remaining source grams retain precision;
matching floors them conservatively. PLA+ remains distinct from PLA. TPU and
Flexible (TPU) map to TPU. Unknown materials require review. Multicolor,
transparent/translucent, missing colors, and nonopaque alpha values cannot
automatically match a solid color. No Spoolman writes or stock deductions occur.
