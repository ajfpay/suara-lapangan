# B — Uji Celah Guard Angka (ADR-0002)

**Tanggal:** 28 Oktober 2026 · **Penguji:** penilai data/keandalan · **Acuan:** ADR-0002, `01-ARSITEKTUR.md` §3.2–§3.3, `05-RISIKO.md` K3 & B4.

**Cara membaca.** "*Lolos*" = angka yang salah ikut tercetak di dokumen siap kirim. "*Tembus*" = angka yang salah berhasil dihentikan guard (masuk `butuh_konfirmasi`). Aturan ADR-0002 hari ini: normalisasi kata-angka → cek angka ada di transkrip giliran yang **dikutip** → kalau tidak ada, tahan. Kolom "aturannya sekarang?" menilai apakah ADR-0002 saja cukup.

## 1) Uji celah dengan contoh konkret

| # | Ucapan asli | Transkripsi | Angka di dokumen | Lolos/Tembus | Aturannya sekarang? | Aturan perbaikan (1 baris) |
|---|---|---|---|---|---|---|
| 1 | "dua puluh empat meter persegi" | "dua puluh empat meter persegi" | `volume: 24`, `satuan: "m2"` | **Lolos (benar)** | Ya | Satuan `m2` harus ada padanan kata ("meter persegi"/"persegi"/"m2") di giliran, bukan cuma angkanya. |
| 2 | "dua puluh empat meter" (tepi pagar) | "dua puluh empat meter" | `volume: 24`, `satuan: "m2"` | **Lolos (salah satuan)** | **Tidak** | `satuan` ikut diperiksa: beda satuan = tahan ke konfirmasi, walaupun angkanya cocok. |
| 3 | "sembilan ratus ribu" | "sembilan ratus ribu" | `900.000` (`harga_satuan`) | **Lolos (benar)** | Ya | — |
| 4 | "sembilan ratus ribu" | "900 ribu" (ASR menulis angka) | `900.000` | **Lolos (benar)** | **Tidak pasti** — ADR hanya menyebut kata→digit; digit→nilai tidak menutup "ribu" | Normalisasi dua arah: `"N ribu"`/`"N juta"`/`"N rb"` → nilai penuh, dan sebaliknya. |
| 5 | "2,5 juta" | "2,5 juta" | `2.500.000` | **Lolos (benar)** | **Tidak** — koma desimal Indonesia tidak ditangani, parser baca "2,5" gagal atau jadi "25" | Paksa `,` = tanda desimal → `2,5`; jangan pakai `parseInt`/`parseFloat` mentah. |
| 6 | "dua koma lima juta" | "2.5 juta" (ASR titik) | `2.500.000` | **Lolos (benar)** | **Tidak** — `2.5` dibaca 25 juta (salah 10×) atau 2 juta | Titik + 1–2 digit di belakang = desimal, dan bandingkan nilai akhir, bukan teks mentah. |
| 7 | "dua koma lima juta" | "dua koma lima juta" | `2.500.000` | **Lolos (benar)** | **Tidak** — kata "koma" tidak dijadikan pecahan | Kata "koma" → `,` sebelum normalisasi. |
| 8 | "panjang enam meter, lebar empat meter" | "panjang enam meter lebar empat" | `volume: 24` (6×4) | **Lolos (benar)** | **Tidak, tapi aman** — 24 tidak ada di transkrip → sebenarnya **tembus** jadi konfirmasi, padahal hitungannya sah | Tandai field `hasil_hitung` + simpan `dasar: [6, 4]`; hitung ulang di server, bukan percaya angka model. |
| 9 | "panjang enam, lebar empat" (volume otomatis) | "panjang enam lebar empat" | `volume: 42` (digit tertukar) | **Lolos (salah)** | **Ya** kalau 42 tidak ada di transkrip; **Tembus**, tapi tertahan sebagai "angka tidak ada" bukan "salah rumus" | Hitung sendiri dari `dasar` dan tolak bila `dasar[0]*dasar[1] ≠ volume`. |
| 10 | "enam tambah empat" (dimensi sudah diucapkan **di giliran lain**, turn_5) | "enam tambah empat" | `volume: 24`, `sumber_kutipan: "turn_5"` | **Lolos (salah)** | **Tidak** jika guard hanya cek "angka ada di salah satu giliran sesi" | Kutipan harus menunjuk giliran yang sama untuk **semua** `dasar` hitungan; giliran beda = konfirmasi. |
| 11 | "proyek tetangga kemarin dua puluh empat meter" (turn_8, proyek lain, 5 menit lalu) | teks apa adanya | `volume: 24`, `sumber_kutipan: alfabetis "turn_8"` | **Lolos (salah)** | **Tidak** | `turnId` dibatasi ke sesi+dokumen ini, dan giliran proyek lain diabaikan walaupun angkanya cocok. |
| 12 | "harga semen sembilan ratus ribu per sak" | "harga semen sembilan ratus ribu per sak" | `volume: 900.000`, `satuan: "m2"` | **Lolos (salah field)** | **Tidak** — angka ada di giliran, tapi milik field harga | Wajib `sumber_kutipan` **per field** + cek kata kunci field (`harga`, `volume`, `jumlah`) di sekitar angka (±6 kata) di giliran itu. |
| 13 | "dua puluh empat" untuk plester, "delapan" untuk keramik (satu giliran) | "plester dua puluh empat, keramik delapan" | `volume keramik: 24` | **Lolos (salah)** | **Tidak** — angka ada di giliran, tapi milik pekerjaan lain | Angka harus berada dalam jendela uraian yang sama, bukan sekadar giliran yang sama. |
| 14 | "harganya dua ratus lima puluh per meter" (ragu) | "harganya dua ratus lima puluh per meter" | `harga: 250` | **Lolos (bahaya)** | **Ya, sebagian** — benar secara transkrip, tetapi pekerja mungkin maksud 250 ribu | Satuan uang (`per meter`, `ribu`, `juta`) wajib eksplisit; tanpa satuan uang = konfirmasi. |

**Kesimpulan §1:** ADR-0002 menutup kasus "angka tidak ada sama sekali" (#9), tetapi **bolong** pada: satuan (#2), format desimal Indonesia (#5–#7), angka turunan hitungan (#8–#9), kesetiaan giliran (#10–#11), **field vs angka** (#12–#13), dan satuan uang (#14). Celah paling berbahaya untuk premis "angka uang tidak boleh dikarang" adalah **#12** (harga jadi volume) karena lolos sebagai "bersumber" sehingga terbaca sah.

## 2) Pseudokode guard (bisa jadi ≤ 1 hari kerja)

```ts
const FIELD_KEY = { harga: /harga|rupiah|rp|biaya/i, volume: /volume|luas|meter|m2|m3|panjang|lebar/i,
                    jumlah: /jumlah|sak|batang|zak|karung|kg|buah/i };

function kataAngka(teks: string) { /* "dua puluh empat"→24, "enam"→6, "sembilan ratus ribu"
                                      →900000, "koma"→"," — gabungkan parser ID + EN */ }
function keNilai(s: string) { s = s.replace(/\.(?=\d{3}\b)/g,'').replace(',', '.'); // 2,5 juta, 900.000
  const m = s.match(/(\d+(?:\.\d+)?)\s*(juta|jt|ribu|rb)?/i); if(!m) return null;
  return +m[1] * (/juta|jt/i.test(m[2]||'') ? 1e6 : /ribu|rb/i.test(m[2]||'') ? 1e3 : 1); }

function guard(doc, sesi) {                        // sesi: giliran final dokumen ini, < 60 menit
  const masalah = [];
  for (const f of fieldBerangka(doc)) {            // {path, nilai, satuan, sumber_kutipan, dasar?}
    const t = sesi.finalTurn(f.turnId);            // hanya giliran final milik sesi ini
    if (!t || t.tidak_final || t.mulai < sesi.batas60) { masalah.push([f.path,'giliran tidak sah']); continue; }
    const angka = [...t.teks.matchAll(/\d+(?:[.,]\d+)*/g)].map(m=>m[0])
                  .concat([...t.teks.matchAll(/[a-z\u00e0-\u024f ]{3,}/gi)].flatMap(makeNumWords))
                  .map(keNilai).filter(v=>v!=null);
    if (f.dasar) { const h = f.dasar.reduce((a,b)=>a*b,1);   // hasil hitung: server yang menghitung
                   if (Math.abs(h - f.nilai)/f.nilai > 0.001) masalah.push([f.path,'hasil hitung salah']);
                   f.dasar.forEach((d,i)=>{ if(!angka.some(a=>Math.abs(a-d)<0.01 || Math.abs(a-d*1e3)<0.01)) masalah.push([f.path,'dasar tidak diucapkan']);});
                   continue; }
    const kataField = FIELD_KEY[f.pathType]; const jendela = t.teks.split(/[,.;]/);  // pecah per uraian
    const sah = jendela.some(j => kataField?.test(j) && angka.some(a=>Math.abs(a-f.nilai)/Math.max(f.nilai,1)<0.001)
                             && satuanCocok(j, f.satuan));
    if (!sah) masalah.push([f.path, 'angka tidak cocok dengan ucapan/satuan/field']);
  }
  if (masalah.length) doc.butuh_konfirmasi = masalah;   // dokumen tetap `perlu_konfirmasi`
  return doc;
}
```

*(±22 baris; parser kata-angka ID/EN adalah satu-satunya bagian yang makan waktu, sisanya lookup + regex. Hadirkan `dasar` sebagai field opsional di skema JSON Spark 1.3.)*

## 3) Kutipan turnId — aturan per baris

- Giliran `partial` (belum `speechComplete`) **tidak boleh dijadikan `sumber_kutipan`**: field langsung masuk `butuh_konfirmasi` dan dokumen tidak boleh naik ke `siap` sampai giliran finalnya tiba (ADR: `transcript` parsial memang tanpa `turnId` — jika ada `turnId` parsial, tetap dianggap tidak sah).
- Giliran dari **sesi lain** lebih dari 60 menit (sambungan S2) hanya sah untuk dokumen yang eksplisit menyambung sesi itu, dan harus lolos penanda jahitan (no-turn yang tumpang tindih ditolak).
- Giliran dari proyek lain, sesi lain tanpa sambungan, atau milik dokumen lain **selalu ditolak** — angkanya sama pun tidak sah.
- Setiap `turnId` harus ada di tabel `turns` dengan `final = true` dan `session_id` = sesi dokumen; kalau tidak, tahan, jangan "tebak ulang".
- Nominal uang baru sah hanya jika gilirannya mengandung penanda uang (`ribu`, `juta`, `rupiah`, `rp`) atau proyek punya tarif yang dipakai dengan satuan yang sama.

## 4) Skenario bukti audit < 15 detik (untuk juri)

1. Mikrofon: **"Pasang keramik kamar mandi, harganya sembilan ratus ribu."** *(3 detik)*
2. Model (sengaja salah, demo di layar) mengisi `volume: 900.000 m2`, `sumber_kutipan: turn_4`.
3. Layar menahan dokumen: **"Angka 900.000 ada di turn_4, tapi itu kata 'harga', bukan 'volume'. Isi volume keramik (m2)?"**
4. Juri mengetik **"3 m2"** → giliran baru `turn_5` dicatat, dokumen baru boleh _siap_ setelah konfirmasi **"harga tetap Rp900.000?"**.

**Yang ditonton:** dokumen **tidak** siap kirim, angka tidak berpindah field, dan setiap angka tersambung ke giliran bicara yang bisa diputar ulang (klik `turn_4` → audio 2 detik).

## 5) Putusan

**[RISIKO]** — ADR-0002 sudah benar arahnya (0 angka tanpa sumber bisa dicapai), tetapi aturan "angka ada di giliran yang dikutip" saja **belum cukup**: tanpa cek satuan, field vs angka, desimal koma Indonesia, dan hitungan turunan, harga bisa muncul sebagai volume; guard di §2 wajib masuk Gate 2 sebelum kode dokumen dibekukan, karena kelalaian ini bisa membuat klaim "0 kasus angka tanpa sumber" terlihat benar saat tidak.
