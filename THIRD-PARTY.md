# Third-party software

Suara Lapangan is built on MIT-licensed work, and every package it ships has a
licence of its own. This file is the record: what is installed, at which
version, under which licence.

`npm run check:third-party` fails when a package is installed but not listed
here, or listed but no longer installed. Regenerate the table with
`npm run check:third-party -- --write` after a dependency change.

## Upstream application

| Work | Licence | What it gave us |
| --- | --- | --- |
| `invoify` ([al1abb/invoify](https://github.com/al1abb/invoify)) at commit `3859b3c` | MIT | The Next.js application this repository was forked from. Its licence text is kept verbatim in [`LICENSE`](LICENSE) and served at `/LICENSE`; the copyright notice is not removable. |

## Dependencies

<!-- BEGIN DEPENDENCIES -->
| Package | Licence |
| --- | --- |
| `@fontsource/ibm-plex-sans@5.1.0` | OFL-1.1 |
| `@fontsource/source-serif-4@5.1.0` | OFL-1.1 |
| `clsx@2.1.1` | MIT |
| `lucide-react@0.279.0` | ISC |
| `next@15.3.8` | MIT |
| `next-intl@4.3.9` | MIT |
| `react@18.2.0` | MIT |
| `react-dom@18.2.0` | MIT |
| `tailwind-merge@1.14.0` | MIT |
| `@playwright/test@1.62.1` | Apache-2.0 |
| `@types/node@20.6.2` | MIT |
| `@types/react@18.3.31` | MIT |
| `@types/react-dom@18.3.7` | MIT |
| `autoprefixer@10.4.15` | MIT |
| `eslint@9.18.0` | MIT |
| `eslint-config-next@15.3.8` | MIT |
| `postcss@8.4.31` | MIT |
| `prettier@3.4.2` | MIT |
| `puppeteer-core@24.19.0` | Apache-2.0 |
| `tailwindcss@3.3.5` | MIT |
| `tailwindcss-animate@1.0.7` | MIT |
| `typescript@5.2.2` | Apache-2.0 |
<!-- END DEPENDENCIES -->

## What this repository no longer uses

The invoice flow — the form, the thirteen templates, the e-invoice XML export
and the email sender — was removed in ticket 01, along with the packages only
it needed. `app/components/templates/**` is still present but unimported and
excluded from typechecking and linting: it belongs to ticket 08, which replaces
it with the Quotation / Surat Penawaran template.

## Fonts

Both families are self-hosted from `@fontsource`, under the SIL Open Font
License 1.1, so a build makes no request to Google Fonts.