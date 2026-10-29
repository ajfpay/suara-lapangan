# Contracts (K2) and fixtures (K4)

Frozen on Day 1 so the UI (ticket 07), the server (ticket 05) and the PDF
renderer (ticket 08) can work in parallel without renegotiating shapes.

## Schemas

| File                       | Document                            | Scope                                                    |
| -------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `quotation.schema.json`    | Surat Penawaran / Quotation         | Full end-to-end flow, `locale: "en" \| "id"`             |
| `daily-report.schema.json` | Laporan Harian / Daily Field Report | Schema ready only — no flow ships, do not claim it works |
| `change-order.schema.json` | Berita Acara / Change Order         | Schema ready only — no flow ships, do not claim it works |

Every schema is written for `text.format: { type: "json_schema", strict: true }`:

- non-recursive, and no `$ref` anywhere;
- every object sets `additionalProperties: false`;
- every property is listed in `required` — a strict schema has no optional
  fields;
- only the keywords the checker in `contract.test.mjs` implements are used. If
  a schema needs a new keyword, add it to `ALLOWED_KEYWORDS` and implement it in
  the checker in the same commit, so nothing is silently unchecked.

### Fields the server owns

`nomor`, `pekerjaan[].jumlah`, `total_nominal`, `terbilang` are computed by the
server (spec D3 and guard rule 5). Model output for these is ignored, never
trusted: the document number is `SL/QTN/<date>/<nnn>` and is never spoken, and
`jumlah` must equal `volume × harga_satuan` exactly.

`butuh_konfirmasi[]` carries the frozen K3 payload
`{ field, alasan, sumber_kutipan }`. `sumber_kutipan` is a K3 turn id
(`turn_1`, `turn_2`, …) inside the same session, `final = true` only; it is
`null` when a field is simply missing and no turn can be quoted. A non-empty
`butuh_konfirmasi` holds the document at `perlu_konfirmasi`.

`pekerjaan[].satuan` is a closed list. Adding a unit is a contract change, not
a fixture edit.

## Fixtures

```
fixtures/transcripts/  30 clean cases (15 en, 15 id), each with its turns and its reference document
fixtures/defective/    12 cases that the schema accepts and the guard must catch
```

Each clean fixture is one self-contained case: the K3 turns, the project input,
and the `expected_document` a correct pipeline must produce — the same shape
`documentFromTurns(turns, locale, project)` returns in ticket 05. Reference
documents are written by hand, not generated.

Each defective fixture carries the wrong `document`, plus:

- `cacat.code` — the defect class;
- `cacat.alasan` — why this is a defect and which guard rule catches it;
- `cacat.bukti` — the evidence, quoted verbatim from a turn (or the offending
  turn id for the two citation defects);
- `expectation.field` and `expectation.verdict` — what the guard must do.

The eight classes the ticket names must all appear, and the test enforces that:
`harga_lolos_sebagai_volume`, `satuan_salah`, `desimal_koma_id`,
`ratus_puluh_tertukar`, `kutipan_sesi_lain`, `kutipan_non_final`,
`twelve_hundred_en`, `setengah_juta_id`. Four extensions are also present:
`angka_tidak_ada_di_giliran`, `jumlah_tidak_cocok`, `total_tidak_cocok`,
`satuan_hilang`.

A defective fixture must still validate against the schema — that is the point:
the schema cannot catch a wrong number, the guard does.

## Running the checks

```bash
node --test
```

No dependencies, no server, no network: Node's own runner and a small JSON
Schema checker that understands exactly the keywords these schemas use. It
checks that the schemas are strict and non-recursive, that every reference
document is internally consistent and cites turns that exist, and that each
defective fixture really contains the defect it claims.
