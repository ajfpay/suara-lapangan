import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

// `pg` is the app's own PostgreSQL driver; using it keeps row reads typed
// instead of parsing psql's text output.
import { Pool } from "pg";

/**
 * A session id for one run, matching the app's `^[A-Za-z0-9_-]{1,64}$`.
 *
 * Unique per run on purpose: a fixed id would let a row seeded by hand satisfy
 * the route's store lookup, which is exactly the hidden dependency the full
 * chain must not have. Every run creates its own session, document and PDF,
 * so two runs never share a document number.
 */
export function uniqueSessionId(prefix: string): string {
    const run = `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    return `${prefix}-${run}`;
}

function sqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Runs one SQL statement through the app's own `pg` pool. Replacing a
 * `psql` subprocess with the driver the app itself uses removes a binary the
 * repository never declares as a requirement, and keeps URL handling identical
 * to the app's.
 */
export async function runSql(sql: string): Promise<void> {
    await withDb(async (pool) => {
        await pool.query(sql);
    });
}

/**
 * A session whose turns are deterministic and contain exactly one defective
 * value: the first turn is clean, the second omits the quantity ("square
 * feet") so the guard flags `pekerjaan[1].volume` for confirmation. This is
 * the shape the pipeline relies on: creation returns one confirmation, which
 * the test resolves, after which the document is `siap` and downloadable.
 */
export const SEEDED_TURNS = [
    {
        startMs: 0,
        endMs: 5200,
        transcript:
            "Drywall for the living room, twenty-four square feet at twenty-five dollars a square foot.",
    },
    {
        startMs: 5400,
        endMs: 8200,
        transcript:
            "Drywall for the living room, square feet at twenty-five dollars per square foot.",
    },
] as const;

/**
 * Creates one session and its turns the way `saveTranscription` in
 * `lib/server/db/store.ts` writes them: one session row plus one row per turn,
 * `turn_index` counting from 1, because `turn_N` is what a document cites.
 * The session row is all the POST /api/documents route reads (`findSession`),
 * so the rest of the chain runs against the real routes.
 */
export async function seedSession(sessionId: string): Promise<void> {
    const transcript = SEEDED_TURNS.map((turn) => turn.transcript).join(" ");
    const turns = SEEDED_TURNS.map(
        (turn, index) =>
            `(${sqlLiteral(sessionId)}, ${index + 1}, ${turn.startMs}, ${turn.endMs}, ${sqlLiteral(turn.transcript)}, true)`
    ).join(",\n            ");

    await runSql(`
        insert into sessions
            (id, locale, audio_sha256, audio_bytes, meta_session_id, transcript, audio_duration_ms, updated_at)
        values
            (${sqlLiteral(sessionId)}, 'en', ${sqlLiteral(`e2e-${sessionId}`)}, 32044, 'e2e-seeded', ${sqlLiteral(transcript)}, 8200, now());

        insert into turns (session_id, turn_index, start_ms, end_ms, transcript, final)
        values
            ${turns};
    `);
}

/**
 * Removes the seeded session; its turns and documents go with it (cascade).
 * The PDF route writes `{documentId}.pdf` (+ `.hash` sidecar) into
 * `PDF_STORAGE_DIR`, so those artifacts are removed too — a teardown must
 * leave no traces behind, in the database or on disk.
 */
export async function deleteSession(sessionId: string): Promise<void> {
    const docRows = await query<{ id: string }>(
        "select id from documents where session_id = $1",
        [sessionId]
    );
    await runSql(`delete from sessions where id = ${sqlLiteral(sessionId)};`);

    const storageDir = process.env.PDF_STORAGE_DIR;
    if (!storageDir || docRows.length === 0) return;

    for (const doc of docRows) {
        for (const suffix of ["", ".hash"]) {
            await rm(path.resolve(storageDir, `${doc.id}.pdf${suffix}`), {
                force: true,
            });
        }
    }
}

/**
 * Runs one query and returns its rows. A single shared pool is created lazily
 * so the helper can be used by every test without opening a connection per
 * call.
 */
let dbPool: Pool | null = null;

export function withDb<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required for DB assertions");
    }
    if (!dbPool) {
        dbPool = new Pool({ connectionString });
    }
    return fn(dbPool);
}

export async function query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
): Promise<T[]> {
    return withDb(async (pool) => {
        const result = await pool.query<T>(sql, params);
        return result.rows;
    });
}

/** Safer concurrency: borrows a client so transaction-scoped reads are possible. */
/**
 * Validates the stored document row for a session against the document-pipeline
 * contract (ticket 01–06) at the database level.
 *
 * Checks:
 * - exactly one `documents` row for the session;
 * - status is one of the allowed set;
 * - locale is `en` or `id`;
 * - `nomor` matches `SL/QTN/YYYY/NNNN`;
 * - `turns_hash` is non-empty;
 * - `data_json` is a complete Quotation document: `nomor` equals the row's
 *   `nomor`, `total_nominal` is a non-negative number, `pekerjaan` is
 *   non-empty; when `expectConfirmed` is true, `butuh_konfirmasi` must be
 *   empty (a freshly created document still holds its unconfirmed fields);
 * - `pdf_path` is set and the file exists on disk (only when `expectPdf` is
 *   true — a document that was created but never rendered has no PDF yet, and
 *   `pdf_path` NULL is then the valid state);
 * - the document's `session_id` references the session row, and the session's
 *   turns exist (each `turn_N` cited by the document resolves).
 *
 * Returns the row and parsed `data_json` so the caller can assert on specifics.
 */
export async function assertStoredDocument(
    sessionId: string,
    options: { expectPdf?: boolean; expectConfirmed?: boolean } = {}
) {
    const docRows = await query<
        Record<string, unknown> & {
            id: string;
            session_id: string;
            locale: string;
            nomor: string;
            status: string;
            turns_hash: string;
            pdf_path: string | null;
            data_json: string;
            created_at: string;
        }
    >("select * from documents where session_id = $1", [sessionId]);

    expect(docRows, "exactly one stored document per session").toHaveLength(1);
    const doc = docRows[0]!;

    expect(doc.status).toMatch(/^(perlu_konfirmasi|siap|terkirim)$/);
    expect(doc.locale).toMatch(/^(en|id)$/);
    expect(doc.nomor).toMatch(/^SL\/QTN\/\d{4}\/\d{4}$/);
    expect(doc.turns_hash).toBeTruthy();
    if (options.expectPdf) {
        expect(doc.pdf_path).toBeTruthy();

        const storageDir = process.env.PDF_STORAGE_DIR;
        expect(
            storageDir,
            "PDF_STORAGE_DIR must be set for disk checks"
        ).toBeTruthy();
        const resolved = `${storageDir}/${doc.pdf_path}`;
        expect(
            existsSync(resolved),
            `pdf_path '${doc.pdf_path}' must exist on disk at ${resolved}`
        ).toBe(true);
    }

    // `pg` returns jsonb columns already parsed; guard for a string payload
    // (psql-style reads) as well.
    const data = (typeof doc.data_json === "string"
        ? JSON.parse(doc.data_json)
        : doc.data_json) as {
        nomor: string;
        locale: string;
        butuh_konfirmasi: unknown[];
        total_nominal: number;
        pekerjaan: unknown[];
        tanggal: string;
        proyek: { nama: string; lokasi: string; klien: string };
    };
    expect(data.nomor).toBe(doc.nomor);
    expect(data.locale).toBe(doc.locale);
    if (options.expectConfirmed) {
        expect(data.butuh_konfirmasi).toEqual([]);
    }
    expect(typeof data.total_nominal).toBe("number");
    expect(data.total_nominal).toBeGreaterThanOrEqual(0);
    expect(data.pekerjaan.length).toBeGreaterThan(0);
    expect(data.tanggal).toBeTruthy();
    expect(data.proyek.nama).toBeTruthy();
    expect(data.proyek.lokasi).toBeTruthy();
    expect(data.proyek.klien).toBeTruthy();

    // Every cited turn_N must resolve to a stored turn for the session.
    for (const item of data.pekerjaan as { sumber_kutipan?: string }[]) {
        if (!item.sumber_kutipan) continue;
        const match = item.sumber_kutipan.match(/turn_(\d+)/);
        if (!match) continue;
        const turnRows = await query(
            "select 1 from turns where session_id = $1 and turn_index = $2",
            [sessionId, Number(match[1])]
        );
        expect(turnRows, `cited ${item.sumber_kutipan} must exist`).toHaveLength(
            1
        );
    }

    // The session row itself must exist and carry the turns the document cites.
    const sessionRows = await query(
        "select id from sessions where id = $1",
        [sessionId]
    );
    expect(sessionRows, "session row must exist").toHaveLength(1);

    return { row: doc, data };
}

/**
 * Shared tripwires for the smoke suite.
 *
 * Ported from the invoify originals so the checks that are still meaningful —
 * "the page rendered", "nothing logged an error", "nothing overflows" — keep
 * the same strictness on the new screens.
 */

/**
 * Requests that legitimately fail outside a Vercel deployment.
 *
 * The analytics script is injected by @vercel/analytics and is only served by
 * Vercel's edge, so it 404s on any local or CI run. Allow-listing it by URL
 * keeps the assertion strict about everything else, rather than the easier and
 * much worse option of ignoring 404s in general.
 */
const EXPECTED_FAILING_REQUESTS = [/\/_vercel\/insights\//];

/**
 * Records console errors, page errors and failed requests into `problems`.
 *
 * A render loop would show up here as "Maximum update depth exceeded" while
 * the page still serves HTML, so an HTTP-level check on its own misses it.
 *
 * "Failed to load resource" console messages are dropped because the browser
 * reports them without a URL — the network listener below catches the same
 * failures and can say which request it was.
 */
export function collectProblems(page: Page, problems: string[]) {
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (text.includes("Failed to load resource")) return;
        problems.push(`console: ${text}`);
    });

    page.on("pageerror", (err) => problems.push(`pageerror: ${err}`));

    page.on("response", (res) => {
        if (res.status() < 400) return;
        const url = res.url();
        if (EXPECTED_FAILING_REQUESTS.some((re) => re.test(url))) return;
        problems.push(`http ${res.status()}: ${url}`);
    });
}

/**
 * Elements wider than the viewport, in document coordinates.
 *
 * Fixed and sticky elements are reported once rather than twice, and the
 * `html`/`body` pair is skipped because the viewport is what they measure.
 */
export async function horizontalOverflow(page: Page) {
    return page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const offenders: { tag: string; id: string; right: number }[] = [];

        for (const el of Array.from(document.querySelectorAll("body *"))) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            if (rect.right > width + 1) {
                offenders.push({
                    tag: el.tagName.toLowerCase(),
                    id: (el as HTMLElement).id || (el.textContent ?? "").slice(0, 40),
                    right: Math.round(rect.right),
                });
            }
        }

        // One report per overflowing subtree root, not per descendant.
        return offenders.filter(
            (o, i) => i === 0 || offenders[i - 1].right < o.right
        );
    });
}

/** Asserts the page fits the viewport horizontally. */
export async function expectNoOverflow(page: Page, label: string) {
    const offenders = await horizontalOverflow(page);
    expect(offenders, `${label} overflows: ${JSON.stringify(offenders, null, 2)}`).toEqual(
        []
    );
}

/** Reads the JSON-LD blocks a page emitted. */
export function jsonLdBlocks(html: string): Record<string, unknown>[] {
    return [
        ...html.matchAll(
            /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs
        ),
    ].map((m) => JSON.parse(m[1]));
}

/** Strips markup so prose length can be asserted. */
export function visibleText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script[^>]*>/gi, " ")
        .replace(/<style[\s\S]*?<\/style[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
