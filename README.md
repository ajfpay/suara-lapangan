# Suara Lapangan

Speak the job, check every number against your own recording, and issue a
formal document — a Quotation in English or a Surat Penawaran in Indonesian.
Built for foremen and small contractors working in Indonesian and English, on
sites where the signal comes and goes.

This repository is at the skeleton stage: the three screens exist and are
navigable, the two locales work, and the recording, transcription, number
checking and PDF work arrives in the tickets that follow.

## The three steps

| Step | Address | What happens there |
| --- | --- | --- |
| Rekam | `/en`, `/id` | Record the job out loud. |
| Susun | `/en/susun`, `/id/susun` | Review what was said, turn by turn, with the numbers it contains. |
| Dokumen | `/en/dokumen`, `/id/dokumen` | Issue the document. |

Only `en` and `id` are shipped, and English is the default. Any other locale
prefix, and any address that is not one of the three steps, answers 404.

## Running it

Requires Node 20 or newer.

```bash
npm ci
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` / `npm start` | Production build and serve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run test:e2e` | Playwright smoke suite. Builds and serves the app first. |
| `npm run check:third-party` | Verifies every installed package is listed in THIRD-PARTY.md. |
| `npm run icons` | Re-renders the app icons from `public/assets/img/suara-lapangan-mark.svg`. |

The e2e suite runs two projects — desktop 1440x900 and mobile 375x812 — and
needs no microphone and no network: it drives the built app over HTTP.

## Stack

Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS · `next-intl`
for the two locales. The document pipeline renders HTML through headless
Chromium, and `puppeteer-core` is kept out of the server bundle for it.

## Licence

MIT. This application was forked from the MIT-licensed
[invoify](https://github.com/al1abb/invoify); its copyright notice is kept
verbatim in [`LICENSE`](LICENSE) and served at `/LICENSE`, as the licence
requires. Every dependency, with its version and licence, is listed in
[`THIRD-PARTY.md`](THIRD-PARTY.md).

The invoice flow — the invoice form, the template gallery, the e-invoice XML
export and the email sender — was removed in the first ticket.
`app/components/templates/**` is still present but unimported and excluded from
typechecking and linting; it belongs to the ticket that builds the Quotation /
Surat Penawaran template.
