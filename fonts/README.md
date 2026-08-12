# Fonts

The two typefaces DESIGN.md §1 specifies, stored here rather than fetched from
Google Fonts so that the app makes no network request other than the SheetJS
CDN load named in SPEC.md §2 (and so the type is correct offline).

| File | Family | Weights |
|---|---|---|
| `schibsted-grotesk-latin.woff2`, `schibsted-grotesk-latin-ext.woff2` | Schibsted Grotesk (variable) | 400–700 |
| `spline-sans-mono-latin.woff2`, `spline-sans-mono-latin-ext.woff2` | Spline Sans Mono (variable) | 400–500 |

Both families are licensed under the SIL Open Font Licence 1.1, which permits
redistribution alongside this project. The files are the Latin and Latin
Extended subsets published by Google Fonts; `@font-face` rules and matching
`unicode-range` declarations are at the top of `styles.css`.

To refresh them, download the woff2 files referenced by
`https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..700&family=Spline+Sans+Mono:wght@400..500`
and replace the files above, keeping the same names.
