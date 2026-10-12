// app.js — bootstrap dashboard Azimuth. PORT loop render & interaksi dari
// Automation-project: poll /api/overview (5s) + SSE, sim.applyState(run hasil
// adapter, loop berjenjang penuh 24fps → sedang 8fps → BERHENTI saat diam
// (heartbeat 800ms membangunkan ulang), klik agent = info, papan data = kartu
// HTML 2×2 di kolom kanan (renderBoards), toasts keputusan baru.
import { W, H, drawWorld } from "./js/world.js";
import { OfficeSim } from "./js/sim.js";

const $ = (id) => document.getElementById(id);
const canvas = $("office");
// resolusi internal kanvas = koordinat dunia. Tanpa ini kanvas 300×150 default
// → dunia 1440×900 terpotong & direntangkan (bug "furniture raksasa terpotong").
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d");

// meta agent — id = key meja di world.js (lowercase), role = id uppercase API
const ROLE_OF = { raka: "ANALYST", bima: "DECIDER", sari: "MANAGER", citra: "CURATOR", maya: "AUDITOR", bagas: "ROUTER" };
const AGENTS_META = [
  { id: "raka",  nama: "Raka",  peran: "Analyst — verdict per finalis", ikon: "🧠", warna: "#0284c7" },
  { id: "bima",  nama: "Bima",  peran: "Decider — deploy/skip final",   ikon: "⚖️", warna: "#2563eb" },
  { id: "sari",  nama: "Sari",  peran: "Manager — posisi & exit",       ikon: "🛡️", warna: "#0d9488" },
  { id: "citra", nama: "Citra", peran: "Curator — hygiene lessons",     ikon: "🧹", warna: "#db2777" },
  { id: "maya",  nama: "Maya",  peran: "Auditor — post-mortem",         ikon: "📊", warna: "#d946ef" },
  { id: "bagas", nama: "Bagas", peran: "Router — server & routing",     ikon: "🧭", warna: "#475569" },
];

const state = { data: null, sim: null, selected: null, lastDecisionTs: null, etag: null };

// Sumber data: backend lokal (/api/overview) atau snapshot eksternal (GitHub
// Pages — window.AZIMUTH_SNAPSHOT_URL disuntik seed script di index.html).
// Snapshot eksternal = host statis: tanpa SSE, tanpa ETag. ?t= hanya menembus
// cache BROWSER — CDN raw.githubusercontent mengabaikan query string di cache
// key (TTL 5 mtk), jadi data bisa tertinggal ±5 menit dari push terakhir.
const OVERVIEW_URL = window.AZIMUTH_SNAPSHOT_URL || "api/overview";
const SNAPSHOT_EKSTERNAL = Boolean(window.AZIMUTH_SNAPSHOT_URL);

// ---------- util ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (ts) => {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const wib = (ts) => ts
  ? new Date(ts).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }) + " WIB"
  : "";
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- adapter: /api/overview → run utk OfficeSim.applyState ----------
function buildRun(ov) {
  if (!ov) return null;
  const steps = {};
  let latestTs = 0;
  for (const a of ov.agents ?? []) {
    const id = Object.keys(ROLE_OF).find((k) => ROLE_OF[k] === a.id);
    if (!id) continue;
    const aktif = a.status === "working";
    if (aktif) latestTs = Math.max(latestTs, a.lastActivity?.ts ?? Date.now());
    steps[id] = {
      status: aktif ? "running" : (a.lastActivity ? "done" : "pending"),
      label: a.lastActivity ? String(a.lastActivity.text ?? "").slice(0, 34) : a.desc ?? "",
    };
  }
  const running = Object.values(steps).some((s) => s.status === "running");
  const newestDecisionMs = (() => { const t = (ov.decisions ?? [])[0]?.ts; return t ? new Date(t).getTime() : 0; })();
  return {
    runId: `cycle-${Math.max(newestDecisionMs, latestTs, 0)}`,
    status: running ? "running" : "idle",
    startedAt: new Date(latestTs || Date.now()).toISOString(),
    steps,
  };
}

// ---------- data ----------
async function refresh() {
  try {
    const res = await fetch(
      SNAPSHOT_EKSTERNAL ? `${OVERVIEW_URL}?t=${Date.now()}` : OVERVIEW_URL,
      SNAPSHOT_EKSTERNAL ? { cache: "no-store" } : { headers: state.etag ? { "if-none-match": state.etag } : {} },
    );
    if (res.status === 304) return;
    state.etag = SNAPSHOT_EKSTERNAL ? null : res.headers.get("etag");
    const ov = await res.json();
    if (ov.error) throw new Error(ov.error);
    state.data = ov;
    if (!state.sim) {
      state.sim = new OfficeSim(AGENTS_META);
      state.sim.onWake(mulaiLoop);
      mulaiLoop();
    }
    state.sim.applyState(buildRun(ov));
    detectToasts(ov);
    renderChrome(ov);
  } catch (e) {
    const oc = $("office-note"); if (oc) oc.textContent = "dashboard error: " + e.message;
  }
}

// toasts: keputusan baru (deploy/close) — seperti event feed Automation-project
function detectToasts(ov) {
  const ds = ov.decisions ?? [];
  if (!ds.length) return;
  const newest = new Date(ds[0].ts).getTime();
  if (state.lastDecisionTs === null) { state.lastDecisionTs = newest; return; } // load pertama: tanpa toast
  for (let i = ds.length - 1; i >= 0; i--) {
    const d = ds[i];
    const ts = new Date(d.ts).getTime();
    if (ts <= state.lastDecisionTs) continue;
    const pair = d.pool_name || d.pool || "";
    if (d.type === "deploy") toast(`🚀 Deploy — ${pair}`);
    else if (d.type === "close") {
      const pct = Number(d.pnl_pct ?? 0);
      toast(`${pct >= 0 ? "✅" : "🔻"} Close ${pair} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, pct >= 0 ? "info" : "error");
      if (pct > 0 && state.sim) state.sim.celebrate(); // posisi ditutup profit → confetti!
    } else if (d.type === "skip") toast(`⏭️ Skip — ${String(d.summary ?? "").slice(0, 40)}`);
  }
  state.lastDecisionTs = newest;
}

function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.classList.add("show"), 30);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 4200);
}

// ---------- UI chrome (header + roster + decision feed — port app lama) ----------
function renderChrome(d) {
  const m = d.meta;
  const mode = $("badge-mode");
  mode.textContent = m.paper ? "● paper (dry run)" : "● LIVE";
  mode.className = "badge " + (m.paper ? "paper" : "live");
  $("badge-slots").textContent = `slots ${m.slots}`;
  $("badge-cadence").textContent = `screen ${m.screeningIntervalMin ?? 0}m · mgmt ${m.managementIntervalMin ?? 0}m · ${m.deployMode ?? "?"}`;

  // status push cloud: dari snapshot meta.push — terlihat langsung di dashboard online
  const pushBadge = $("badge-push");
  if (pushBadge) {
    const st = m.push ?? {};
    if (!st.aktif) { pushBadge.textContent = "● push nonaktif"; pushBadge.className = "badge paper"; }
    else if (st.sukses && !st.gagalBeruntun) { pushBadge.textContent = `● push → ${st.url}`; pushBadge.className = "badge live"; }
    else { pushBadge.textContent = `● push gagal ×${st.gagalBeruntun} (${st.url ?? "?"})`; pushBadge.className = "badge paper"; }
  }

  // status pill: siklus apa yang sedang jalan
  const pill = $("statusPill");
  const working = (d.agents ?? []).filter((a) => a.status === "working");
  if (working.length) {
    pill.textContent = `▶ ${working.map((a) => a.id).join(" + ")} bekerja`;
    pill.className = "pill running";
  } else {
    pill.textContent = "Idle — menunggu siklus berikutnya";
    pill.className = "pill idle";
  }

  const working2 = working.length;
  renderBoards(d);

  const per = Object.entries(d.tokenUsage?.perAgent ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const max = Math.max(...per.map(([, v]) => v), 1);
  $("usage-bars").innerHTML = per.length
    ? per.map(([k, v]) => `<div class="ubar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${Math.round((v / max) * 100)}%"></div></div><span class="amt">${v.toLocaleString()}</span></div>`).join("")
    : `<div class="sub2">no LLM calls yet today</div>`;

  $("decisions").innerHTML = (d.decisions ?? []).map((x) => `
    <div class="fitem">
      <time>${wib(x.ts)}</time>
      <span class="t ${esc(x.type)}">${esc(x.type)}</span>
      <span class="s">${esc(x.pool_name ? x.pool_name : "")} ${esc(x.summary ?? "")}<span class="r">${esc((x.reason ?? "").slice(0, 110))}</span></span>
    </div>`).join("") || '<div class="empty">no decisions yet</div>';

  const oc = $("office-note"); if (oc) oc.textContent = `${working2} agent bekerja · ${(d.positions ?? []).length} posisi`;
  const ln = $("lessons-note"); if (ln) ln.textContent = `${d.lessons?.total ?? 0} lessons · ${d.lessons?.pinned ?? 0} pinned`;
  $("foot-lessons").textContent = `${d.lessons?.perfRecords ?? 0} perf records`;
  $("foot-updated").textContent = `updated ${new Date().toLocaleTimeString()}`;
}

// ---------- papan data HTML 2×2 (pengganti totem canvas + roster THE DESK) ----------
const fmtPct = (v, dp = 2) => `${v >= 0 ? "+" : ""}${Number(v ?? 0).toFixed(dp)}`;
function renderBoards(d) {
  // SATU satuan utk seluruh panel (operator 2026-10-12): server mengonversi
  // ledger (USD-live/SOL-paper) ke satuan pilihan; pnl.units = sumber kebenaran.
  // Tanpa harga SOL → server kirim USD dan panel $ (jangan pernah ◎ palsu).
  const sym = d.meta?.solMode && d.pnl?.units === "SOL" ? "◎" : "$";
  const pn = d.pnl ?? {};
  const pos = d.positions ?? [];

  // POSITIONS
  $("bd-positions").innerHTML = pos.length
    ? pos.slice(0, 6).map((p) => `
      <div class="b-row">
        <span class="k">${esc(p.pair)} <span class="dim">${p.in_range ? "🟢 in" : `🔴 OOR ${p.oor_minutes ?? 0}m`}</span></span>
        <span class="num ${p.pnl_pct >= 0 ? "good" : "bad"}">${fmtPct(p.pnl_pct, 1)}%<i>${sym}${Number(p.fees ?? 0).toFixed(3)}</i></span>
      </div>`).join("") + (pos.length > 6 ? `<div class="b-empty">+${pos.length - 6} posisi lagi…</div>` : "")
    : `<div class="b-empty">tidak ada posisi terbuka</div>`;
  $("led-positions").textContent = `${pos.length} open`;

  // P&L — SATU satuan (sym) utk semua baris; nilai realized sudah dikonversi server
  const rows = [
    ["open", pn.actualPnl, (pn.actualPnl ?? 0) >= 0],
    ["fees", pn.openFees, true],
    [`realized ${pn.mode === "paper" ? "paper" : "live"}`, pn.realizedTotal, (pn.realizedTotal ?? 0) >= 0],
    ["today", pn.realizedToday, (pn.realizedToday ?? 0) >= 0],
  ];
  if (pn.paperRealizedTotal != null) {
    rows.push([`paper (pra-live)`, pn.paperRealizedTotal, (pn.paperRealizedTotal ?? 0) >= 0]);
  }
  $("bd-pnl").innerHTML = rows.map(([k, v, good]) => `
    <div class="b-row"><span class="k">${k}</span><span class="num ${good ? "good" : "bad"}">${fmtPct(v, 3)}${sym}</span></div>`).join("") +
    `<div class="b-row"><span class="k">closes</span><span class="num">${pn.realizedCount ?? 0}${pn.mode === "live" ? " live" : ""}${pn.paperRealizedCount != null ? ` · ${pn.paperRealizedCount} paper` : ""} · ${pn.realizedTodayCount ?? 0} tdy</span></div>`;

  // PERF — bar chart HTML; snapshot terurut terbaru→terlama, tapi sort eksplisit
  // agar tahan perubahan urutan: ambil 20 close TERBARU, tampil terbaru di kiri.
  // Dua era (live/paper) tampil bersama TAPI berlabel — batang paper diredupkan,
  // statistik win/avg hanya dihitung dalam mode aktif (tak pernah dicampur).
  const hist = (d.performance ?? [])
    .slice()
    .sort((a, b) => new Date(b.ts ?? 0) - new Date(a.ts ?? 0))
    .slice(0, 20);
  const modeNow = d.pnl?.mode ?? "live";
  const curMode = hist.filter((h) => (h.mode ?? "paper") === modeNow);
  const nLive = hist.filter((h) => (h.mode ?? "paper") === "live").length;
  const mx = Math.max(1, ...hist.map((h) => Math.abs(h.pnl_pct ?? 0)));
  const wins = curMode.filter((h) => (h.pnl_pct ?? 0) > 0).length;
  $("bd-perf").innerHTML = hist.length
    ? `<div class="pbars">${hist.map((h) => {
        const paper = (h.mode ?? "paper") !== "live";
        const hgt = Math.max(5, (Math.abs(h.pnl_pct ?? 0) / mx) * 100);
        const dim = paper && nLive ? "opacity:.45" : "";
        return `<div class="bar ${h.pnl_pct >= 0 ? "up" : "down"}" style="height:${hgt.toFixed(0)}%;${dim}" title="[${h.mode ?? "paper"}] ${esc(String(h.pair ?? "?"))} ${fmtPct(h.pnl_pct, 2)}%"></div>`;
      }).join("")}</div>
      <div class="b-row"><span class="k">win ${modeNow}</span><span class="num">${wins}/${curMode.length}${curMode.length ? ` · ${fmtPct(curMode.reduce((s, h) => s + (h.pnl_pct ?? 0), 0) / curMode.length, 2)}%` : " · belum ada"}</span></div>
      <div class="b-row"><span class="k">riwayat</span><span class="num">${nLive} live · ${hist.length - nLive} paper</span></div>`
    : `<div class="b-empty">belum ada close</div>`;

  // LESSONS
  const L = d.lessons ?? {};
  $("bd-lessons").innerHTML = (L.latest ?? []).map((l) => `
    <div class="b-row"><span class="k">${l.pinned ? "★" : "·"} ${esc(String(l.text ?? "").slice(0, 46))}</span></div>`).join("") +
    `<div class="b-row"><span class="k">store</span><span class="num">${L.total ?? 0} lessons · ${L.pinned ?? 0} pinned</span></div>`;
  $("led-lessons").textContent = `${L.total ?? 0}`;

  $("boards-note").textContent = `${pos.length} posisi · realized ${d.pnl?.mode === "paper" ? "paper" : "live"} ${sym}${(pn.realizedTotal ?? 0).toFixed(2)}`;
}

// ---------- modal detail papan (klik kartu → tampilan besar, teks besar) ----------
const BOARD_TITLES = { positions: "POSITIONS", pnl: "P&L", perf: "PERFORMANCE", lessons: "LESSONS" };

function renderBoardDetail(key, d) {
  const sym = d.meta?.solMode ? "◎" : "$";
  if (key === "positions") {
    const pos = d.positions ?? [];
    if (!pos.length) return `<div class="b-empty">tidak ada posisi terbuka</div>`;
    return `<div class="m-head"><span>pair</span><span>value</span><span>pnl</span><span>fees</span><span>age / range</span></div>` +
      pos.map((p) => `
      <div class="m-row">
        <span>${esc(p.pair)}${p.sim ? ` <span class="dim">sim</span>` : ""}</span>
        <span>${sym}${Number(p.value ?? 0).toFixed(2)}</span>
        <span class="${p.pnl_pct >= 0 ? "good" : "bad"}">${fmtPct(p.pnl_pct, 2)}%</span>
        <span>${sym}${Number(p.fees ?? 0).toFixed(4)}</span>
        <span class="dim">${p.age_minutes ?? "?"}m ${p.in_range ? "🟢 in" : `🔴 OOR ${p.oor_minutes ?? 0}m`}</span>
      </div>`).join("");
  }
  if (key === "pnl") {
    const pn = d.pnl ?? {};
    const modeLbl = pn.mode === "paper" ? "paper" : "live";
    const rows = [
      ["open (unrealized)", pn.actualPnl, (pn.actualPnl ?? 0) >= 0],
      ["unclaimed fees", pn.openFees, true],
      [`realized ${modeLbl}`, pn.realizedTotal, (pn.realizedTotal ?? 0) >= 0],
      [`realized today (${modeLbl})`, pn.realizedToday, (pn.realizedToday ?? 0) >= 0],
      ["fees realized", pn.feesRealized, true],
    ];
    if (pn.paperRealizedTotal != null) {
      rows.push([`realized paper (pra-live)`, pn.paperRealizedTotal, (pn.paperRealizedTotal ?? 0) >= 0]);
    }
    return rows.map(([k, v, good]) => `
      <div class="b-row"><span class="k">${k}</span><span class="num ${good ? "good" : "bad"}" style="font-size:17px">${fmtPct(v, 4)}${sym}</span></div>`).join("") +
      `<div class="b-row"><span class="k">closes</span><span class="num">${pn.realizedCount ?? 0} ${modeLbl}${pn.paperRealizedCount != null ? ` · ${pn.paperRealizedCount} paper` : ""} · ${pn.realizedTodayCount ?? 0} today</span></div>`;
  }
  if (key === "perf") {
    const hist = (d.performance ?? [])
      .slice()
      .sort((a, b) => new Date(b.ts ?? 0) - new Date(a.ts ?? 0))
      .slice(0, 30); // 30 close terbaru, terbaru dulu
    if (!hist.length) return `<div class="b-empty">belum ada close</div>`;
    // dua era tampil bersama TAPI berlabel: batang/baris paper diredupkan,
    // win & avg hanya dihitung dalam mode aktif (operator: tak pernah dicampur)
    const modeNow = d.pnl?.mode ?? "live";
    const curMode = hist.filter((h) => (h.mode ?? "paper") === modeNow);
    const nLive = hist.filter((h) => (h.mode ?? "paper") === "live").length;
    const mx = Math.max(1, ...hist.map((h) => Math.abs(h.pnl_pct ?? 0)));
    const wins = curMode.filter((h) => (h.pnl_pct ?? 0) > 0).length;
    return `<div class="pbars">${hist.map((h) => {
      const paper = (h.mode ?? "paper") !== "live";
      const hgt = Math.max(5, (Math.abs(h.pnl_pct ?? 0) / mx) * 100);
      const dim = paper && nLive ? "opacity:.45" : "";
      return `<div class="bar ${h.pnl_pct >= 0 ? "up" : "down"}" style="height:${hgt.toFixed(0)}%;${dim}" title="[${h.mode ?? "paper"}] ${esc(String(h.pair ?? "?"))} ${fmtPct(h.pnl_pct, 2)}%"></div>`;
    }).join("")}</div>
    <div class="b-row"><span class="k">win ${modeNow}</span><span class="num">${wins}/${curMode.length}${curMode.length ? ` · ${fmtPct(curMode.reduce((s, h) => s + (h.pnl_pct ?? 0), 0) / curMode.length, 2)}% avg` : " · belum ada close"}</span></div>
    <div class="b-row"><span class="k">riwayat</span><span class="num">${nLive} live · ${hist.length - nLive} paper</span></div>
    <div class="m-head" style="margin-top:10px"><span>pair</span><span>pnl</span><span>fees</span><span>held</span><span>reason</span></div>` +
    hist.slice(0, 10).map((h) => `
      <div class="m-row">
        <span>${esc(String(h.pair ?? "?"))} <span class="dim">${(h.mode ?? "paper") === "live" ? "LIVE" : "paper"}</span></span>
        <span class="${h.pnl_pct >= 0 ? "good" : "bad"}">${fmtPct(h.pnl_pct, 2)}%</span>
        <span>${sym}${Number(h.fees ?? 0).toFixed(2)}</span>
        <span class="dim">${Math.round((h.minutes ?? 0) / 60)}h</span>
        <span class="dim">${esc(String(h.reason ?? ""))}</span>
      </div>`).join("");
  }
  if (key === "lessons") {
    const L = d.lessons ?? {};
    const latest = L.latest ?? [];
    return (latest.length ? latest.map((l) => `
      <div class="lesson-item"><span class="star">${l.pinned ? "★" : "·"}</span>${esc(String(l.text ?? ""))}</div>`).join("") : `<div class="b-empty">belum ada lesson</div>`) +
      `<div class="b-row" style="margin-top:8px"><span class="k">store</span><span class="num">${L.total ?? 0} lessons · ${L.pinned ?? 0} pinned</span></div>`;
  }
  return "";
}

function openBoard(key) {
  if (!state.data) return;
  $("bmodal-title").textContent = BOARD_TITLES[key] ?? key;
  $("bmodal-body").innerHTML = renderBoardDetail(key, state.data);
  $("boardModal").hidden = false;
}

for (const el of document.querySelectorAll(".board[data-board]")) {
  el.addEventListener("click", () => openBoard(el.dataset.board));
}
$("bmodal-close").addEventListener("click", () => { $("boardModal").hidden = true; });
$("boardModal").addEventListener("click", (e) => { if (e.target === $("boardModal")) $("boardModal").hidden = true; });

// ---------- interaksi canvas ----------
// hit-test persegi presisi mengikuti chibi (±44 x, y-72..y+16) — port Automation-project
function cariAgentDariKlik(sx, sy) {
  let hit = null, skala = Infinity;
  for (const p of state.sim?.people.values() || []) {
    const kena = Math.abs(sx - p.x) <= 44 && sy >= p.y - 72 && sy <= p.y + 16;
    if (kena) {
      const d = Math.abs(sx - p.x) + Math.abs(sy - (p.y - 30));
      if (d < skala) { skala = d; hit = p; }
    }
  }
  return hit;
}
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (W / rect.width);
  const sy = (e.clientY - rect.top) * (H / rect.height);
  const hit = cariAgentDariKlik(sx, sy);
  if (hit) { pilihAgent(hit.id); return; }
  state.selected = null;
});
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (W / rect.width);
  const sy = (e.clientY - rect.top) * (H / rect.height);
  canvas.style.cursor = cariAgentDariKlik(sx, sy) ? "pointer" : "default";
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("boardModal").hidden = true; $("agentPanel").classList.remove("open"); state.selected = null; } });

function pilihAgent(id) {
  state.selected = id;
  const meta = AGENTS_META.find((a) => a.id === id);
  const p = state.sim?.person(id);
  const role = ROLE_OF[id];
  const a = (state.data?.agents ?? []).find((x) => x.id === role);
  const poseLabel = {
    working: "sedang bekerja", meeting: "di kickoff", sitting: p?.behavior === "meeting" ? "duduk di meja council" : "duduk", walking: "jalan",
    idle: p?.behavior === "coffee" ? "ngopi ☕" : "santai",
  };
  $("agentPanel").classList.add("open");
  $("agentAvatar").style.background = meta?.warna ?? "#64748b";
  $("agentAvatar").textContent = meta?.ikon ?? "🙂";
  $("agentNama").textContent = meta?.nama ?? id;
  $("agentPeran").textContent = meta?.peran ?? "";
  $("agentStatus").textContent = p ? (poseLabel[p.pose] || "di kantor") : "—";
  const pretty = (s) => String(s).replace(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g, (m) => `${m.slice(0, 4)}…${m.slice(-4)}`);
  $("agentTugas").textContent = a?.lastActivity
    ? `${pretty(String(a.lastActivity.text).slice(0, 140))} · ${ago(a.lastActivity.ts)} lalu`
    : (a ? `${a.desc} · model ${a.model}` : "—");
}
$("closePanel")?.addEventListener("click", () => { $("agentPanel").classList.remove("open"); state.selected = null; });

// ---------- loop render sesuai permintaan (port Automation-project) ----------
// Jenjang: penuh 24fps (ada gerakan) → sedang 8fps (agent bekerja) → BERHENTI (idle).
// Heartbeat 800ms membangunkan loop bila ada aktivitas baru — CPU ~0 saat kantor diam.
let loopJalan = false;
let lastT = performance.now();

function renderFrame(now, tier) {
  const sim = state.sim;
  if (!sim) return;
  const run = sim.run;
  const runLabel = run && run.status === "running"
    ? `Azimuth · ${Object.entries(run.steps).filter(([, s]) => s.status === "running").map(([k]) => capitalize(k)).join(", ") || "cycle"}…`
    : "";
  drawWorld(ctx, now, {
    workingAgents: sim.workingSet(),
    errorActive: sim.errorActive,
    debugging: sim.debugging,
    runLabel,
    tier,
    data: state.data,
  });
  sim.draw(ctx, now);
}

function langkahLoop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const sim = state.sim;
  if (!sim) { loopJalan = false; return; }
  sim.tick(dt, now);
  const tier = sim.tierRender();
  renderFrame(now, tier);
  if (tier === "diam") { loopJalan = false; return; } // frame terakhir sudah digambar → stop
  const delay = Math.max(0, 1000 / (tier === "penuh" ? 24 : 8) - (performance.now() - now));
  setTimeout(langkahLoop, delay);
}

function mulaiLoop() {
  if (loopJalan) return;
  loopJalan = true;
  lastT = performance.now();
  langkahLoop();
}

setInterval(() => {
  if (!state.sim || loopJalan) return;
  state.sim.tick(0.016, performance.now());
  if (state.sim.tierRender() !== "diam") mulaiLoop();
}, 800);

// ---------- SSE (push saat file state berubah) + fallback poll ----------
// Hanya utk backend lokal — host statis (GitHub Pages) tidak punya /api/events;
// di sana poll 5 dtk saja yang menyegarkan data.
let sseRetry = 0;
function connectSSE() {
  if (SNAPSHOT_EKSTERNAL) return;
  const es = new EventSource("api/events");
  es.onmessage = (m) => {
    try {
      const msg = JSON.parse(m.data);
      if (msg.type === "state") refresh();
    } catch { /* noop */ }
  };
  es.onerror = () => {
    es.close();
    // polling 5s sudah jalan terus — SSE cuma bonus; coba ulang pelan-pelan
    sseRetry += 1;
    if (sseRetry < 6) setTimeout(connectSSE, 10_000 * sseRetry);
  };
}

refresh();
setInterval(refresh, 5000);
connectSSE();
