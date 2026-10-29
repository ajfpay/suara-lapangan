# Fixtures

Test material for the number guard, frozen on Day 1 (contract K4).

| Directory      | Contents                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `transcripts/` | 30 clean cases (15 `en`, 15 `id`): K3 turns, the project input, and the reference document a correct pipeline must produce |
| `defective/`   | 12 cases whose document is wrong on purpose; each names the defect, quotes its evidence, and says what the guard must do   |

Run them from the repository root:

```bash
node --test
```

The rules these files must satisfy — strict schemas, server-owned fields, the
defect codes, what each case has to contain — are documented in
[`../contracts/README.md`](../contracts/README.md). Read that before adding or
editing a case; the checker in `../contracts/contract.test.mjs` enforces it.
