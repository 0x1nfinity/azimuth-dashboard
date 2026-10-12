// sim.js — penghuni kantor Azimuth. PORT dari Automation-project (Studio Pintar):
// chibi prosedural per-agent (bukan sprite RPG), path BFS, siklus hidup digerakkan
// applyState(run) dari data live bot (steps running/done/error), handoff antar-meja
// dengan dokumen terbang, idle ber-okupansi (kopi di counter / obrolan koridor /
// kickoff di depan layar besar), confetti saat posisi ditutup profit. Loop render
// berjenjang di app.js. REFACTOR 2026-10-11: kantor 1 ruangan besar — aktivitas
// kolam/teras/ruang meeting dihapus bersama area lamanya.
import { NODES, DESKS, deskChair, GATHER_SPOTS, shortestPath, hexA } from "./world.js";

const SKIN = ["#f5cba7", "#e8b48a", "#d9a066", "#c98a5b", "#f0c8a0"];

const IDLE_CHAT = [
  "Fee/TVL pool itu tipis.", "SL minggu ini kejebol 2x.", "Dump dalam stabil, menarik.",
  "Kuota token tinggal sedikit.", "Posisi kemarin +0.4%!", "Cek holder dulu, ada bundler?",
  "Bin step 100 lagi ramai.", "Es kopi dulu, manis.",
];
const KICKOFF_LINES = {
  bima: "Siklus screening mulai!", raka: "Finalis sudah kuhold.", citra: "Lesson terbaru kubaca.",
  sari: "Posisi kukawasin.", maya: "Post-mortem menyusul.", bagas: "Siaga kalau error.",
};

const rand = (a) => a[Math.floor(Math.random() * a.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- bayangan aset CC0 (satu-satunya aset karakter yang dipakai) ----------
const ASET = { shadow: null };
function muatAset() {
  if (ASET._dimuat) return ASET._dimuat;
  ASET._dimuat = new Promise((selesai) => {
    const img = new Image();
    img.onload = img.onerror = () => selesai(ASET);
    img.src = "assets/chars/shadow.png";
    ASET.shadow = img;
  });
  return ASET._dimuat;
}

// ---------- karakter chibi custom (bentuk ala claw3d, digambar 2D canvas) ----------
// Tiap agent = penampilan unik: warna kulit/gaya rambut/aksesoris.
const TAMPILAN = {
  bima:  { kulit: "#f2c69a", rambut: "slick",    warnaR: "#2f2f2f", baju: "#2563eb", akses: "kacamata" },
  bagas: { kulit: "#e8b48a", rambut: "spiky",   warnaR: "#1f2937", baju: "#475569", akses: "headset" },
  raka:  { kulit: "#f2c69a", rambut: "spiky",   warnaR: "#b45309", baju: "#0284c7" },
  citra: { kulit: "#f5cfa5", rambut: "ponytail", warnaR: "#7c2d12", baju: "#db2777" },
  sari:  { kulit: "#f2c69a", rambut: "bun",      warnaR: "#4a2c17", baju: "#0d9488" },
  maya:  { kulit: "#f2c69a", rambut: "ponytail", warnaR: "#831843", baju: "#d946ef" },
};

function gambarChibi(ctx, o) {
  // o: { x, y, t, dir, jalan, bekerja, renang, tampilan }
  const T = o.tampilan; if (!T) return;
  const x = o.x, y = o.y;
  const kaki = o.jalan ? Math.sin(o.t * 10) * 5 : 0;
  const napas = Math.sin(o.t * 2.2) * 1.2; // napas idle — hidup tapi tenang
  const menghadapBelakang = o.dir === 1;

  // kaki + sepatu
  if (!o.renang && !o.bekerja) {
    ctx.fillStyle = "#3a3f4b";
    ctx.fillRect(x - 9 + (o.jalan ? kaki : 0), y - 12, 7, 10);
    ctx.fillRect(x + 2 - (o.jalan ? kaki : 0), y - 12, 7, 10);
    ctx.fillStyle = "#20242e";
    ctx.fillRect(x - 10 + (o.jalan ? kaki : 0), y - 4, 9, 4);
    ctx.fillRect(x + 1 - (o.jalan ? kaki : 0), y - 4, 9, 4);
  }

  // badan (chibi A-line) + kerah
  ctx.fillStyle = T.baju;
  ctx.beginPath();
  ctx.moveTo(x - 11, y - 34 + napas); ctx.lineTo(x + 11, y - 34 + napas);
  ctx.lineTo(x + 13, y - 12); ctx.lineTo(x - 13, y - 12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(x - 8, y - 34 + napas, 16, 3);

  // lengan
  ctx.fillStyle = T.kulit;
  if (o.bekerja) { ctx.fillRect(x - 14, y - 28 + napas, 5, 12); ctx.fillRect(x + 9, y - 28 + napas, 5, 12); }
  else if (o.jalan) { ctx.fillRect(x - 15, y - 30 + napas, 5, 13 + kaki * 0.5); ctx.fillRect(x + 10, y - 30 + napas, 5, 13 - kaki * 0.5); }
  else { ctx.fillRect(x - 15, y - 30 + napas, 5, 13); ctx.fillRect(x + 10, y - 30 + napas, 5, 13); }

  // kepala besar (chibi)
  const hy = y - 44 + napas;
  ctx.fillStyle = T.kulit;
  ctx.beginPath(); ctx.arc(x, hy, 13, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x - 13, hy + 1, 2.5, 0, Math.PI * 2); ctx.arc(x + 13, hy + 1, 2.5, 0, Math.PI * 2); ctx.fill();

  // rambut
  ctx.fillStyle = T.warnaR;
  if (menghadapBelakang) {
    ctx.beginPath(); ctx.arc(x, hy - 1, 13, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - 13, hy - 1, 26, 8);
  } else {
    ctx.beginPath(); ctx.arc(x, hy - 2, 13, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.fillRect(x - 13, hy - 6, 26, 5);
    ctx.beginPath(); ctx.moveTo(x - 13, hy - 2);
    for (let i = 0; i <= 26; i += 6.5) ctx.lineTo(x - 13 + i, hy - 2 + (i % 13 === 0 ? 4 : 1));
    ctx.lineTo(x + 13, hy - 8); ctx.closePath(); ctx.fill();
    if (T.rambut === "ponytail" || T.rambut === "twintail" || T.rambut === "long") {
      ctx.beginPath(); ctx.ellipse(x - 14, hy + 6, 4, 10, 0.2, 0, Math.PI * 2); ctx.fill();
      if (T.rambut !== "ponytail") { ctx.beginPath(); ctx.ellipse(x + 14, hy + 6, 4, 10, -0.2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (T.rambut === "bun") { ctx.beginPath(); ctx.arc(x, hy - 14, 5, 0, Math.PI * 2); ctx.fill(); }
    if (T.rambut === "spiky") {
      for (const [dx, tg] of [[-9, 6], [-3, 8], [3, 6]]) {
        ctx.beginPath(); ctx.moveTo(x + dx, hy - 9); ctx.lineTo(x + dx + 3, hy - 9 - tg); ctx.lineTo(x + dx + 6, hy - 9); ctx.closePath(); ctx.fill();
      }
    }
    if (T.rambut === "cap") {
      ctx.beginPath(); ctx.arc(x, hy - 5, 13, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 13, hy - 7, 26, 4);
      ctx.fillRect(x + (o.dir === 2 ? -22 : 11), hy - 6, 11, 3);
    }
    if (T.rambut === "headband") { ctx.fillStyle = "#f8fafc"; ctx.fillRect(x - 13, hy - 8, 26, 4); }
  }

  // wajah
  if (!menghadapBelakang) {
    const kedip = (o.t % 3.7) < 0.12;
    ctx.fillStyle = "#24272e";
    if (kedip) { ctx.fillRect(x - 6, hy + 1, 4, 1.5); ctx.fillRect(x + 2, hy + 1, 4, 1.5); }
    else { ctx.beginPath(); ctx.arc(x - 4, hy + 1, 1.8, 0, Math.PI * 2); ctx.arc(x + 4, hy + 1, 1.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(240,130,130,0.4)";
    ctx.beginPath(); ctx.arc(x - 8, hy + 5, 2.5, 0, Math.PI * 2); ctx.arc(x + 8, hy + 5, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#8a4a3a"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, hy + 4, 3.5, 0.25, Math.PI - 0.25); ctx.stroke();
    if (T.akses === "kacamata") {
      ctx.strokeStyle = "#2b3442"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x - 4, hy + 1, 3, 0, Math.PI * 2); ctx.arc(x + 4, hy + 1, 3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 1, hy + 1); ctx.lineTo(x + 1, hy + 1); ctx.stroke();
    }
    if (T.akses === "jenggot") { ctx.fillStyle = T.warnaR; ctx.beginPath(); ctx.arc(x, hy + 9, 6, 0, Math.PI); ctx.fill(); }
    if (T.akses === "headset") {
      ctx.strokeStyle = "#111827"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(x, hy - 2, 13, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(x - 12, hy + 2, 3.2, 0, Math.PI * 2); ctx.arc(x + 12, hy + 2, 3.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// dialog serah-terima (workflow trading): pesan saat MENYERAHKAN hasil ke agent berikutnya
const HANDOFF_KIRIM = {
  raka: "Verdict finalis siap! 📊", citra: "Lesson fit, kucas kasih.", sari: "Posisi sudah diamankan! 🛡️",
  maya: "Post-mortem jadi! 📈", bima: "Keputusan terkunci! ⚖️", bagas: "Routing aman! 🧭",
};
const HANDOFF_TERIMA = {
  bima: "Kutimbang risikonya! ⚖️", sari: "SL/TP kupasang! 🛡️", maya: "Masuk ledger-ku! 📊",
  raka: "OHLCV kunjelang lagi! 🧠", citra: "Kucatat polanya! 🧹", bagas: "Kuroute balasan! 🧭",
};

export class Person {
  constructor(meta, idx) {
    this.id = meta.id;
    this.nama = meta.nama;
    this.peran = meta.peran;
    this.ikon = meta.ikon || "🙂";
    this.color = meta.warna || "#64748b";
    this.skin = SKIN[idx % SKIN.length];
    this.x = deskChair(DESKS[this.id]).x + (Math.random() * 40 - 20);
    this.y = deskChair(DESKS[this.id]).y;
    this.pose = "idle";
    this.behavior = "wander";
    this.path = [];
    this.speed = 72 + Math.random() * 20; // skala chibi 1.45× → langkah ikut panjang
    this.bubble = null;
    this.holdCup = false;
    this.statusRing = null;
    this.phase = Math.random() * 10;
    this._task = null;
    this._dir = 0;
  }

  say(text, ms = 3500) {
    this.bubble = { text, until: performance.now() + ms };
    if (this.onWake) this.onWake();
    // bangunkan renderer sekali lagi saat bubble kedaluwarsa (untuk menghapusnya)
    setTimeout(() => this.onWake && this.onWake(), ms + 120);
  }

  goTo(nodeId) {
    const here = this.nearestNodeId();
    const p = shortestPath(here, nodeId);
    if (p) { this.path = p; this.pose = "walking"; return true; }
    return false;
  }

  // berjalan ke titik koordinat bebas (bukan node) — dipakai obrolan berdua
  // supaya KIRI-KANAN BERHADAPAN, bukan menumpuk di satu node.
  goToXY(x, y) { this._pt = { x, y }; this.pose = "walking"; return true; }

  nearestNodeId() {
    let best = null, bd = Infinity;
    for (const n of Object.values(NODES)) {
      const d = dist(this, n);
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  update(dt, now) {
    if (this._pt) {
      const t = this._pt, d = dist(this, t), step = this.speed * dt;
      if (Math.abs(t.x - this.x) > Math.abs(t.y - this.y)) this._dir = t.x > this.x ? 3 : 2;
      else this._dir = t.y > this.y ? 0 : 1;
      if (d <= step) {
        this.x = t.x; this.y = t.y; this._pt = null;
        this.pose = this._arrivePose || "idle";
        if (this.pose === "sitting" && this._seatDir != null) this._dir = this._seatDir;
      } else {
        this.x += ((t.x - this.x) / d) * step;
        this.y += ((t.y - this.y) / d) * step;
      }
    } else if (this.path.length) {
      const target = NODES[this.path[0]];
      const d = dist(this, target);
      const step = this.speed * dt;
      // arah hadap dari vektor gerak (dominan sumbu terbesar)
      if (Math.abs(target.x - this.x) > Math.abs(target.y - this.y)) {
        this._dir = target.x > this.x ? 3 : 2;
      } else {
        this._dir = target.y > this.y ? 0 : 1;
      }
      if (d <= step) {
        this.x = target.x; this.y = target.y;
        this.path.shift();
        if (!this.path.length) {
          this.pose = this._arrivePose || "idle";
          // duduk di kursi council → hadap meja (bukan arah datang)
          if (this.pose === "sitting" && this._seatDir != null) this._dir = this._seatDir;
        }
      } else {
        this.x += ((target.x - this.x) / d) * step;
        this.y += ((target.y - this.y) / d) * step;
      }
    }
    if (this.bubble && now > this.bubble.until) this.bubble = null;
  }

  // -------- render person --------
  drawPerson(ctx, now) {
    this._sim && (this._sim._drawCount = (this._sim._drawCount || 0) + 1);
    const t = now / 1000 + this.phase;
    const F = 80; // tinggi visual chibi — jangkar name tag & ikon
    const jalan = this.pose === "walking";

    // SKALA 1.45× — chibi diperbesar supaya proporsional dgn furnitur revisi
    // ketiga (meja 120px); ring/bayangan/sprite ikut, name tag & balon tetap
    // digambar di koordinat dunia (font tidak ikut membesar).
    const SC = 1.45;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(SC, SC);

    // penanda identitas warna di lantai — SELALU tampil (halus)
    ctx.strokeStyle = hexA(this.color, 0.45); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 6, 22, 10, 0, 0, Math.PI * 2); ctx.stroke();

    // status ring di lantai (di bawah sprite)
    if (this.statusRing === "running") {
      ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -(now / 40) % 12;
      ctx.beginPath(); ctx.ellipse(0, 6, 24, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (this.statusRing === "error") {
      ctx.strokeStyle = `rgba(239,68,68,${0.5 + 0.4 * Math.sin(now / 130)})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 6, 24, 11, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // bayangan bawah (aset CC0)
    if (ASET.shadow?.complete && ASET.shadow.naturalWidth) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(ASET.shadow, -11, 4, 22, 10);
      ctx.globalAlpha = 1;
    }

    // karakter chibi custom
    const bob0 = jalan ? -Math.abs(Math.sin(t * 10)) * 2 : 0;
    gambarChibi(ctx, { x: 0, y: 10 + bob0, t, dir: this._dir ?? 0, jalan, bekerja: this.pose === "working" || this.pose === "sitting", renang: false, tampilan: TAMPILAN[this.id] });

    // cangkir di tangan
    if (this.holdCup) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.roundRect(10, -16, 9, 8, 2); ctx.fill();
      ctx.strokeStyle = "#7c4a2d"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(20, -12, 3.5, -1.2, 1.2); ctx.stroke();
    }

    ctx.restore();

    // Agent yang BEKERJA duduk di meja (jangkar y+102) — tag melayang di atas
    // kepala akan menempel PERSIS di wajah monitor (monitor face y-10..y+42,
    // tag dulu y+3..y+22). Fix 2026-10-12: saat bekerja, ikon+nama+balon
    // digambar MENEMPEL di MEJA (di atas monitor meja sendiri), bukan di atas
    // kepala. Di luar meja (jalan/idle/ngopi) tetap melayang di atas kepala.
    const diMeja = this.pose === "working" && DESKS[this.id];
    const meja = diMeja ? DESKS[this.id] : null;

    // ikon tugas saat bekerja (di atas name tag)
    if (this.pose === "working" || (this.id === "bagas" && this.statusRing === "running")) {
      ctx.save();
      ctx.font = "600 14px system-ui";
      if (meja) {
        // nameplate gabung "ikon nama" tepat di atas monitor meja
        const label = (this.id === "bagas" ? "🔧" : this.ikon) + " " + this.nama;
        const lw = ctx.measureText(label).width + 16;
        ctx.fillStyle = hexA(this.color, 0.92);
        ctx.beginPath(); ctx.roundRect(meja.x + 60 - lw / 2, meja.y - 36, lw, 20, 8); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, meja.x + 60, meja.y - 26);
      } else {
        const teks = this.id === "bagas" ? "🔧" : this.ikon;
        const w = 34;
        ctx.fillStyle = hexA(this.color, 0.92);
        ctx.beginPath(); ctx.roundRect(this.x - w / 2, this.y - F - 34, w, 26, 9); ctx.fill();
        ctx.beginPath(); ctx.moveTo(this.x - 5, this.y - F - 26); ctx.lineTo(this.x + 5, this.y - F - 26); ctx.lineTo(this.x, this.y - F - 19); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(teks, this.x, this.y - F - 21);
      }
      ctx.restore();
    }

    // name tag (di atas kepala — hanya saat TIDAK di meja; yang di meja sudah
    // memakai nameplate gabung di atas)
    if (!meja) {
      ctx.font = "700 13px system-ui";
      const tw = ctx.measureText(this.nama).width;
      const tagY = this.y - F - 21;
      ctx.fillStyle = "rgba(15,23,42,0.82)";
      ctx.beginPath(); ctx.roundRect(this.x - tw / 2 - 8, tagY, tw + 16, 19, 9); ctx.fill();
      if (this.statusRing === "running") { ctx.fillStyle = "#60a5fa"; ctx.beginPath(); ctx.arc(this.x - tw / 2 + 1, tagY + 9.5, 3, 0, Math.PI * 2); ctx.fill(); }
      else if (this.statusRing === "error") { ctx.fillStyle = "#f87171"; ctx.beginPath(); ctx.arc(this.x - tw / 2 + 1, tagY + 9.5, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#f8fafc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(this.nama, this.x + (this.statusRing ? 3 : 0), tagY + 10);
      ctx.textBaseline = "alphabetic";
    }

    // balon ucapan (teks — hanya saat aktif); di meja → di atas nameplate meja
    if (this.bubble) {
      ctx.save();
      ctx.font = "600 13px system-ui";
      const w = Math.max(ctx.measureText(this.bubble.text).width + 18, 30);
      const by = meja ? meja.y - 66 : this.y - F - 34;
      const bx = meja ? meja.x + 60 : this.x;
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.beginPath(); ctx.roundRect(bx - w / 2, by, w, 26, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 5, by + 26); ctx.lineTo(bx + 5, by + 26); ctx.lineTo(bx, by + 33); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(bx - w / 2, by, w, 26, 9); ctx.stroke();
      ctx.fillStyle = "#0f172a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(this.bubble.text, bx, by + 13);
      ctx.restore();
    }
  }
}

export class OfficeSim {
  constructor(agentsMeta, onEvent) {
    this.people = new Map();
    // Resilien: agent tanpa meja di world.js (mis. data lebih baru dari kode)
    // dilewati + warning — JANGAN sampai satu data asing mengosongkan seluruh kantor.
    agentsMeta.forEach((m, i) => {
      if (!DESKS[m.id]) { console.warn("[sim] agent tanpa meja, dilewati:", m.id); return; }
      this.people.set(m.id, new Person(m, i));
    });
    for (const p of this.people.values()) { p.onWake = () => this.wake(); p._sim = this; }
    this.agentsMeta = agentsMeta;
    if (typeof document !== "undefined") {
      muatAset().then(() => this.wake());
    }
    this.run = null;
    this.runIdSeen = null;
    this.kickoffUntil = 0;
    this.celebration = 0;
    this.confetti = [];
    this.counterBusy = new Set();
    this.mode = "idle";
    this._idleTimer = 0;
    this._prevRunning = null;
    this._docFly = null;
    this._prevStatus = null;
    this._wakeCb = null; // dipasang app.js: minta loop render hidup
    this._drawCount = 0;
    if (typeof window !== "undefined") window.__officeSim = this; // DEBUG: inspeksi live
  }

  wake() { if (this._wakeCb) this._wakeCb(); }
  onWake(cb) { this._wakeCb = cb; }

  person(id) { return this.people.get(id); }

  applyState(run) {
    if (!run) return;
    const isNewRun = run.runId !== this.runIdSeen;
    // kickoff HANYA utk run yang BENAR2 baru dimulai — bukan catatan lama saat
    // halaman pertama dimuat (kickoff palsu membubarkan suasana kantor).
    const runBaruDimulai = isNewRun && run.status === "running" &&
      (run.startedAt ? Date.now() - new Date(run.startedAt).getTime() < 120000 : true);
    const justStarted = this.runIdSeen !== null && runBaruDimulai;
    const justFinished = !isNewRun && this._prevStatus === "running" && run.status === "success";
    this._prevStatus = run.status;
    this.run = run;
    this.runIdSeen = run.runId;
    this.mode = run.status;

    const steps = run.steps || {};
    const working = new Set(Object.entries(steps).filter(([, s]) => s.status === "running").map(([k]) => k));

    // ===== interaksi serah-terima antar agent (workflow-based) =====
    // saat agent X selesai (done) dan Y mulai (running) → X berjalan ke Y, dialog + dokumen terbang
    const runningSekarang = [...working].filter((k) => k !== "bagas");
    const runningAktif = runningSekarang[0] || null;
    if (runningAktif && this._prevRunning && this._prevRunning !== runningAktif) {
      const dari = this._prevRunning;
      const a = this.people.get(dari), b = this.people.get(runningAktif);
      if (a && b && steps[dari]?.status === "done") {
        a._handoff = { ke: runningAktif, fase: "jalan", t: 0 };
        a.behavior = "handoff";
        this.sendTo(a, `desk_${runningAktif}`, "idle"); // A jalan ke meja B
        this._docFly = { dari: dari, ke: runningAktif, t0: 0, mulai: false };
      }
    }
    this._prevRunning = runningAktif;
    const errored = Object.entries(steps).filter(([, s]) => s.status === "error").map(([k]) => k);
    this.working = working;
    this.debugging = working.has("bagas");
    this.errorActive = errored.length > 0 && run.status === "running";

    for (const p of this.people.values()) {
      const isWorker = working.has(p.id) && p.id !== "bagas";
      if (p.id === "bagas") {
        p.statusRing = this.debugging ? "running" : this.errorActive ? "error" : null;
        continue;
      }
      if (isWorker) {
        p.statusRing = "running";
        if (p.pose !== "working" || p._task !== this._stepKey(run, p.id)) {
          p._task = this._stepKey(run, p.id);
          p.behavior = "work";
          this.sendTo(p, `desk_${p.id}`, "working");
          // agent "berbicara" saat mulai tugas — label langkah di bubble
          const label = (run.steps?.[p.id]?.label || p.peran || "Kerja!").toString().slice(0, 24);
          p.say(`${p.ikon} ${label}`, 4200);
        }
      } else if (errored.includes(p.id)) {
        p.statusRing = "error";
        if (p.behavior !== "goto-bagas") {
          p.behavior = "goto-bagas";
          p.say("Ada error, cari Bagas!", 4000);
          this.sendTo(p, "desk_bagas", "idle");
        }
      } else if (p.id !== "bima") {
        p.statusRing = null;
        if (run.status !== "running" && ["work", "supervise", "goto-bagas"].includes(p.behavior)) {
          p.behavior = "wander";
          if (p.pose === "working") this.sendTo(p, `desk_${p.id}`, "idle");
        }
      }
    }
    const bima = this.person("bima");
    if (bima) {
      bima.statusRing = run.status === "running" ? "running" : null;
      if (run.status === "running" && bima.behavior !== "supervise" && bima.pose !== "walking") {
        bima.behavior = "supervise";
        this.sendTo(bima, "desk_bima", "working");
      } else if (run.status !== "running" && bima.behavior === "supervise") {
        // run selesai: lepas dari supervise — else dia terkunci pose "working"
        // selamanya dan tak pernah ikut ngopi/berenang (tickIdle anggap dia busy)
        bima.behavior = "wander";
        this.sendTo(bima, `desk_${bima.id}`, "idle");
      }
    }

    if (justStarted) this.startKickoff();
    if (justFinished) this.celebrate();
    this.wake();
  }

  _stepKey(run, id) { return `${run.runId}:${id}:${(run.steps?.[id] || {}).attempts ?? 0}`; }

  sendTo(p, nodeId, pose) {
    p._arrivePose = pose;
    if (!p.goTo(nodeId) && pose) p.pose = pose;
    this.wake();
  }

  sendToXY(p, x, y, pose) {
    p._arrivePose = pose;
    p.goToXY(x, y);
    this.wake();
  }

  startKickoff() {
    const slots = [...this.people.values()];
    slots.forEach((p, i) => {
      const kursi = i % GATHER_SPOTS.length;
      p.behavior = "meeting";
      p.statusRing = null;
      p.holdCup = false;
      p._seatDir = GATHER_SPOTS[kursi].dir; // hadap meja bundar saat duduk
      this.sendTo(p, `gather_${kursi}`, "sitting");
      setTimeout(() => p.say(KICKOFF_LINES[p.id] || "Siap!", 4000), 1200 + i * 350);
    });
    this.kickoffUntil = performance.now() + 6000;
    setTimeout(() => this.disperseMeeting(), 6500);
  }

  disperseMeeting() {
    for (const p of this.people.values()) {
      if (p.behavior !== "meeting") continue;
      p.behavior = "wander";
      p._seatDir = null;
      if (this.working?.has(p.id) && p.id !== "bagas") this.sendTo(p, `desk_${p.id}`, "working");
      else if (p.id === "bagas" && this.debugging) this.sendTo(p, "desk_bagas", "working");
      else this.sendTo(p, `desk_${p.id}`, "idle");
    }
    this.wake();
  }

  celebrate() {
    this.celebration = performance.now() + 2600;
    const cx = 500, cy = 340; // tengah ruangan
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
      this.confetti.push({
        x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        color: rand(["#f472b6", "#facc15", "#4ade80", "#60a5fa", "#c084fc"]),
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, life: 2.6,
      });
    }
    for (const p of this.people.values()) p.say("Yes! Posisi profit! 🎉", 4000);
    [...this.people.values()].forEach((p, i) => {
      const kursi = i % GATHER_SPOTS.length;
      p.behavior = "meeting";
      p._seatDir = GATHER_SPOTS[kursi].dir;
      this.sendTo(p, `gather_${kursi}`, "sitting");
    });
    setTimeout(() => this.disperseMeeting(), 9000);
    this.wake();
  }

  // -------- perilaku idle --------
  tickIdle(dt, now) {
    if (now < this.kickoffUntil || now < this.celebration) return;
    // jam dinding sendiri: saat loop tidur (tier diam) tick hanya datang per
    // 800 ms lewat heartbeat dengan dt kecil — kalau pakai dt itu, _idleTimer
    // 1,2 dtk butuh ~60 dtk nyata per keputusan → kantor tampak mati.
    const dtIdle = Math.min(2, (now - (this._lastIdleNow ?? now)) / 1000);
    this._lastIdleNow = now;
    this._idleTimer -= dtIdle;
    if (this._idleTimer > 0) return;
    this._idleTimer = 1.2;

    for (const p of this.people.values()) {
      const busy = p.pose === "walking" || p.behavior === "work" || p.behavior === "meeting" ||
        p.behavior === "goto-bagas" || p.behavior === "supervise" || p.behavior === "handoff";
      if (busy) continue;
      if (Math.random() > 0.10) continue;

      const r = Math.random();
      if (r < 0.25) { // ngopi di counter kiri (okupansi — tak bisa didua)
        const spot = this.counterBusy.has("coffee_0") ? (this.counterBusy.has("coffee_1") ? null : "coffee_1") : "coffee_0";
        if (spot) {
          this.counterBusy.add(spot);
          p.behavior = "coffee";
          this.sendTo(p, spot, "idle");
          setTimeout(() => { p.holdCup = true; p.say(rand(["Kopi dulu~", "Es kopi, manis!"]), 3000); }, 1500);
          setTimeout(() => {
            p.holdCup = false; this.counterBusy.delete(spot); p.behavior = "wander";
            this.sendTo(p, rand(["h2_400", "h2_620", "h2_88"]), "idle");
          }, 9000 + Math.random() * 4000);
        }
      } else if (r < 0.55) { // ngobrol berdua di koridor
        const others = [...this.people.values()].filter(
          (o) => o !== p && o.pose !== "walking" && !this.working?.has(o.id) && o.behavior !== "work" && o.behavior !== "meeting"
        );
        const partner = rand(others);
        if (partner) {
          p.behavior = partner.behavior = "chat";
          const spot = NODES[rand(["h1_400", "h2_500", "h1_620", "h2_88"])];
          // berdua BERHADAPAN kiri↔kanan dengan jarak — dulu satu titik (menumpuk)
          this.sendToXY(p, spot.x - 19, spot.y, "idle");
          this.sendToXY(partner, spot.x + 19, spot.y, "idle");
          const line = rand(IDLE_CHAT);
          setTimeout(() => {
            p._dir = 3; partner._dir = 2; // saling menatap
            p.say(line, 4000); partner.say(rand(["Setuju!", "Haha, iya", "Nanti kubantu"]), 3000);
          }, 2500);
          setTimeout(() => { p.behavior = partner.behavior = "wander"; }, 8000);
        }
      } else { // jalan santai / pulang ke meja
        p.behavior = "wander";
        this.sendTo(p, Math.random() < 0.5 ? `desk_${p.id}` : rand(["h1_196", "h2_500", "h1_840"]), "idle");
      }
    }
  }

  tick(dt, now) {
    this.tickIdle(dt, now);
    for (const p of this.people.values()) p.update(dt, now);
    this.tickHandoff(now);
    // dokumen terbang: animasi 1.1 dtk dari A ke B
    if (this._docFly && this._docFly.mulai) {
      const d = this._docFly;
      d.t0 += dt;
      if (d.t0 > 1.1) this._docFly = null;
      if (this._wakeCb) this._wakeCb();
    }
    this.confetti = this.confetti.filter((c) => (c.life -= dt) > 0);
    for (const c of this.confetti) {
      c.vy += 190 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
    }
  }

  tickHandoff(now) {
    for (const p of this.people.values()) {
      const h = p._handoff;
      if (!h) continue;
      const b = this.people.get(h.ke);
      if (!b) { p._handoff = null; p.behavior = "wander"; continue; }
      if (h.fase === "jalan") {
        // sampai di dekat meja B (pose berhenti) → mulai bicara
        if (p.pose !== "walking") {
          h.fase = "bicara"; h.t = now;
          // hadap partner
          p._dir = b.x > p.x + 6 ? 3 : b.x < p.x - 6 ? 2 : 0;
          b._dir = p.x > b.x + 6 ? 3 : p.x < b.x - 6 ? 2 : 0;
          p.say(HANDOFF_KIRIM[p.id] || "Selesai — ini hasilnya! 📄", 2600);
          b.say(HANDOFF_TERIMA[b.id] || "Siap, kulanjutkan! 💪", 2600);
          if (this._docFly) { this._docFly.mulai = true; this._docFly.t0 = 0; }
          this.wake();
        }
      } else if (h.fase === "bicara" && now - h.t > 2600) {
        p._handoff = null;
        p.behavior = "wander";
        this.sendTo(p, `desk_${p.id}`, "idle"); // A pulang ke mejanya
      }
    }
  }

  workingSet() { return this.working || new Set(); }

  // jenjang aktivitas render: "penuh" | "sedang" | "diam"
  tierRender() {
    const now = performance.now();
    if (this.confetti.length) return "penuh";
    if (now < this.kickoffUntil || now < this.celebration) return "penuh";
    for (const p of this.people.values()) {
      if (p.pose === "walking") return "penuh";
      if (p.bubble) return "penuh";
    }
    if (this.working?.size || this.errorActive) return "sedang";
    return "diam";
  }

  // -------- render (chibi + dokumen terbang + confetti) --------
  draw(ctx, now) {
    const people = [...this.people.values()].sort((a, b) => a.y - b.y);
    for (const p of people) p.drawPerson(ctx, now);
    this.drawDocFly(ctx);
    this.drawConfetti(ctx);
  }

  drawDocFly(ctx) {
    const d = this._docFly;
    if (!d || !d.mulai) return;
    const a = this.people.get(d.dari), b = this.people.get(d.ke);
    if (!a || !b) return;
    const p = Math.min(1, d.t0 / 1.1);
    const e = 1 - Math.pow(1 - p, 2); // ease-out
    const x = a.x + (b.x - a.x) * e;
    const y = a.y + (b.y - a.y) * e - Math.sin(p * Math.PI) * 60; // busur ke atas
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(p * Math.PI * 2) * 0.15);
    ctx.fillStyle = "#fdf6e3";
    ctx.fillRect(-9, -12, 18, 24);
    ctx.strokeStyle = "#b4a582"; ctx.lineWidth = 1.4;
    ctx.strokeRect(-9, -12, 18, 24);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = "#c9b98f"; ctx.fillRect(-6, -8 + i * 5, 12, 2); }
    ctx.restore();
  }

  drawConfetti(ctx) {
    if (!this.confetti.length) return;
    for (const c of this.confetti) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillStyle = c.color; ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillRect(-4, -2, 8, 4); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
