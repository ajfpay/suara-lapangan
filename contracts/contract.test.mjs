// Contract self-check for K2 (document schemas) and K4 (fixtures).
//
// Run it with:   node --test contracts/
//
// It answers one question: can someone else re-run these contracts and
// fixtures without being told anything out loud? Every assertion below is
// about files on disk, so a red run means a fixture or a schema is wrong —
// not that the machine is missing something.
//
// Deliberately dependency-free: Node's own test runner and a small JSON Schema
// checker that understands exactly the keywords the schemas here use, and
// refuses to run if a schema reaches for a keyword it does not implement.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const validDir = path.join(repoRoot, "fixtures", "transcripts");
const defectiveDir = path.join(repoRoot, "fixtures", "defective");

const DOCUMENT_SCHEMAS = {
    quotation: "quotation.schema.json",
    "daily-report": "daily-report.schema.json",
    "change-order": "change-order.schema.json",
};

// The eight defect classes the ticket names, plus four extensions. Every
// frozen class must appear at least once in fixtures/defective/.
const FROZEN_DEFECT_CODES = [
    "harga_lolos_sebagai_volume",
    "satuan_salah",
    "desimal_koma_id",
    "ratus_puluh_tertukar",
    "kutipan_sesi_lain",
    "kutipan_non_final",
    "twelve_hundred_en",
    "setengah_juta_id",
];
const EXTENSION_DEFECT_CODES = [
    "angka_tidak_ada_di_giliran",
    "jumlah_tidak_cocok",
    "total_tidak_cocok",
    "satuan_hilang",
];
const ALL_DEFECT_CODES = [...FROZEN_DEFECT_CODES, ...EXTENSION_DEFECT_CODES];

const VERDICTS = ["butuh_konfirmasi", "tolak_dokumen"];
const NOMOR_PATTERN = /^SL\/QTN\/\d{4}-\d{2}-\d{2}\/\d{3}$/;

// Canonical unit -> how it is said, in either language. Longest phrase first
// when scanning, so "meter persegi" is not read as a bare "meter".
const SPOKEN_UNITS = {
    m2: ["square meters", "square meter", "meter persegi", "sq m", "m2"],
    m3: ["cubic meters", "meter kubik", "kubik", "m3"],
    meter: ["linear meters", "meter"],
    sq_ft: ["square feet", "square foot", "sq ft", "sqft"],
    lin_ft: ["linear feet", "linear foot", "lin ft"],
    sak: ["sak"],
    batang: ["batang"],
    titik: ["titik"],
    bag: ["bags", "bag"],
    sheet: ["sheets", "sheet"],
    bar: ["bars", "bar"],
    point: ["points", "point"],
    hour: ["hours", "hour"],
    unit: ["units", "unit", "buah"],
    hari: ["hari"],
    fixture: ["fixtures", "fixture"],
};

const PRICE_KEYWORDS =
    /\b(harga|price|rate|cost|dollars?|usd|bucks|rupiah|ribu|juta|borongan|per|each|total)\b/i;

function spokenUnitsIn(text) {
    const found = new Set();
    const phrases = Object.entries(SPOKEN_UNITS)
        .flatMap(([unit, words]) => words.map((word) => [word, unit]))
        .sort((a, b) => b[0].length - a[0].length);
    for (const [phrase, unit] of phrases) {
        if (new RegExp(`\\b${phrase}\\b`, "i").test(text)) found.add(unit);
    }
    return found;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function jsonFilesIn(dir) {
    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort();
}

function loadAll(dir) {
    return jsonFilesIn(dir).map((name) => ({
        file: path.join(dir, name),
        name,
        data: readJson(path.join(dir, name)),
    }));
}

// ---------------------------------------------------------------------------
// A small JSON Schema checker: only the keywords used in contracts/*.schema.json.
// ---------------------------------------------------------------------------

const ALLOWED_KEYWORDS = new Set([
    "$schema",
    "$id",
    "title",
    "description",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "pattern",
    "minLength",
    "minimum",
    "exclusiveMinimum",
    "minItems",
]);
const ALLOWED_TYPES = new Set([
    "object",
    "array",
    "string",
    "number",
    "integer",
    "boolean",
    "null",
]);

function typeOf(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "number")
        return Number.isInteger(value) ? "integer" : "number";
    return typeof value;
}

function typeMatches(expected, value) {
    const actual = typeOf(value);
    if (expected === "number")
        return actual === "number" || actual === "integer";
    return expected === actual;
}

/** Structural rules every schema node must satisfy. Returns problems. */
function schemaProblems(node, pointer, problems) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
        problems.push(`${pointer}: schema node is not an object`);
        return problems;
    }
    for (const key of Object.keys(node)) {
        if (!ALLOWED_KEYWORDS.has(key)) {
            problems.push(
                `${pointer}: keyword "${key}" is not implemented by this checker — add it or stop using it`
            );
        }
    }
    if (!node.type) problems.push(`${pointer}: missing "type"`);
    const types = Array.isArray(node.type) ? node.type : [node.type];
    for (const type of types) {
        if (!ALLOWED_TYPES.has(type))
            problems.push(`${pointer}: unknown type "${type}"`);
    }
    if (types.includes("object")) {
        if (node.additionalProperties !== false) {
            problems.push(
                `${pointer}: object must set "additionalProperties": false`
            );
        }
        const props = Object.keys(node.properties ?? {});
        const required = node.required ?? [];
        if (props.length === 0)
            problems.push(`${pointer}: object has no properties`);
        for (const prop of props) {
            if (!required.includes(prop)) {
                problems.push(
                    `${pointer}: property "${prop}" is missing from "required"`
                );
            }
        }
        for (const name of required) {
            if (!props.includes(name)) {
                problems.push(
                    `${pointer}: "required" lists unknown property "${name}"`
                );
            }
        }
        for (const [name, child] of Object.entries(node.properties ?? {})) {
            schemaProblems(child, `${pointer}.properties.${name}`, problems);
        }
    }
    if (types.includes("array")) {
        if (!node.items)
            problems.push(`${pointer}: array must declare "items"`);
        else schemaProblems(node.items, `${pointer}.items`, problems);
    }
    if (node.enum) {
        if (!Array.isArray(node.enum) || node.enum.length === 0) {
            problems.push(`${pointer}: "enum" must be a non-empty array`);
        }
    }
    if (node.pattern) {
        try {
            new RegExp(node.pattern);
        } catch {
            problems.push(
                `${pointer}: "pattern" is not a valid regular expression`
            );
        }
    }
    return problems;
}

function collectRefs(node, pointer, refs) {
    if (node === null || typeof node !== "object") return refs;
    for (const [key, value] of Object.entries(node)) {
        if (key === "$ref") refs.push(pointer);
        else collectRefs(value, `${pointer}.${key}`, refs);
    }
    return refs;
}

/** Validates a value against one schema node. Returns a list of problems. */
function valueProblems(schema, value, pointer, problems) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
        problems.push(
            `${pointer}: expected ${types.join("|")}, got ${typeOf(value)}`
        );
        return problems;
    }
    if (schema.enum && !schema.enum.includes(value)) {
        problems.push(
            `${pointer}: "${value}" is not one of ${schema.enum.join(", ")}`
        );
    }
    if (typeof value === "string") {
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
            problems.push(
                `${pointer}: "${value}" does not match ${schema.pattern}`
            );
        }
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            problems.push(
                `${pointer}: shorter than minLength ${schema.minLength}`
            );
        }
    }
    if (typeof value === "number") {
        if (schema.minimum !== undefined && value < schema.minimum) {
            problems.push(
                `${pointer}: ${value} is below minimum ${schema.minimum}`
            );
        }
        if (
            schema.exclusiveMinimum !== undefined &&
            value <= schema.exclusiveMinimum
        ) {
            problems.push(
                `${pointer}: ${value} is not above exclusiveMinimum ${schema.exclusiveMinimum}`
            );
        }
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            problems.push(`${pointer}: fewer than minItems ${schema.minItems}`);
        }
        if (schema.items) {
            value.forEach((entry, index) =>
                valueProblems(
                    schema.items,
                    entry,
                    `${pointer}[${index}]`,
                    problems
                )
            );
        }
    }
    if (typeOf(value) === "object") {
        for (const name of schema.required ?? []) {
            if (!(name in value))
                problems.push(`${pointer}: missing required "${name}"`);
        }
        for (const [name, entry] of Object.entries(value)) {
            const child = schema.properties?.[name];
            if (!child) {
                if (schema.additionalProperties === false) {
                    problems.push(`${pointer}: unexpected property "${name}"`);
                }
                continue;
            }
            valueProblems(child, entry, `${pointer}.${name}`, problems);
        }
    }
    return problems;
}

function loadSchema(name) {
    return readJson(path.join(here, name));
}

// ---------------------------------------------------------------------------
// Schemas (K2)
// ---------------------------------------------------------------------------

for (const [document, file] of Object.entries(DOCUMENT_SCHEMAS)) {
    test(`schema ${file} is strict and non-recursive (${document})`, () => {
        const schema = loadSchema(file);
        const problems = schemaProblems(schema, "$", []);
        assert.deepEqual(problems, [], problems.join("\n"));
        assert.deepEqual(
            collectRefs(schema, "$", []),
            [],
            "schemas must not use $ref"
        );
    });
}

test("quotation schema accepts en/USD and id/IDR documents", () => {
    const schema = loadSchema(DOCUMENT_SCHEMAS.quotation);
    const valid = loadAll(validDir);
    assert.ok(
        valid.length > 0,
        "no valid fixtures to check the schema against"
    );
    for (const { name, data } of valid) {
        const problems = valueProblems(
            schema,
            data.expected_document,
            name,
            []
        );
        assert.deepEqual(problems, [], `${name}\n${problems.join("\n")}`);
    }
});

// ---------------------------------------------------------------------------
// Fixtures (K4): valid set
// ---------------------------------------------------------------------------

const validFixtures = loadAll(validDir);
const defectiveFixtures = loadAll(defectiveDir);

test("fixtures/transcripts has at least 30 cases, both locales well covered", () => {
    assert.ok(
        validFixtures.length >= 30,
        `only ${validFixtures.length} valid fixtures`
    );
    const byLocale = validFixtures.reduce((counts, { data }) => {
        counts[data.locale] = (counts[data.locale] ?? 0) + 1;
        return counts;
    }, {});
    assert.ok(
        (byLocale.en ?? 0) >= 12,
        `only ${byLocale.en ?? 0} English fixtures`
    );
    assert.ok(
        (byLocale.id ?? 0) >= 12,
        `only ${byLocale.id ?? 0} Indonesian fixtures`
    );
});

test("fixture ids and session ids are unique", () => {
    const ids = [...validFixtures, ...defectiveFixtures].map(
        ({ data }) => data.id
    );
    assert.equal(new Set(ids).size, ids.length, "duplicate fixture id");
});

test("every valid fixture has turns that a server can consume as K3 turns", () => {
    for (const { name, data } of validFixtures) {
        assert.ok(
            Array.isArray(data.turns) && data.turns.length >= 2,
            `${name}: needs ≥2 turns`
        );
        let previousEnd = -1;
        data.turns.forEach((turn, index) => {
            assert.equal(
                turn.turn_id,
                `turn_${index + 1}`,
                `${name}: turn ids must be turn_1..turn_N`
            );
            assert.equal(
                turn.final,
                true,
                `${name}/${turn.turn_id}: fixtures must be final turns`
            );
            assert.ok(
                turn.transcript.trim().length > 0,
                `${name}/${turn.turn_id}: empty transcript`
            );
            assert.ok(
                Number.isInteger(turn.startMs) && turn.startMs >= previousEnd,
                `${name}/${turn.turn_id}: startMs overlaps the previous turn`
            );
            assert.ok(
                Number.isInteger(turn.endMs) && turn.endMs > turn.startMs,
                `${name}/${turn.turn_id}: endMs must be after startMs`
            );
            previousEnd = turn.endMs;
        });
    }
});

test("every reference document is internally consistent and traceable", () => {
    for (const { name, data } of validFixtures) {
        const doc = data.expected_document;
        const where = `${name}:`;
        const turnIds = new Set(data.turns.map((turn) => turn.turn_id));

        assert.equal(
            doc.locale,
            data.locale,
            `${where} locale must match the fixture`
        );
        assert.equal(
            doc.mata_uang,
            data.locale === "en" ? "USD" : "IDR",
            `${where} currency must follow the locale`
        );
        assert.equal(
            doc.jenis,
            "surat_penawaran",
            `${where} wrong document type`
        );
        assert.match(
            doc.nomor,
            NOMOR_PATTERN,
            `${where} document number must be server-shaped`
        );
        assert.ok(
            !data.turns.some((turn) => turn.transcript.includes(doc.nomor)),
            `${where} the document number is server-made, so it cannot be spoken`
        );
        assert.deepEqual(
            doc.proyek,
            data.project,
            `${where} project must match the fixture input`
        );
        assert.deepEqual(
            doc.butuh_konfirmasi,
            [],
            `${where} a clean fixture asks nothing`
        );

        let total = 0;
        doc.pekerjaan.forEach((item, index) => {
            assert.ok(
                turnIds.has(item.sumber_kutipan),
                `${where} pekerjaan[${index}] cites ${item.sumber_kutipan}, which is not in the fixture`
            );
            assert.equal(
                item.jumlah,
                item.volume * item.harga_satuan,
                `${where} pekerjaan[${index}]: jumlah must be volume × harga_satuan`
            );
            total += item.jumlah;
        });
        assert.equal(
            doc.total_nominal,
            total,
            `${where} total_nominal must be the sum of jumlah`
        );
        assert.match(
            doc.terbilang,
            data.locale === "en" ? /dollars?$/i : /rupiah$/i,
            `${where} terbilang must end in the locale's currency`
        );
    }
});

// ---------------------------------------------------------------------------
// Fixtures (K4): deliberately defective set
// ---------------------------------------------------------------------------

test("fixtures/defective has at least 10 cases covering every frozen defect class", () => {
    assert.ok(
        defectiveFixtures.length >= 10,
        `only ${defectiveFixtures.length} defective fixtures`
    );
    const codes = new Set(
        defectiveFixtures.map(({ data }) => data.cacat?.code)
    );
    for (const code of FROZEN_DEFECT_CODES) {
        assert.ok(codes.has(code), `no defective fixture exercises "${code}"`);
    }
});

test("every defective fixture names a known defect, with written reason and evidence", () => {
    for (const { name, data } of defectiveFixtures) {
        const where = `${name}:`;
        assert.ok(
            ALL_DEFECT_CODES.includes(data.cacat?.code),
            `${where} unknown defect code`
        );
        assert.ok(
            typeof data.cacat.alasan === "string" &&
                data.cacat.alasan.length >= 20,
            `${where} the defect reason must be written out, not just named`
        );
        assert.ok(
            data.cacat.bukti?.length > 0,
            `${where} the defect needs quoted evidence`
        );
        assert.ok(
            VERDICTS.includes(data.expectation?.verdict),
            `${where} unknown expected verdict`
        );
        assert.ok(
            data.expectation?.field?.length > 0,
            `${where} the expectation needs a field`
        );
    }
});

test("every defective fixture still validates against the schema (the guard, not the schema, catches it)", () => {
    const schema = loadSchema(DOCUMENT_SCHEMAS.quotation);
    for (const { name, data } of defectiveFixtures) {
        const problems = valueProblems(schema, data.document, name, []);
        assert.deepEqual(problems, [], `${name}\n${problems.join("\n")}`);
    }
});

test("the named defect is actually present in the fixture data", () => {
    for (const { name, data } of defectiveFixtures) {
        const where = `${name}:`;
        const doc = data.document;
        const texts = data.turns.map((turn) => turn.transcript);
        const turnById = new Map(
            data.turns.map((turn) => [turn.turn_id, turn])
        );
        const cited = doc.pekerjaan.map((item) => item.sumber_kutipan);
        const spokenText = texts.join(" \n ");
        const item = doc.pekerjaan[0];

        switch (data.cacat.code) {
            case "harga_lolos_sebagai_volume": {
                assert.match(
                    data.cacat.bukti,
                    PRICE_KEYWORDS,
                    `${where} evidence has no price word`
                );
                assert.equal(
                    spokenUnitsIn(data.cacat.bukti).size,
                    0,
                    `${where} evidence must be a price phrase with no unit`
                );
                break;
            }
            case "satuan_salah": {
                const spoken = spokenUnitsIn(data.cacat.bukti);
                assert.ok(
                    spoken.size > 0,
                    `${where} evidence must speak a unit`
                );
                assert.ok(
                    !spoken.has(item.satuan),
                    `${where} the spoken unit and the document's "${item.satuan}" must disagree`
                );
                break;
            }
            case "desimal_koma_id": {
                assert.match(
                    spokenText,
                    /\d+,\d+/,
                    `${where} no comma decimal anywhere in the turns`
                );
                break;
            }
            case "ratus_puluh_tertukar": {
                assert.match(
                    data.cacat.bukti,
                    /\b(ratus|puluh)\b/i,
                    `${where} evidence must use a tens word`
                );
                assert.ok(
                    cited.every((id) => turnById.has(id)),
                    `${where} this defect is about wording, not citations`
                );
                break;
            }
            case "kutipan_sesi_lain": {
                assert.ok(
                    cited.some((id) => !turnById.has(id)),
                    `${where} a citation must point outside this session's turns`
                );
                break;
            }
            case "kutipan_non_final": {
                const nonFinal = cited.some(
                    (id) => turnById.get(id)?.final === false
                );
                assert.ok(
                    nonFinal,
                    `${where} a citation must point at a final:false turn`
                );
                break;
            }
            case "twelve_hundred_en": {
                assert.match(
                    data.cacat.bukti,
                    /twelve hundred/i,
                    `${where} evidence must say "twelve hundred"`
                );
                assert.notEqual(
                    item.jumlah,
                    1200,
                    `${where} the document must misread the amount`
                );
                break;
            }
            case "setengah_juta_id": {
                assert.match(
                    data.cacat.bukti,
                    /setengah juta/i,
                    `${where} evidence must say "setengah juta"`
                );
                assert.notEqual(
                    item.jumlah,
                    500000,
                    `${where} the document must misread the amount`
                );
                break;
            }
            case "angka_tidak_ada_di_giliran": {
                assert.ok(
                    !texts.some((text) => /\d/.test(text)),
                    `${where} no turn may contain a digit for this defect`
                );
                break;
            }
            case "jumlah_tidak_cocok": {
                assert.notEqual(
                    item.jumlah,
                    item.volume * item.harga_satuan,
                    `${where} jumlah must disagree with volume × harga_satuan`
                );
                break;
            }
            case "total_tidak_cocok": {
                const sum = doc.pekerjaan.reduce(
                    (running, entry) => running + entry.jumlah,
                    0
                );
                assert.notEqual(
                    doc.total_nominal,
                    sum,
                    `${where} total_nominal must disagree with the sum`
                );
                break;
            }
            case "satuan_hilang": {
                assert.equal(
                    spokenUnitsIn(spokenText).size,
                    0,
                    `${where} no unit may be spoken anywhere in the turns`
                );
                break;
            }
            default:
                assert.fail(
                    `${where} no presence check for code ${data.cacat.code}`
                );
        }
    }
});

test("defective citations that are meant to be valid still point at final turns", () => {
    for (const { name, data } of defectiveFixtures) {
        if (
            ["kutipan_sesi_lain", "kutipan_non_final"].includes(data.cacat.code)
        )
            continue;
        const turnById = new Map(
            data.turns.map((turn) => [turn.turn_id, turn])
        );
        for (const item of data.document.pekerjaan) {
            const turn = turnById.get(item.sumber_kutipan);
            assert.ok(
                turn,
                `${name}: ${item.sumber_kutipan} is not in this fixture`
            );
            assert.equal(
                turn.final,
                true,
                `${name}: ${item.sumber_kutipan} must be a final turn`
            );
        }
    }
});
