// world.js — layout & gambar kantor Azimuth (top-down, canvas 1000×640).
// REFACTOR 2026-10-11 (permintaan operator): dunia lama (1440×900 — kantor pribadi
// DECIDER, ruang meeting, ruang server, open-area, pantry, teras + kolam) terlalu
// luas untuk 6 agent → SATU ruangan besar open-plan.
// REVISI KELIMA (keputusan operator 2026-10-12, dari gambar referensi):
// MEJA BUNDAR BESAR di tengah sebagai ruang rapat COUNCIL (6 kursi mengelilingi,
// agent DUDUK di kursi saat kickoff/celebrasi/meeting), kolom meja kerja tetap
// 6 di kiri-kanan, tanaman 2 di sudut bawah. Koridor tengah diganti lintasan
// atas (y150) & bawah (y520) yang memutari meja bundar.
// Semua footprint dihitung ulang & bebas tumpang-tindih:
//   meja   x..x+120 × y+16..y+96   monitor x±(mw/2) × y-14..y+43
//   kursi  cx±36   × y+52..y+124   (cx = x+60)
//   baris y = 66/260/454 → kursi bawah 190/384/578 (dinding 600), koridor
//   antar-baris 56px (h1 y≈218, h2 y≈412) tepat untuk chibi 50px.
// Engine & aset CC0 tetap (port Automation-project). Layer statis dirender sekali
// ke offscreen canvas; per frame hanya animasi ringan (uap kopi, LED rak, layar).

export const W = 1000;
export const H = 640;

// ---------- palet ----------
const C = {
  wall: "#c9ab86", wallDark: "#a98d68", glass: "rgba(210,235,250,0.35)",
  floor: "#f2e7d4", floorLine: "rgba(180,150,110,0.18)",
  desk: "#e2c89a", deskEdge: "#c8a97a", chair: "#8d99ae",
  monitor: "#2b3442", screenOff: "#141a24",
  rack: "#3a4252", rackEdge: "#232936",
  coffee: "#7c4a2d", counter: "#d9c3a5",
  plantPot: "#b5683f", plant: "#3f9d54", plant2: "#57b96b",
};

// ---------- layout ----------
// 6 meja 2 kolom × 3 baris, kolom digeser ke dalam; tengah = meja meeting.
// Lantai dalam = 40..960 × 40..600 (dinding tebal 40 di tepi kanvas).
// REVISI-7 (konsep gambar referensi ke-2 operator, 2026-10-12): KISI LONGGAR
// banyak meja mengisi tengah ruangan — 3 baris × 4 kolom, meja bundar council
// menggantikan 2 slot tengah baris kedua. 10 meja: 6 milik agent + 4 meja
// kosong (DECOR, monitor redup tanpa kursi — seperti di gambar referensi).
export const DESKS = {
  bima:  { x: 136, y: 110, room: "bima" },      // DECIDER — baris 1 kolom kiri
  raka:  { x: 320, y: 110, room: "analisis" },  // ANALYST — baris 1 kolom 2
  sari:  { x: 576, y: 110, room: "eksekusi" },  // MANAGER — baris 1 kolom 3
  bagas: { x: 744, y: 110, room: "server" },    // ROUTER — baris 1 kolom kanan
  maya:  { x: 340, y: 470, room: "eksekusi" },  // AUDITOR — baris 3 kolom 2
  citra: { x: 556, y: 470, room: "analisis" },  // CURATOR — baris 3 kolom 3
};
// meja kosong dekoratif (baris 2 pinggir + baris 3 sudut) — tanpa kursi/node
export const DECOR_DESKS = [
  { x: 136, y: 300 }, { x: 744, y: 300 },
  { x: 136, y: 470 }, { x: 744, y: 470 },
];
export const deskChair = (d) => ({ x: d.x + 60, y: d.y + 102 }); // jangkar duduk di kursi (kursi 64px di bawah meja)

// KURSI meja bundar council (urutan searah jarum jam dari utara) — kickoff,
// celebrasi, dan rapat duduk DI KURSI mengelilingi meja, bukan berdiri.
// dir = arah hadap chibi saat duduk (0=bawah/ke meja dari utara, dst).
export const GATHER_SPOTS = [
  { x: 500, y: 223, dir: 0 },   // utara — menghadap meja (ke bawah)
  { x: 582, y: 270, dir: 2 },   // timur laut — menghadap kiri
  { x: 582, y: 366, dir: 2 },   // tenggara — menghadap kiri
  { x: 500, y: 413, dir: 1 },   // selatan — menghadap meja (ke atas)
  { x: 418, y: 366, dir: 3 },   // barat daya — menghadap kanan
  { x: 418, y: 270, dir: 3 },   // barat laut — menghadap kanan
];

// ---------- graf jalan ----------
// Dua koridor horizontal (celah antar baris meja) + vertikal penghubung.
// Vertikal WAJIB berjarak ≥42px dari kolom meja: chibi 1.45× lebarnya ±32px
// (fix 2026-10-12: rute lama x120/288/712/880 hanya 16px dari tepi meja →
// badan chibi MENEMBUS meja setiap berjalan — inilah "tumpang tindih" yang
// terus dilaporkan operator). Rute aman: x88 (16px dinding/16px meja),
// x304 & x696 (64px dari meja meeting), x912 (16px meja/16px dinding).
export const NODES = {};
function n(id, x, y) { NODES[id] = { id, x, y, adj: new Set() }; }
// Koridor ala kisi: h1 (y236) BELAHAN kiri/kanan (tengah tertutup meja bundar
// y170..330), h2 (y410) menyambung penuh (bawah bundar), vertikal penghubung
// x88 (sisi kiri), x298 & x710 (celah antar kolom meja).
const H1_KIRI = [88, 196, 298], H1_KANAN = [620, 710, 840, 912]; // 298/710 = kaki vertikal
const H2_XS = [88, 196, 298, 400, 500, 620, 710, 840, 912]; // 298 & 710 = kaki vertikal antar kolom
H1_KIRI.forEach((x) => n(`h1_${x}`, x, 252));
H1_KANAN.forEach((x) => n(`h1_${x}`, x, 252));
H2_XS.forEach((x) => n(`h2_${x}`, x, 420));
const E = (a, b) => { NODES[a].adj.add(b); NODES[b].adj.add(a); };
H1_KIRI.forEach((x, i) => { if (i) E(`h1_${H1_KIRI[i - 1]}`, `h1_${x}`); });
H1_KANAN.forEach((x, i) => { if (i) E(`h1_${H1_KANAN[i - 1]}`, `h1_${x}`); });
H2_XS.forEach((x, i) => { if (i) E(`h2_${H2_XS[i - 1]}`, `h2_${x}`); });
for (const x of [88, 298, 710]) E(`h1_${x}`, `h2_${x}`);
for (const [id, d] of Object.entries(DESKS)) n(`desk_${id}`, deskChair(d).x, deskChair(d).y);
E("desk_bima", "h1_196"); E("desk_raka", "h1_298");
E("desk_sari", "h1_620"); E("desk_bagas", "h1_840");
E("desk_maya", "h2_400"); E("desk_citra", "h2_620");
// titik ngopi di depan counter dinding atas-kiri (bebas dari meja bima x136)
n("coffee_0", 88, 150); n("coffee_1", 88, 196);
E("coffee_0", "coffee_1"); E("coffee_1", "h1_88");
// RING kursi meja bundar: kursi terhubung antar-tetangga (jalur menempel sisi
// meja — chord r95 tak pernah memotong rim r80), pintu masuk ring = kursi
// selatan → koridor tengah. Chibi "berkeliling" meja lewat ring ini.
GATHER_SPOTS.forEach((s, i) => n(`gather_${i}`, s.x, s.y));
for (let i = 0; i < 6; i++) E(`gather_${i}`, `gather_${(i + 1) % 6}`);
E("gather_3", "h2_500");

export function shortestPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = { [fromId]: null };
  const q = [fromId];
  while (q.length) {
    const cur = q.shift();
    for (const nb of NODES[cur].adj) {
      if (nb in prev) continue;
      prev[nb] = cur;
      if (nb === toId) {
        const path = [nb];
        let p = cur;
        while (p) { path.unshift(p); p = prev[p]; }
        return path;
      }
      q.push(nb);
    }
  }
  return null;
}

// ---------- helper gambar ----------
// ---------- aset furnitur CC0 (Ninja Adventure / Kenney — gaya sama dgn karakter) ----------
const FURN = { pot: { img: null, ok: false }, grass: { img: null, ok: false }, crate: { img: null, ok: false }, kenney: { img: null, ok: false }, dindingT: { img: null, ok: false } };
let furniturSiap = false;
function muatFurnitur() {
  if (muatFurnitur._jalan) return;
  muatFurnitur._jalan = true;
  const selesai = () => { if (Object.values(FURN).every((f) => f.ok)) { furniturSiap = true; staticLayer = null; } };
  for (const [k, file] of [["pot", "pot.png"], ["grass", "grass.png"], ["crate", "crate.png"], ["kenney", "kenney_indoor.png"], ["dindingT", "tileset_wall_simple.png"]]) {
    const im = new Image();
    // simpan referensi DULU, baru set src — loader sinkron (test Node) memicu
    // onload SEBELUM baris penugasan tercapai bila urutannya dibalik
    FURN[k].img = im;
    im.onload = () => { FURN[k].ok = true; selesai(); };
    im.onerror = () => selesai();
    im.src = "assets/furniture/" + file;
  }
}
// pixel rect (grid 4px — serasi sprite karakter)
function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, Math.ceil(w / 4) * 4, Math.ceil(h / 4) * 4); }
function sprite(ctx, key, x, y, w, h) { const f = FURN[key]; if (f && f.ok) { ctx.imageSmoothingEnabled = false; ctx.drawImage(f.img, x, y, w, h); ctx.imageSmoothingEnabled = true; return true; } return false; }
// tile Kenney Roguelike Indoor (16px, grid 17): (kolom,baris) → gambar berskala S
const TS = 16, TG = 17;
function tile(ctx, kol, bar, x, y, s = 5, sw = TS, sh = TS) {
  const f = FURN.kenney;
  if (!f || !f.ok) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(f.img, kol * TG, bar * TG, sw, sh, x, y, sw * s, sh * s);
  ctx.imageSmoothingEnabled = true;
  return true;
}
// pola bata utk dinding: tile 16px (kol 1, baris 6 = wajah bata cokelat) diskalakan 40px → pattern
let polaBata = null;
function buatPolaBata() {
  if (polaBata || !FURN.dindingT.ok) return polaBata;
  const c = document.createElement("canvas");
  c.width = 40; c.height = 40;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(FURN.dindingT.img, 16, 96, 16, 16, 0, 0, 40, 40);
  polaBata = c;
  return polaBata;
}
// dinding bertekstur: segmen horizontal/vertikal tebal 40px, outline gelap + bayangan halus
function dindingBata(ctx, x1, y1, x2, y2) {
  const p = buatPolaBata();
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 40), h = Math.max(Math.abs(y2 - y1), 40);
  // bayangan lembut (arah bawah-kanan)
  ctx.fillStyle = "rgba(15,10,5,0.18)";
  ctx.fillRect(x + 3, y + 3, w, h);
  if (p) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const pat = ctx.createPattern(p, "repeat");
    ctx.fillStyle = pat;
    ctx.translate(x, y); ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = "#837163"; ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = "rgba(25,18,10,0.55)"; ctx.lineWidth = 2.5;
  // stroke di-INSET supaya tetap di dalam band dinding (dulu menjorol 2px ke lantai)
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function plant(ctx, x, y) {
  if (tile(ctx, 5, 12, x - 27, y - 52, 5)) return; // plant Kenney 80×80
  if (sprite(ctx, "grass", x - 18, y - 34, 36, 36) && sprite(ctx, "pot", x - 13, y - 6, 26, 22)) return;
  px(ctx, x - 10, y + 4, 20, 14, C.plantPot);
  px(ctx, x - 9, y - 4, 18, 6, "#8a5a3a");
  for (const [dx, dy, r, col] of [[-8, -2, 9, C.plant], [8, -2, 9, C.plant], [0, -10, 11, C.plant2]]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill();
  }
}
const WARNA_LAYAR = { bima: "#7dd3fc", analisis: "#a5b4fc", eksekusi: "#fda4af", server: "#93c5fd" };
function mh0() { return 42; }

// ── primitif semi-3D (lantai datar, objek bertinggi — 2.5D) ──
// bayangan lembut di lantai: elips di bawah kaki objek
function bayang(ctx, x, y, rx, ry, alpha = 0.18) {
  ctx.fillStyle = `rgba(70,50,25,${alpha})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
// kuboid meja: permukaan atas (terang) + sisi depan (gelap, tinggi h)
function kuboidMeja(ctx, x, y, w, d, h) {
  ctx.fillStyle = "#8f6844"; ctx.fillRect(x, y + d, w, h);            // sisi depan
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(x, y + d, 4, h);   // shading kiri
  ctx.fillStyle = "#caa06b"; ctx.fillRect(x, y, w, d);                // permukaan atas
  ctx.fillStyle = "#b98a56"; ctx.fillRect(x + 3, y + 3, w - 6, d - 6);
  ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fillRect(x + 3, y + 3, w - 6, 5);
}
// silinder meja bundar: elips atas + sisi tegak
function silinder(ctx, cx, cy, rx, ry, h) {
  ctx.fillStyle = "#7c5a35";
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); ctx.fill();      // setengah bawah sisi
  ctx.fillRect(cx - rx, cy - h, rx * 2, h);
  ctx.beginPath(); ctx.ellipse(cx, cy - h, rx, ry, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#b98a56"; ctx.beginPath(); ctx.ellipse(cx, cy - h, rx * 0.96, ry * 0.96, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#caa06b"; ctx.beginPath(); ctx.ellipse(cx - rx * 0.08, cy - h - ry * 0.08, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#b98a56"; ctx.beginPath(); ctx.ellipse(cx, cy - h, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2); ctx.fill();
}
function drawDesk(ctx, d, dekoratif = false) {
  // kursi (sprite Kenney 5,4 s=4 → 64×64; digambar dulu — di belakang meja &
  // agent). Posisi y+42..y+106: bawah kursi 172/366/560 — bebas koridor h1/h2
  // dengan margin badan chibi 32px (verifikasi scripts/office-overlap-check.mjs).
  const cx = d.x + 60, cy = d.y + 42;
  if (dekoratif) {
    // meja kosong semi-3D: kuboid + monitor mati berdiri + bayangan
    bayang(ctx, d.x + 60, d.y + 96 + 8, 66, 16);
    kuboidMeja(ctx, d.x, d.y + 16, 120, 80, 14);
    const mw = 64, mx = d.x + (120 - mw) / 2;
    px(ctx, mx + mw / 2 - 8, d.y + 34, 16, 10, "#232a36");
    px(ctx, mx + mw / 2 - 18, d.y + 40, 36, 5, "#232a36");
    px(ctx, mx - 4, d.y - 12, mw + 8, mh0(), "#2b3442");
    px(ctx, mx, d.y - 8, mw, 42, "#141a24");
    px(ctx, mx + 4, d.y - 4, mw - 8, 34, "#1c2532");
    return;
  }
  bayang(ctx, cx, cy + 58, 26, 10, 0.15);
  if (!tile(ctx, 5, 4, cx - 32, cy, 4)) {
    px(ctx, cx - 14, cy + 8, 28, 18, "#6b7a8f");
    px(ctx, cx - 14, cy - 6, 6, 19, "#566275"); px(ctx, cx + 8, cy - 6, 6, 19, "#566275");
  }
  // meja agent semi-3D: bayangan + kuboid (tile kayu dipertahankan sbg tekstur atas)
  bayang(ctx, d.x + 60, d.y + 96 + 8, 66, 16);
  ctx.fillStyle = "#8f6844"; ctx.fillRect(d.x, d.y + 96, 120, 14);           // sisi depan
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(d.x, d.y + 96, 4, 14);
  if (!tile(ctx, 7, 4, d.x, d.y + 16, 5, 24, 16)) {
    px(ctx, d.x, d.y + 16, 120, 80, "#b98a56");
    px(ctx, d.x, d.y + 16, 120, 9, "#caa06b");
    px(ctx, d.x, d.y + 46, 120, 9, "#9a6f42");
    px(ctx, d.x, d.y + 16, 5, 80, "#7c5a35"); px(ctx, d.x + 115, d.y + 16, 5, 80, "#7c5a35");
  }
  // monitor 64×42 (bima 84×42) — meja 120px, semua elemen diskalakan ikut
  const mw = d === DESKS.bima ? 84 : 64, mh = 42;
  const mx = d.x + (120 - mw) / 2;
  px(ctx, mx - 4, d.y - 14, mw + 8, mh + 14, "#2b3442");
  px(ctx, mx, d.y - 10, mw, mh, "#141a24");
  px(ctx, mx + 4, d.y - 6, mw - 8, mh - 8, WARNA_LAYAR[d.room] || "#9fb4d0");
  px(ctx, mx + 8, d.y - 2, 12, 8, "rgba(255,255,255,0.35)");
  px(ctx, mx + mw / 2 - 8, d.y + 30, 16, 8, "#2b3442");
  px(ctx, mx + mw / 2 - 18, d.y + 36, 36, 5, "#232a36");
  // mug saja (keyboard & mouse dihapus — kurangi kebisingan)
  px(ctx, d.x + 92, d.y + 34, 12, 14, "#f8fafc"); px(ctx, d.x + 104, d.y + 38, 5, 7, "#f8fafc");
}

// ---------- layer statis (dirender sekali) ----------
let staticLayer = null;

export function drawStatic(ctx) {
  // lantai papan-catur krem memenuhi seluruh kanvas — bahasa desain Star-Office
  const cekA = "#ece3d0", cekB = "#e2d6bf";
  ctx.fillStyle = cekA; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = cekB;
  for (let ry = 0; ry < H / 80; ry++)
    for (let rx = 0; rx < W / 80; rx++)
      if ((ry + rx) % 2) ctx.fillRect(rx * 80, ry * 80, 80, 80);
  ctx.strokeStyle = "rgba(122,98,66,0.12)"; ctx.lineWidth = 1;
  for (let y = 0; y <= H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = 0; x <= W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  // karpet zonasi ala Star-Office: krem berlapis bingkai cokelat hangat
  const rug = (x, y, w, h) => {
    ctx.fillStyle = "#b98d5e"; ctx.fillRect(x, y, w, h);                          // bingkai cokelat
    ctx.fillStyle = "#e9ddc2"; ctx.fillRect(x + 10, y + 10, w - 20, h - 20);      // lapison
    ctx.fillStyle = "#caa06b"; ctx.fillRect(x + 24, y + 24, w - 48, h - 48);      // garis dalam
    ctx.fillStyle = "#e9ddc2"; ctx.fillRect(x + 34, y + 34, w - 68, h - 68);      // inti krem
  };
  rug(116, 70, 770, 516);   // SATU karpet zona besar di bawah seluruh kisi meja
  // karpet bundar ELIPS (semi-3D: lingkaran di lantai tampak gepeng) + meja silinder
  for (const [rx, ry, c] of [[150, 108, "#b98d5e"], [136, 98, "#e9ddc2"], [116, 84, "#caa06b"], [104, 75, "#e9ddc2"]]) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(500, 318, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  // dinding luar bata — TANPA sekat: satu ruangan besar (band 40px di tepi)
  dindingBata(ctx, 0, 0, W, 40);
  dindingBata(ctx, 0, H - 40, W, H);
  dindingBata(ctx, 0, 0, 40, H);
  dindingBata(ctx, W - 40, 0, W, H);

  // layar status dinding atas (y32..88, span 300..700 — 28-72% lebar ala referensi;
  // dipendekkan supaya kursi utara meja bundar (y110) tak menabrak)
  px(ctx, 300, 32, 400, 56, "#2b3442"); px(ctx, 308, 38, 384, 44, "#141a24");
  px(ctx, 318, 46, 120, 10, "rgba(125,211,252,0.5)");
  px(ctx, 318, 64, 200, 7, "rgba(125,211,252,0.25)");
  px(ctx, 556, 46, 124, 10, "rgba(251,191,36,0.4)");
  px(ctx, 618, 64, 60, 7, "rgba(251,191,36,0.25)");

  bayang(ctx, 88, 128, 48, 12, 0.2);
  // counter kopi menempel dinding ATAS kiri (x 48..128 — bebas meja bima x136);
  // spot ngopi (88,150)/(88,196) di bawahnya
  if (!tile(ctx, 7, 4, 48, 44, 5, 16, 16)) {
    px(ctx, 48, 44, 80, 80, "#b98a56"); px(ctx, 48, 44, 80, 8, "#caa06b"); px(ctx, 48, 116, 80, 8, "#9a6f42");
  }
  px(ctx, 56, 48, 34, 40, "#3f3244"); px(ctx, 60, 52, 26, 22, "#2b222e"); px(ctx, 64, 56, 7, 5, "#f59e0b"); // mesin kopi
  for (const [mx, my] of [[104, 58], [104, 98]]) { px(ctx, mx, my, 14, 14, "#f8fafc"); px(ctx, mx + 12, my + 4, 4, 7, "#f8fafc"); px(ctx, mx - 5, my + 3, 5, 4, "#7c4a2d"); }

  bayang(ctx, 908, 180, 42, 10, 0.2);
  // rak server mini Bagas — dinding atas kanan: 2 tile s=4 (64px) bertumpuk di
  // x876..940 × y46..174. Bawah rak wajib ≥ h1(210) − margin chibi 32 = 178px —
  // dulu 2×80px sampai y204: chibi yang lewat h1 menembus rak (fix 2026-10-12).
  for (let i = 0; i < 2; i++) {
    if (!tile(ctx, 2, 12, 876, 46 + i * 64, 4)) { px(ctx, 876, 46 + i * 64, 64, 64, "#3a4252"); }
  }
  for (let l = 0; l < 5; l++) px(ctx, 884, 58 + l * 22, 8, 6, l % 2 ? "#4ade80" : "#22d3ee");
  // (crate di bawah rak DIHAPUS 2026-10-12: menutup jalur vertikal x912 —
  // chibi yang lewat menembusnya; rak sendiri sudah cukup sebagai penanda zona)

  // meja agent + meja kosong dekoratif (kisi longgar)
  for (const d of Object.values(DESKS)) drawDesk(ctx, d);
  for (const d of DECOR_DESKS) drawDesk(ctx, d, true);

  // MEJA BUNDAR COUNCIL — pusat ruangan, 6 kursi mengelilingi (revisi-5 dari
  // gambar referensi operator). Lingkaran digambar arc() (bebas grid px()).
  // Kayu: bidang utama + tepi gelap + highlight serat.
  bayang(ctx, 500, 320, 96, 40, 0.22);
  silinder(ctx, 500, 324, 86, 46, 26);   // silinder: elips atas di y270, sisi 26px
  ctx.strokeStyle = "rgba(122,80,40,0.30)"; ctx.lineWidth = 2;
  for (const [rx, ry] of [[24, 13], [42, 23], [60, 33]]) {
    ctx.beginPath(); ctx.ellipse(500, 298, rx, ry, 0, 0.3, Math.PI - 0.3); ctx.stroke();
  }
  // dokumen & mug di atas meja bundar
  px(ctx, 462, 286, 36, 24, "#f8fafc"); px(ctx, 467, 291, 24, 4, "rgba(60,40,20,0.25)"); px(ctx, 467, 298, 18, 4, "rgba(60,40,20,0.25)");
  px(ctx, 506, 302, 36, 24, "#f8fafc"); px(ctx, 511, 307, 24, 4, "rgba(60,40,20,0.25)");
  px(ctx, 494, 314, 12, 14, "#f8fafc"); px(ctx, 506, 318, 5, 7, "#f8fafc");
  // 6 kursi semi-3D mengelilingi meja: bayangan + dudukan elips + sandaran
  // berdiri menghadap meja (sisi menjauhi meja)
  for (const s of GATHER_SPOTS) {
    const arahMeja = Math.atan2(318 - s.y, 500 - s.x); // menuju pusat meja
    bayang(ctx, s.x, s.y + 6, 24, 9, 0.15);
    ctx.fillStyle = "#8d99ae"; ctx.beginPath(); ctx.ellipse(s.x, s.y, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#6b7a8f"; ctx.beginPath(); ctx.ellipse(s.x, s.y, 22, 12, 0, 0, Math.PI); ctx.fill();
    // sandaran: busur di sisi belakang kursi (menjauhi meja)
    const bx = s.x - Math.cos(arahMeja) * 20, by = s.y - Math.sin(arahMeja) * 10;
    ctx.strokeStyle = "#566275"; ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(bx, by - 8, 10, 12, 0, Math.PI * 0.15 + (Math.abs(arahMeja) > Math.PI / 2 ? Math.PI : 0), Math.PI * 0.85 + (Math.abs(arahMeja) > Math.PI / 2 ? Math.PI : 0));
    ctx.stroke();
  }

  // tanaman sudut bawah — 2 saja (tengah bawah kini lintasan b_*, tanaman
  // lama di (320,552)/(680,552) menutup lintasan y520)
  plant(ctx, 80, 560); plant(ctx, 897, 560);

  // poster di dinding atas — celah antara counter/layar/rak, bebas dari monitor
  // baris 1 (bima 154..238, bagas 772..836) dan layar status (356..644);
  // digeser supaya jarak ke tetangga ≥13px (dulu 9px — terbaca menempel)
  const poster = (x, y, w, bg, aksen) => {
    px(ctx, x - 5, y - 5, w + 10, 44, "#7c5a35"); px(ctx, x, y, w, 34, bg);
    px(ctx, x + 10, y + 5, 14, 24, aksen); px(ctx, x + w - 30, y + 5, 20, 24, "rgba(255,255,255,0.45)");
    px(ctx, x + 30, y + 13, w - 60, 5, "rgba(60,40,20,0.35)");
  };
  poster(190, 38, 80, "#e8f0fe", "#7dd3fc");
  poster(770, 38, 80, "#fde8f4", "#f472b6");
}

// ---------- layer dinamis (per frame, gated by tier) ----------
export function drawWorld(ctx, t, opts = {}) {
  if (typeof document !== "undefined" && !muatFurnitur._jalan) muatFurnitur();
  const {
    workingAgents = new Set(), errorActive = false, debugging = false, runLabel = "",
    tier = "penuh", // "penuh" | "sedang" | "diam" — efek ambient dilewati saat diam
    data = null,
  } = opts;

  if (!staticLayer && typeof document !== "undefined") {
    staticLayer = document.createElement("canvas");
    staticLayer.width = W; staticLayer.height = H;
    drawStatic(staticLayer.getContext("2d"));
  }
  if (staticLayer) {
    ctx.drawImage(staticLayer, 0, 0);
  } else {
    drawStatic(ctx); // fallback (non-browser)
  }
  if (tier === "diam") {
    drawScreenLabel(ctx, runLabel);
    return;
  }

  // ===== AMBIENT ANIMASI (ringan, gated tier) =====
  // 1) uap kopi dari mesin di counter dinding atas-kiri
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 3; i++) {
    const ph = (t / 1400 + i * 0.33) % 1;
    const sx2 = 62 + i * 10, sy2 = 46 - ph * 20;
    ctx.globalAlpha = 0.55 * (1 - ph);
    ctx.beginPath(); ctx.arc(sx2 + Math.sin(ph * 6.28) * 3, sy2, 3 + ph * 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 2) debu melayang di berkas cahaya layar/jendela atas
  ctx.fillStyle = "rgba(255,250,220,0.5)";
  for (let i = 0; i < 5; i++) {
    const ph = (t / 9000 + i * 0.143) % 1;
    const wx = 370 + i * 62 + Math.sin(t / 3000 + i) * 8;
    ctx.globalAlpha = 0.18 + 0.22 * Math.sin(ph * Math.PI);
    ctx.fillRect(wx, 120 + ph * 140, 2.5, 2.5);
  }
  ctx.globalAlpha = 1;
  // 3) berkas cahaya atas (gradient diagonal, sangat halus)
  const cahaya = ctx.createLinearGradient(350, 50, 650, 240);
  cahaya.addColorStop(0, "rgba(255,244,200,0.10)");
  cahaya.addColorStop(1, "rgba(255,244,200,0)");
  ctx.fillStyle = cahaya;
  ctx.fillRect(340, 40, 320, 200);

  // 4) LED rak mini Bagas berkedip (hijau/cyan) — sinkron dgn rak s=4 (spasi 22)
  for (let l = 0; l < 5; l++) {
    const on = Math.sin(t / 260 + l * 1.7) > 0;
    ctx.fillStyle = on ? "#4ade80" : "rgba(74,222,128,0.25)";
    ctx.fillRect(884, 58 + l * 22, 8, 6);
    ctx.fillStyle = on ? "rgba(34,211,238,0.8)" : "rgba(34,211,238,0.2)";
    ctx.fillRect(886, 64 + l * 22, 5, 4);
  }
  // 5) LED mode error — merah berkedip di rak yang sama
  for (let led = 0; led < 6; led++) {
    const on = errorActive
      ? (Math.floor(t / 220 + led) % 3 === 0)
      : (Math.floor(t / 900 + led * 2) % 4 === 0);
    ctx.fillStyle = errorActive ? (on ? "#f87171" : "#7f1d1d") : on ? "#4ade80" : "#14532d";
    ctx.beginPath(); ctx.arc(908 + (led % 2) * 14, 58 + Math.floor(led / 2) * 22, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (debugging) {
    ctx.fillStyle = `rgba(248,113,113,${0.25 + 0.25 * Math.sin(t / 150)})`;
    rr(ctx, 874, 42, 152, 148, 10); ctx.fill();
  }

  drawScreenLabel(ctx, runLabel);

  // glow monitor agent yang bekerja
  const deskColor = {
    raka: "#0284c7", citra: "#db2777", sari: "#0d9488", maya: "#d946ef",
  };
  for (const [id, working] of Object.entries({ ...deskColor, bagas: "#475569", bima: "#2563eb" })) {
    if (!workingAgents.has(id)) continue;
    const d = DESKS[id];
    const mw = id === "bima" ? 76 : 60;
    ctx.fillStyle = hexA(working, 0.55);
    rr(ctx, d.x + 60 - (mw - 8) / 2, d.y + 2, mw - 8, 24, 4); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "600 10px system-ui"; ctx.textAlign = "center";
    ctx.fillText("● ● ●", d.x + 60, d.y + 19);
  }
}

function drawScreenLabel(ctx, runLabel) {
  ctx.fillStyle = "#7dd3fc"; ctx.font = "600 14px system-ui"; ctx.textAlign = "left";
  ctx.fillText(runLabel || "Azimuth — siaga", 312, 76);
}

export function hexA(hex, a) {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
