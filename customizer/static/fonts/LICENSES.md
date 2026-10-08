# Self-hosted fonts

These font files are served same-origin from `/customize/fonts/` for the Customize generators
(the name plate's font list is `public/assets/js/customize/fonts.js`). No remote font service is
used. Every font here is licensed under the **SIL Open Font License, Version 1.1**; the full
license text for each family ships beside the font file (named below). `SHA256SUMS` pins each
file, and `tests/unit/customize-name-plate.test.mjs` checks the files, the checksums and this list.

Source: the Google Fonts repository, `https://github.com/google/fonts/raw/main/ofl/<family>/`,
downloaded 2026-10-03. The files are unmodified (not subset or converted).

The 28 fonts added on 2026-10-07 come from the same repository (`ofl/<family>/`, with that
directory's `OFL.txt`). Google Fonts ships many families only as variable fonts, which the
build worker's font parser cannot use, so the "Bold" / "ExtraBold" files below were instanced to
one static weight with fontTools (`fontTools.varLib.instancer`, other axes at their default); each
entry's "Modification" line says what was done. Three files (Inter Bold, Gelasio Bold, Crimson
Text Bold) also had their GSUB table dropped because it uses a lookup type opentype.js cannot
parse; glyph outlines are untouched. None of the modified families declares a Reserved Font Name.
Every other file is byte-for-byte as published (MedievalSharp is renamed from `MedievalSharp.ttf`).
Bold and heavy weights were chosen on purpose: thin strokes print poorly. Roboto, Roboto Slab,
Satisfy and similar families are Apache-2.0 in that repository, so they are not offered.

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

## Inter Bold

- File: `Inter-Bold.ttf` (318,364 bytes)
- Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)
- License: SIL Open Font License, Version 1.1 — `OFL-inter.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/inter (`Inter[opsz,wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700 (other axes at default); GSUB table removed.

## Montserrat ExtraBold

- File: `Montserrat-ExtraBold.ttf` (374,656 bytes)
- Copyright 2024 The Montserrat.Git Project Authors (https://github.com/JulietaUla/Montserrat.git)
- License: SIL Open Font License, Version 1.1 — `OFL-montserrat.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/montserrat (`Montserrat[wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=800.

## Open Sans Bold

- File: `OpenSans-Bold.ttf` (130,492 bytes)
- Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)
- License: SIL Open Font License, Version 1.1 — `OFL-opensans.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/opensans (`OpenSans[wdth,wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700 (wdth at default).

## Poppins Bold

- File: `Poppins-Bold.ttf` (155,996 bytes)
- Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)
- License: SIL Open Font License, Version 1.1 — `OFL-poppins.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/poppins (`Poppins-Bold.ttf`)

## Work Sans Bold

- File: `WorkSans-Bold.ttf` (193,232 bytes)
- Copyright 2019 The Work Sans Project Authors (https://github.com/weiweihuanghuang/Work-Sans)
- License: SIL Open Font License, Version 1.1 — `OFL-worksans.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/worksans (`WorkSans[wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700.

## Cinzel Bold

- File: `Cinzel-Bold.ttf` (77,276 bytes)
- Copyright 2020 The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel)
- License: SIL Open Font License, Version 1.1 — `OFL-cinzel.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/cinzel (`Cinzel[wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700.

## Spectral Bold

- File: `Spectral-Bold.ttf` (273,220 bytes)
- Copyright 2017 The Spectral Project Authors (https://github.com/productiontype/Spectral)
- License: SIL Open Font License, Version 1.1 — `OFL-spectral.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/spectral (`Spectral-Bold.ttf`)

## Crimson Text Bold

- File: `CrimsonText-Bold.ttf` (110,920 bytes)
- Copyright 2010 The Crimson Text Project Authors (https://github.com/googlefonts/Crimson)
- License: SIL Open Font License, Version 1.1 — `OFL-crimsontext.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/crimsontext (`CrimsonText-Bold.ttf`)
- Modification: GSUB table removed (it uses a lookup type opentype.js cannot parse); outlines are unchanged.

## Cardo Bold

- File: `Cardo-Bold.ttf` (348,320 bytes)
- Copyright (c) 2002-2011, David J. Perry (hospes02@scholarsfonts.net)
- License: SIL Open Font License, Version 1.1 — `OFL-cardo.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/cardo (`Cardo-Bold.ttf`)

## Gelasio Bold

- File: `Gelasio-Bold.ttf` (104,052 bytes)
- Copyright 2022 The Gelasio Project Authors (https://github.com/SorkinType/Gelasio)
- License: SIL Open Font License, Version 1.1 — `OFL-gelasio.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/gelasio (`Gelasio[wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700; GSUB table removed.

## Zilla Slab Bold

- File: `ZillaSlab-Bold.ttf` (273,044 bytes)
- Copyright 2017, The Mozilla Foundation
- License: SIL Open Font License, Version 1.1 — `OFL-zillaslab.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/zillaslab (`ZillaSlab-Bold.ttf`)

## Arvo Bold

- File: `Arvo-Bold.ttf` (37,652 bytes)
- Copyright (c) 2010-2013, Anton Koovit (anton@korkork.com), with Reserved Font Name 'Arvo'
- License: SIL Open Font License, Version 1.1 — `OFL-arvo.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/arvo (`Arvo-Bold.ttf`)

## JetBrains Mono Bold

- File: `JetBrainsMono-Bold.ttf` (115,096 bytes)
- Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- License: SIL Open Font License, Version 1.1 — `OFL-jetbrainsmono.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/jetbrainsmono (`JetBrainsMono[wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700.

## IBM Plex Mono Bold

- File: `IBMPlexMono-Bold.ttf` (137,784 bytes)
- Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
- License: SIL Open Font License, Version 1.1 — `OFL-ibmplexmono.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/ibmplexmono (`IBMPlexMono-Bold.ttf`)

## Sacramento

- File: `Sacramento-Regular.ttf` (79,696 bytes)
- Copyright (c) 2012, Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Names 'Sacramento'
- License: SIL Open Font License, Version 1.1 — `OFL-sacramento.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/sacramento (`Sacramento-Regular.ttf`)

## Alex Brush

- File: `AlexBrush-Regular.ttf` (116,244 bytes)
- Copyright 2011 The Alex Brush Project Authors (https://github.com/googlefonts/alex-brush)
- License: SIL Open Font License, Version 1.1 — `OFL-alexbrush.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/alexbrush (`AlexBrush-Regular.ttf`)

## Kaushan Script

- File: `KaushanScript-Regular.ttf` (210,672 bytes)
- Copyright (c) 2011, Pablo Impallari (www.impallari.com|impallari@gmail.com), Copyright (c) 2011, Igino Marini. (www.ikern.com|mail@iginomarini.com),
- License: SIL Open Font License, Version 1.1 — `OFL-kaushanscript.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/kaushanscript (`KaushanScript-Regular.ttf`)

## Caveat Bold

- File: `Caveat-Bold.ttf` (266,456 bytes)
- Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat)
- License: SIL Open Font License, Version 1.1 — `OFL-caveat.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/caveat (`Caveat[wght].ttf`)
- Modification: Instanced from the upstream variable font at wght=700.

## Indie Flower

- File: `IndieFlower-Regular.ttf` (108,196 bytes)
- Copyright 2010 The Indie Flower Authors (kimberlygeswein.com),
- License: SIL Open Font License, Version 1.1 — `OFL-indieflower.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/indieflower (`IndieFlower-Regular.ttf`)

## Patrick Hand

- File: `PatrickHand-Regular.ttf` (214,772 bytes)
- Copyright (c) 2010-2012 Patrick Wagesreiter (mail@patrickwagesreiter.at)
- License: SIL Open Font License, Version 1.1 — `OFL-patrickhand.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/patrickhand (`PatrickHand-Regular.ttf`)

## UnifrakturCook

- File: `UnifrakturCook-Bold.ttf` (42,688 bytes)
- Copyright (c) 2010, j. 'mach' wust, with Reserved Font Name UnifrakturCook. Copyright (c) 2009, Peter Wiegel.
- License: SIL Open Font License, Version 1.1 — `OFL-unifrakturcook.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/unifrakturcook (`UnifrakturCook-Bold.ttf`)

## Pirata One

- File: `PirataOne-Regular.ttf` (56,316 bytes)
- Copyright (c) 2012, Rodrigo Fuenzalida, Nicolas Massi (www.taip.com.ar / abc.taip.com.ar), with Reserved Font Name 'Pirata'
- License: SIL Open Font License, Version 1.1 — `OFL-pirataone.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/pirataone (`PirataOne-Regular.ttf`)

## MedievalSharp

- File: `MedievalSharp-Regular.ttf` (148,712 bytes)
- Copyright (c) 2011, wmk69 (wmk69@o2.pl), with Reserved Font Name MedievalSharp.
- License: SIL Open Font License, Version 1.1 — `OFL-medievalsharp.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/medievalsharp (`MedievalSharp.ttf`)
- Modification: File renamed from MedievalSharp.ttf; contents unmodified.

## Uncial Antiqua

- File: `UncialAntiqua-Regular.ttf` (63,404 bytes)
- Copyright (c) 2011 by Brian J. Bonislawsky DBA Astigmatic (AOETI)
- License: SIL Open Font License, Version 1.1 — `OFL-uncialantiqua.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/uncialantiqua (`UncialAntiqua-Regular.ttf`)

## Metamorphous

- File: `Metamorphous-Regular.ttf` (135,740 bytes)
- Copyright (c) 2011-2012 by Sorkin Type Co (www.sorkintype.com), with Reserved Font Name "Metamorphous".
- License: SIL Open Font License, Version 1.1 — `OFL-metamorphous.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/metamorphous (`Metamorphous-Regular.ttf`)

## Cinzel Decorative Bold

- File: `CinzelDecorative-Bold.ttf` (62,300 bytes)
- Copyright (c) 2012 Natanael Gama (info@ndiscovered.com), with Reserved Font Name 'Cinzel'
- License: SIL Open Font License, Version 1.1 — `OFL-cinzeldecorative.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/cinzeldecorative (`CinzelDecorative-Bold.ttf`)

## Rye

- File: `Rye-Regular.ttf` (183,244 bytes)
- Copyright (c) 2011 by Sorkin Type Co (www.sorkintype.com), with Reserved Font Name "Rye".
- License: SIL Open Font License, Version 1.1 — `OFL-rye.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/rye (`Rye-Regular.ttf`)

## Sancreek

- File: `Sancreek-Regular.ttf` (93,252 bytes)
- Copyright 2011 The Sancreek Project Authors (https://github.com/googlefonts/sancreek)
- License: SIL Open Font License, Version 1.1 — `OFL-sancreek.txt`
- Source: https://github.com/google/fonts/tree/main/ofl/sancreek (`Sancreek-Regular.ttf`)

Total: 5,857,272 bytes for 36 files.
