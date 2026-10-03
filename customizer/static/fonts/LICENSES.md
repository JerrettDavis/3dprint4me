# Self-hosted fonts

These font files are served same-origin from `/customize/fonts/` for the Customize generators
(the name plate's font list is `public/assets/js/customize/fonts.js`). No remote font service is
used. Every font here is licensed under the **SIL Open Font License, Version 1.1**; the full
license text for each family ships beside the font file (named below). `SHA256SUMS` pins each
file, and `tests/unit/customize-name-plate.test.mjs` checks the files, the checksums and this list.

Source: the Google Fonts repository, `https://github.com/google/fonts/raw/main/ofl/<family>/`,
downloaded 2026-10-03. The files are unmodified (not subset or converted).

The brief's original list named Permanent Marker and Chewy. Both are in the Google Fonts
repository under `apache/` (Apache License 2.0), not `ofl/`, so they were replaced with two static
OFL display fonts: **Caveat Brush** (a brush-marker hand, for Permanent Marker) and **Titan One**
(a heavy rounded display face, for Chewy).

## Pacifico

- File: `Pacifico-Regular.ttf` (329,380 bytes)
- Designers: Vernon Adams, Jacques Le Bailly, Botjo Nikoltchev, Ani Petrova
- Copyright 2018 The Pacifico Project Authors (https://github.com/googlefonts/Pacifico)
- License: SIL Open Font License, Version 1.1 — `OFL-pacifico.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/pacifico

## Lobster

- File: `Lobster-Regular.ttf` (406,076 bytes)
- Designer: Impallari Type
- Copyright 2010 The Lobster Project Authors (https://github.com/impallari/The-Lobster-Font), with Reserved Font Name "Lobster".
- License: SIL Open Font License, Version 1.1 — `OFL-lobster.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/lobster

## Bebas Neue

- File: `BebasNeue-Regular.ttf` (61,400 bytes)
- Designer: Ryoichi Tsunekawa (Dharma Type)
- Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue); the shipped OFL text reads "Copyright © 2010 by Dharma Type."
- License: SIL Open Font License, Version 1.1 — `OFL-bebasneue.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/bebasneue

## Righteous

- File: `Righteous-Regular.ttf` (43,104 bytes)
- Designer: Astigmatic
- Copyright (c) 2011 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name "Righteous"
- License: SIL Open Font License, Version 1.1 — `OFL-righteous.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/righteous

## Caveat Brush

- File: `CaveatBrush-Regular.ttf` (295,568 bytes)
- Designer: Impallari Type
- Copyright 2015 Google Inc. All Rights Reserved.
- License: SIL Open Font License, Version 1.1 — `OFL-caveatbrush.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/caveatbrush

## Rubik Mono One

- File: `RubikMonoOne-Regular.ttf` (141,088 bytes)
- Designer: Hubert and Fischer
- Copyright 2015 The Rubik Project Authors (mail@hubertfischer.com)
- License: SIL Open Font License, Version 1.1 — `OFL-rubikmonoone.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/rubikmonoone

## Bangers

- File: `Bangers-Regular.ttf` (93,148 bytes)
- Designer: Vernon Adams
- Copyright 2010 The Bangers Project Authors (https://github.com/googlefonts/bangers)
- License: SIL Open Font License, Version 1.1 — `OFL-bangers.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/bangers

## Titan One

- File: `TitanOne-Regular.ttf` (55,712 bytes)
- Designer: Rodrigo Fuenzalida
- Copyright (c) 2011 Rodrigo Fuenzalida (hello@rfuenzalida.com), with Reserved Font Name "Titan One"
- License: SIL Open Font License, Version 1.1 — `OFL-titanone.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/titanone

Total: 1,425,476 bytes for the eight files.
