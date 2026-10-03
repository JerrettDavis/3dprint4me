// Curated, self-hosted fonts for generators (isomorphic: the browser form, the build worker and
// the server's re-validation all read this list). Every file is served same-origin from
// /customize/fonts/ (CSP font-src 'self'); its license text ships beside it and is recorded in
// customizer/static/fonts/LICENSES.md. Only SIL Open Font License 1.1 fonts belong here.
const font = (id, label, file, licenseFile) => Object.freeze({ id, label, file, license: "OFL-1.1", licenseFile });

export const FONTS = Object.freeze([
  font("pacifico", "Pacifico", "Pacifico-Regular.ttf", "OFL-pacifico.txt"),
  font("lobster", "Lobster", "Lobster-Regular.ttf", "OFL-lobster.txt"),
  font("bebas-neue", "Bebas Neue", "BebasNeue-Regular.ttf", "OFL-bebasneue.txt"),
  font("righteous", "Righteous", "Righteous-Regular.ttf", "OFL-righteous.txt"),
  font("caveat-brush", "Caveat Brush", "CaveatBrush-Regular.ttf", "OFL-caveatbrush.txt"),
  font("rubik-mono-one", "Rubik Mono One", "RubikMonoOne-Regular.ttf", "OFL-rubikmonoone.txt"),
  font("bangers", "Bangers", "Bangers-Regular.ttf", "OFL-bangers.txt"),
  font("titan-one", "Titan One", "TitanOne-Regular.ttf", "OFL-titanone.txt")
]);

export const findFont = id => FONTS.find(f => f.id === id);
