'use strict';
// Schach-Trainer – Oberfläche, Bot, Rätsel und Partieanalyse (komplett offline)

const C = chessEngineFactory();
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

// ---------- Hilfsfunktionen ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('schach_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('schach_' + k, JSON.stringify(v)); } catch (e) { /* privat/voll */ } }
};

function bind(root, actions) {
  root.querySelectorAll('[data-act]').forEach(b => {
    b.onclick = e => { const a = actions[b.dataset.act]; if (a) a(b.dataset.arg, e); };
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function isMateScore(s) { return Math.abs(s) > C.MATE_BOUND; }
function mateIn(s) { return Math.ceil((C.MATE - Math.abs(s)) / 2); }
function fmtEval(cpWhite) {
  if (cpWhite == null) return '';
  if (isMateScore(cpWhite)) {
    const n = mateIn(cpWhite);
    return n === 0 ? '#' : (cpWhite > 0 ? '' : '-') + 'M' + n;
  }
  const v = cpWhite / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}
// Deutsche Figurenbuchstaben für die Anzeige (PGN bleibt international)
const de = san => san.replace(/[NBRQ]/g, c => ({ N: 'S', B: 'L', R: 'T', Q: 'D' })[c]);
const fromDe = san => san.replace(/[SLTD]/g, c => ({ S: 'N', L: 'B', T: 'R', D: 'Q' })[c]);
function winPct(cpWhite) {
  if (isMateScore(cpWhite)) return cpWhite > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cpWhite)) - 1);
}

// ---------- Ton (synthetisiert, kein Download nötig) ----------
const Sound = {
  on: store.get('sound', true),
  ctx: null,
  audio() {
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  // Holz-Klick: gefiltertes Rauschen + kurzer tiefer Schlag
  click(at, vol, freq, dur) {
    const ctx = this.audio(), t = ctx.currentTime + (at || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.4;
    g.gain.value = vol * 1.6;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    og.gain.setValueAtTime(vol * 0.35, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og).connect(ctx.destination); o.start(t); o.stop(t + 0.08);
  },
  tones(notes, type, vol) {
    const ctx = this.audio();
    let t = ctx.currentTime;
    for (const [f, d] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(vol || 0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d);
      t += d * 0.75;
    }
  },
  play(type) {
    if (!this.on) return;
    try {
      switch (type) {
        case 'move': this.click(0, 0.9, 1700, 0.045); break;
        case 'capture': this.click(0, 1, 1100, 0.06); this.click(0.055, 0.7, 1900, 0.04); break;
        case 'castle': this.click(0, 0.8, 1700, 0.045); this.click(0.11, 0.8, 1500, 0.045); break;
        case 'check': this.click(0, 0.9, 1700, 0.045); this.tones([[880, 0.12]], 'triangle', 0.1); break;
        case 'ui': this.click(0, 0.18, 3200, 0.02); break;
        case 'end': this.tones([[523, 0.15], [659, 0.15], [784, 0.35]], 'triangle'); break;
        case 'good': this.tones([[660, 0.1], [990, 0.2]], 'triangle'); break;
        case 'brilliant': this.tones([[784, 0.08], [988, 0.08], [1319, 0.25]], 'triangle', 0.12); break;
        case 'bad': this.tones([[200, 0.22]], 'sawtooth', 0.07); break;
        default: this.click(0, 0.9, 1700, 0.045);
      }
    } catch (e) { /* kein Audio */ }
  },
  forMove(rec, pos) {
    if (pos.status() === 'checkmate') { this.play('capture'); setTimeout(() => this.play('end'), 150); }
    else if (pos.inCheck()) this.play('check');
    else if (rec.san.startsWith('O-O')) this.play('castle');
    else this.play(rec.capture ? 'capture' : 'move');
  }
};

// ---------- Engine im Hintergrund (Web Worker) ----------
function engineHandler(C, eng, msg) {
  const pos = new C.Position(msg.fen);
  for (const u of msg.moves || []) { const m = pos.fromUci(u); if (!m) break; pos.make(m); }
  const pvUci = pv => { const p = pos.clone(), out = []; for (const m of pv) { out.push(p.toUci(m)); p.make(m); } return out; };
  if (msg.cmd === 'search') {
    const exclude = (msg.exclude || []).map(u => pos.fromUci(u)).filter(Boolean);
    const r = eng.search(pos, { timeMs: msg.timeMs || 1000, maxDepth: msg.maxDepth, exclude: exclude.length ? exclude : null });
    return { move: r.move ? pos.toUci(r.move) : null, score: r.score, depth: r.depth, pv: pvUci(r.pv) };
  }
  if (msg.cmd === 'bot') {
    const L = msg.level;
    if (L.time && !L.style) { const r = eng.search(pos, { timeMs: L.time }); return { move: r.move ? pos.toUci(r.move) : null }; }
    const sc = eng.rootScores(pos, L.depth, L.maxMs || 2500);
    if (!sc.length) return { move: null };
    // Persönlichkeit: Bonus für Züge, die zum Spielstil passen
    if (L.style) {
      const us = pos.side, ek = pos.kingSq[us ^ 1], ok = pos.kingSq[us];
      const V = [0, 1, 3, 3, 5, 9, 0];
      for (const x of sc) {
        if (Math.abs(x.score) > 5000) continue;
        const m = x.move, to = C.mTo(m), from = C.mFrom(m), fl = C.mFlags(m);
        const mover = pos.board[from] & 7, victim = pos.board[to] & 7;
        pos.make(m);
        const check = pos.inCheck();
        pos.unmake();
        const dist = (a, b) => Math.max(Math.abs((a >> 4) - (b >> 4)), Math.abs((a & 7) - (b & 7)));
        let bonus = 0;
        if (L.style === 'attack') {
          if (check) bonus += 35;
          if (fl & C.F_CAP) bonus += 15;
          if (mover !== 6 && mover !== 1) bonus += (7 - dist(to, ek)) * 5;
          if (mover === 1 && dist(to, ek) <= 3) bonus += 15;
        } else if (L.style === 'trade') {
          if ((fl & C.F_CAP) && victim && V[victim] >= V[mover] - 1) bonus += 30 + (victim === 5 ? 30 : 0);
        } else if (L.style === 'defend') {
          if (fl & C.F_CASTLE) bonus += 50;
          if (mover !== 6 && dist(to, ok) <= 2) bonus += 12;
          if (mover === 1 && dist(from, ok) <= 1) bonus -= 30;
          if (check) bonus -= 10;
        }
        x.score += bonus;
      }
    }
    let pick = sc[0];
    if (Math.random() < (L.blunder || 0)) pick = sc[Math.floor(Math.random() * sc.length)];
    else {
      let best = -Infinity;
      for (const x of sc) { const v = x.score + Math.random() * L.noise; if (v > best) { best = v; pick = x; } }
    }
    return { move: pos.toUci(pick.move) };
  }
  return null;
}

class EngineClient {
  constructor() { this.seq = 0; this.pending = new Map(); this.start(); }
  start() {
    this.worker = null;
    try {
      const src = `const C=(${chessEngineFactory.toString()})();const eng=new C.Engine(20);` +
        `const handler=${engineHandler.toString()};` +
        `self.onmessage=e=>{let r=null;try{r=handler(C,eng,e.data)}catch(err){r=null}self.postMessage({id:e.data.id,result:r})};`;
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = e => {
        const p = this.pending.get(e.data.id);
        if (p) { this.pending.delete(e.data.id); p.resolve(e.data.result); }
      };
      this.worker.onerror = () => {
        // Worker nicht erlaubt (z. B. strenge Browser-Einstellungen) → im Hauptthread rechnen
        this.worker = null;
        const jobs = [...this.pending.values()];
        this.pending.clear();
        for (const j of jobs) this.runLocal(j.msg).then(j.resolve);
      };
    } catch (e) { this.worker = null; }
  }
  runLocal(msg) {
    return new Promise(res => setTimeout(() => {
      this.local = this.local || new C.Engine(18);
      let r = null;
      try { r = engineHandler(C, this.local, msg); } catch (e) { r = null; }
      res(r);
    }, 30));
  }
  request(msg) {
    msg.id = ++this.seq;
    if (!this.worker) return this.runLocal(msg);
    return new Promise(resolve => { this.pending.set(msg.id, { resolve, msg }); this.worker.postMessage(msg); });
  }
  cancel() {
    if (!this.worker) return;
    this.worker.terminate();
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
    this.start();
  }
}
const engine = new EngineClient();       // Bot, Hinweise, Rätsel
const analysisEngine = new EngineClient(); // Partieanalyse
let freeEngine = null;                       // Analysebrett (eigener Prozess, wird bei neuer Stellung abgebrochen)

// ---------- Partie ----------
class Game {
  constructor(startFen) {
    this.startFen = startFen || C.START_FEN;
    this.pos = new C.Position(this.startFen);
    this.moves = [];
  }
  play(uci) {
    const m = this.pos.fromUci(uci);
    if (!m) return null;
    const san = this.pos.toSan(m);
    const rec = { uci, san, from: C.mFrom(m), to: C.mTo(m), capture: !!(C.mFlags(m) & C.F_CAP), side: this.pos.side };
    this.pos.make(m);
    this.moves.push(rec);
    return rec;
  }
  undo() { if (!this.moves.length) return; this.pos.unmake(); this.moves.pop(); }
  positionAt(ply) {
    const p = new C.Position(this.startFen);
    for (let i = 0; i < ply && i < this.moves.length; i++) p.make(p.fromUci(this.moves[i].uci));
    return p;
  }
  uci() { return this.moves.map(m => m.uci); }
  static fromUci(startFen, list) {
    const g = new Game(startFen);
    for (const u of list) if (!g.play(u)) break;
    return g;
  }
  pgn(h) {
    const date = new Date(h.date || Date.now());
    const d = date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + String(date.getDate()).padStart(2, '0');
    let s = `[Event "Schach-Trainer"]\n[Date "${d}"]\n[White "${h.white || '?'}"]\n[Black "${h.black || '?'}"]\n[Result "${h.result || '*'}"]\n`;
    if (this.startFen !== C.START_FEN) s += `[SetUp "1"]\n[FEN "${this.startFen}"]\n`;
    s += '\n';
    const p = new C.Position(this.startFen);
    let num = p.full, out = [];
    this.moves.forEach((m, i) => {
      if (m.side === 0) out.push(num + '. ' + m.san);
      else { out.push((i === 0 ? num + '... ' : '') + m.san); num++; }
    });
    return s + out.join(' ') + ' ' + (h.result || '*');
  }
}

function parsePgn(text) {
  const headers = {};
  text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, k, v) => { headers[k] = v; return ''; });
  let body = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, ' ');
  body = body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ').replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/g, ' ');
  const g = new Game(headers.FEN || C.START_FEN);
  for (const tok of body.split(/\s+/).filter(Boolean)) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    const m = g.pos.fromSan(fromDe(tok));
    if (!m) throw new Error('Ungültiger Zug: ' + tok);
    g.play(g.pos.toUci(m));
  }
  return { game: g, headers };
}

const STATUS_TEXT = {
  placement: 'Einstufung beendet', timeout: 'Zeit abgelaufen',
  checkmate: 'Schachmatt', stalemate: 'Patt', insufficient: 'Ungenügendes Material',
  fifty: '50-Züge-Regel', repetition: 'Dreifache Stellungswiederholung', resign: 'Aufgabe'
};

// ---------- Brett ----------
const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
// Figurensätze (SVG von lichess.org, freie Lizenzen – siehe pieces/LIZENZEN.md)
const PIECE_SETS = [
  { id: 'cburnett', name: 'Klassisch' }, { id: 'merida', name: 'Turnier' }, { id: 'chessnut', name: 'Modern' },
  { id: 'fantasy', name: 'Fantasie' }, { id: 'celtic', name: 'Keltisch' }, { id: 'spatial', name: 'Kristall' },
  { id: 'papercut', name: 'Papier' }, { id: 'rhosgfx', name: 'Holz' }, { id: 'kiwen-suwi', name: 'Minimal' },
  { id: 'unicode', name: 'Schrift' }
];
let pieceSet = store.get('pieceSet', 'cburnett');
if (!PIECE_SETS.some(s => s.id === pieceSet)) pieceSet = 'cburnett';
const pieceSrc = (set, p) => `pieces/${set}/${p >> 3 ? 'b' : 'w'}${' PNBRQK'[p & 7]}.svg`;
const pieceHtml = p => pieceSet === 'unicode'
  ? `<span class="piece ${p >> 3 ? 'b' : 'w'}">${GLYPH[p & 7]}︎</span>`
  : `<img class="piece piece-img" src="${pieceSrc(pieceSet, p)}" alt="" draggable="false">`;

const preloaded = [];
function preloadPieces(set) {
  if (set === 'unicode') return;
  for (const p of [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]) { const img = new Image(); img.src = pieceSrc(set, p); preloaded.push(img); }
}
preloadPieces(pieceSet);

function openPieceChooser() {
  const prev = s => s.id === 'unicode'
    ? `<span class="pc-uni">${GLYPH[2]}︎</span><span class="pc-uni b">${GLYPH[5]}︎</span>`
    : `<img src="${pieceSrc(s.id, 2)}" alt=""><img src="${pieceSrc(s.id, 13)}" alt="">`;
  showModal(`<h2>🎨 Figuren</h2><div class="pc-grid">${PIECE_SETS.map(s => `<button class="pc ${s.id === pieceSet ? 'active' : ''}" data-act="pick" data-arg="${s.id}"><div class="pc-prev">${prev(s)}</div>${s.name}</button>`).join('')}</div>
    <button class="btn primary full" data-act="close">Fertig</button>
    <p class="muted small" style="margin-bottom:0">Figuren von lichess.org-Künstlern unter freien Lizenzen (GPL, MIT, Apache, CC) – Details in pieces/LIZENZEN.md.</p>`, {
    pick: id => { pieceSet = id; store.set('pieceSet', id); preloadPieces(id); board.render(); openPieceChooser(); },
    close: () => { hideModal(); if (mode === 'home') Home.render(); }
  });
}

class Board {
  constructor(wrap) {
    this.wrap = wrap;
    this.flipped = false;
    this.movable = -1;
    this.onMove = null;
    this.sel = -1;
    this.dragFrom = -1;
    this.pos = new C.Position();
    this.opts = {};
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    wrap.appendChild(this.grid);
    this.sqEls = [];
    for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) {
      const d = document.createElement('div');
      this.sqEls[r * 16 + f] = d;
    }
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'arrows');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    wrap.appendChild(this.svg);
    this.layout();
    wrap.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.drag(e));
    window.addEventListener('pointerup', e => this.up(e));
    wrap.addEventListener('contextmenu', e => e.preventDefault());
  }
  sqAt(row, col) { return (this.flipped ? row : 7 - row) * 16 + (this.flipped ? 7 - col : col); }
  rowCol(sq) { const r = sq >> 4, f = sq & 7; return this.flipped ? [r, 7 - f] : [7 - r, f]; }
  layout() {
    this.grid.innerHTML = '';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) this.grid.appendChild(this.sqEls[this.sqAt(row, col)]);
  }
  setFlipped(v) {
    if (this.flipped === v) return;
    this.flipped = v;
    this.layout();
    this.render();
    EvalBar.flip(v);
  }
  set(pos, opts) { this.pos = pos; this.opts = opts || {}; this.sel = -1; this.render(this.opts.animate); }
  setOpts(o) { Object.assign(this.opts, o); this.render(); }
  targets() { return this.sel < 0 ? [] : this.pos.legalMoves().filter(m => C.mFrom(m) === this.sel); }

  render(animate) {
    const o = this.opts, b = this.pos.board;
    const tset = new Set(this.targets().map(m => C.mTo(m)));
    const checkSq = this.pos.inCheck() ? this.pos.kingSq[this.pos.side] : -1;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const d = this.sqEls[sq];
      let cls = 'sq ' + (((sq >> 4) + (sq & 7)) % 2 ? 'light' : 'dark');
      if (o.last && (o.last[0] === sq || o.last[1] === sq)) cls += ' last';
      if (sq === this.sel) cls += ' sel';
      if (sq === checkSq) cls += ' check';
      if (o.marks && o.marks[sq]) cls += ' ' + o.marks[sq];
      if (tset.has(sq)) cls += ' target' + (b[sq] ? ' occupied' : '');
      d.className = cls;
      let html = b[sq] ? pieceHtml(b[sq]) : '';
      const [row, col] = this.rowCol(sq);
      if (col === 0) html += `<span class="coord rank">${(sq >> 4) + 1}</span>`;
      if (row === 7) html += `<span class="coord file">${'abcdefgh'[sq & 7]}</span>`;
      if (o.stars && o.stars.includes(sq)) html += '<span class="star">⭐</span>';
      if (o.badge && o.badge.sq === sq) html += `<span class="badge" style="background:${o.badge.color}">${o.badge.sym}</span>`;
      // nur ändern, wenn sich der Inhalt wirklich geändert hat – so bleiben die Figurenbilder stehen
      if (d._html !== html) { d.innerHTML = html; d._html = html; }
      const pe = d.firstChild;
      if (pe && pe.classList && pe.classList.contains('piece')) pe.classList.toggle('dragging', sq === this.dragFrom && !!this.dragging);
    }
    this.wrap.classList.toggle('movable', this.movable >= 0);
    this.drawArrows(o.arrows || []);
    if (animate) this.animate(animate[0], animate[1]);
  }

  animate(from, to) {
    const el = this.sqEls[to].querySelector('.piece');
    if (!el) return;
    const size = this.wrap.clientWidth / 8;
    const [r1, c1] = this.rowCol(from), [r2, c2] = this.rowCol(to);
    el.style.transition = 'none';
    el.style.transform = `translate(${(c1 - c2) * size}px, ${(r1 - r2) * size}px)`;
    el.getBoundingClientRect();
    requestAnimationFrame(() => {
      el.style.transition = 'transform .18s ease-out';
      el.style.transform = '';
    });
  }

  drawArrows(list) {
    let s = '';
    for (const a of list) {
      const [r1, c1] = this.rowCol(a.from), [r2, c2] = this.rowCol(a.to);
      const x1 = c1 + .5, y1 = r1 + .5, x2 = c2 + .5, y2 = r2 + .5;
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const w = .09, hw = .26, hl = .4, start = .15;
      const sx = x1 + ux * start, sy = y1 + uy * start, bx = x2 - ux * hl, by = y2 - uy * hl;
      const P = (x, y) => x.toFixed(3) + ',' + y.toFixed(3);
      const pts = [P(sx + nx * w, sy + ny * w), P(bx + nx * w, by + ny * w), P(bx + nx * hw, by + ny * hw), P(x2, y2),
        P(bx - nx * hw, by - ny * hw), P(bx - nx * w, by - ny * w), P(sx - nx * w, sy - ny * w)];
      s += `<polygon points="${pts.join(' ')}" fill="${a.color || 'rgba(255,170,0,.8)'}" opacity=".85"/>`;
    }
    this.svg.innerHTML = s;
  }

  sqFromPoint(x, y) {
    const r = this.grid.getBoundingClientRect();
    const col = Math.floor((x - r.left) / (r.width / 8)), row = Math.floor((y - r.top) / (r.height / 8));
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return this.sqAt(row, col);
  }

  down(e) {
    if (e.button !== 0 || this.promoOpen) return;
    const sq = this.sqFromPoint(e.clientX, e.clientY);
    if (sq < 0) return;
    if (this.editHandler) { this.editHandler(sq); e.preventDefault(); return; }
    if (this.sel >= 0 && this.sel !== sq && this.targets().some(m => C.mTo(m) === sq)) { this.tryMove(this.sel, sq); return; }
    const p = this.pos.board[sq];
    if (this.movable >= 0 && p && (p >> 3) === this.movable && this.pos.side === this.movable) {
      this.wasSelected = this.sel === sq;
      this.sel = sq;
      this.dragFrom = sq;
      this.dragStart = [e.clientX, e.clientY];
      this.dragging = false;
      this.render();
      e.preventDefault();
    } else if (this.sel >= 0) { this.sel = -1; this.render(); }
  }

  drag(e) {
    if (this.dragFrom < 0) return;
    if (!this.dragging) {
      if (Math.hypot(e.clientX - this.dragStart[0], e.clientY - this.dragStart[1]) < 5) return;
      this.dragging = true;
      this.ghost = document.createElement('div');
      this.ghost.className = 'ghost';
      this.ghost.innerHTML = pieceHtml(this.pos.board[this.dragFrom]);
      document.body.appendChild(this.ghost);
      const pe = this.sqEls[this.dragFrom].querySelector('.piece');
      if (pe) pe.classList.add('dragging');
    }
    this.ghost.style.left = e.clientX + 'px';
    this.ghost.style.top = e.clientY + 'px';
    const sq = this.sqFromPoint(e.clientX, e.clientY);
    if (sq !== this.hoverSq) {
      if (this.hoverSq >= 0 && this.sqEls[this.hoverSq]) this.sqEls[this.hoverSq].classList.remove('hover');
      this.hoverSq = sq;
      if (sq >= 0) this.sqEls[sq].classList.add('hover');
    }
  }

  up(e) {
    if (this.dragFrom < 0) return;
    const from = this.dragFrom;
    this.dragFrom = -1;
    if (this.dragging) {
      this.dragging = false;
      this.ghost.remove();
      if (this.hoverSq >= 0 && this.sqEls[this.hoverSq]) this.sqEls[this.hoverSq].classList.remove('hover');
      this.hoverSq = -1;
      const sq = this.sqFromPoint(e.clientX, e.clientY);
      if (sq >= 0 && sq !== from && this.targets().some(m => C.mTo(m) === sq)) { this.tryMove(from, sq); return; }
      this.render();
    } else if (this.wasSelected) { this.sel = -1; this.render(); }
  }

  tryMove(from, to) {
    const ms = this.pos.legalMoves().filter(m => C.mFrom(m) === from && C.mTo(m) === to);
    this.sel = -1;
    if (!ms.length) { this.render(); return; }
    if (ms.length > 1) {
      this.askPromo(this.pos.side).then(pr => {
        const m = pr && ms.find(x => C.mPromo(x) === pr);
        if (!m) { this.render(); return; }
        if (this.onMove) this.onMove(this.pos.toUci(m));
      });
      return;
    }
    if (this.onMove) this.onMove(this.pos.toUci(ms[0]));
  }

  askPromo(color) {
    return new Promise(res => {
      this.promoOpen = true;
      const ov = document.createElement('div');
      ov.className = 'promo';
      ov.innerHTML = '<div class="promo-box">' + [5, 4, 3, 2].map(t => `<button data-t="${t}">${pieceHtml(t | (color << 3))}</button>`).join('') + '</div>';
      const done = v => { this.promoOpen = false; ov.remove(); res(v); };
      ov.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const b = e.target.closest('button');
        done(b ? +b.dataset.t : null);
      });
      this.wrap.appendChild(ov);
    });
  }
}

const EvalBar = {
  el: null, fill: null, txt: null,
  init() { this.el = $('evalbar'); this.fill = $('evalfill'); this.txt = $('evaltext'); },
  show(v) { this.el.style.display = v ? '' : 'none'; resize(); },
  flip(v) { this.el.classList.toggle('flipped', v); this.set(this.last); },
  set(cpWhite) {
    this.last = cpWhite;
    if (cpWhite == null) { this.fill.style.height = '50%'; this.txt.textContent = ''; return; }
    const pct = isMateScore(cpWhite) ? (cpWhite > 0 ? 100 : 0) : Math.max(4, Math.min(96, winPct(cpWhite)));
    this.fill.style.height = pct + '%';
    this.txt.textContent = fmtEval(cpWhite).replace('+', '');
    const whiteAhead = cpWhite >= 0;
    const atBottom = whiteAhead !== this.el.classList.contains('flipped');
    this.txt.style.top = atBottom ? 'auto' : '4px';
    this.txt.style.bottom = atBottom ? '4px' : 'auto';
    this.txt.style.color = whiteAhead ? '#333' : '#eee';
  }
};

// Spielerleisten über/unter dem Brett
function capturedInfo(pos, color) {
  const start = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 };
  const cnt = [{ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }];
  const V = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
  let mat = [0, 0];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = pos.board[sq], t = p & 7;
    if (!p || t === 6) continue;
    cnt[p >> 3][t]++;
    mat[p >> 3] += V[t];
  }
  const opp = color ^ 1;
  let s = '';
  for (const t of [5, 4, 3, 2, 1]) for (let i = cnt[opp][t]; i < start[t]; i++) s += GLYPH[t] + '︎';
  const diff = mat[color] - mat[opp];
  return s + (diff > 0 ? ` <span class="sub">+${diff}</span>` : '');
}
function setStrip(where, info) {
  const el = $(where === 'top' ? 'stripTop' : 'stripBottom');
  if (!info) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="avatar">${info.avatar || '🙂'}</div><div>${esc(info.name)} ${info.sub ? `<span class="sub">${esc(info.sub)}</span>` : ''}</div>` +
    (info.pos ? `<div class="captured">${capturedInfo(info.pos, info.color)}</div>` : '') +
    (info.thinking ? '<div class="thinking">denkt nach …</div>' : '') +
    (info.clock ? `<div class="clock" data-color="${info.color}"></div>` : '');
}

// Genauigkeit (0–100) grob in Elo umrechnen
function eloFromAccuracy(acc) {
  const pts = [[0, 200], [50, 400], [70, 1000], [80, 1400], [90, 1900], [95, 2200], [100, 2500]];
  for (let k = 1; k < pts.length; k++) if (acc <= pts[k][0]) {
    const [a0, e0] = pts[k - 1], [a1, e1] = pts[k];
    return e0 + (acc - a0) / (a1 - a0) * (e1 - e0);
  }
  return 2500;
}
// Durchschnittlicher Centipawn-Verlust grob in Elo umrechnen
function eloFromAcpl(acpl) {
  const pts = [[0, 2700], [15, 2400], [30, 2000], [50, 1600], [75, 1250], [100, 1000], [125, 800], [150, 650], [200, 450], [300, 300], [400, 250]];
  for (let k = 1; k < pts.length; k++) if (acpl <= pts[k][0]) {
    const [a0, e0] = pts[k - 1], [a1, e1] = pts[k];
    return e0 + (acpl - a0) / (a1 - a0) * (e1 - e0);
  }
  return 300;
}
const accFromLoss = loss => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

// ---------- Bots ----------
const BOTS = [
  { name: 'Bruno', ladder: true, emoji: '🐣', elo: 400, depth: 1, noise: 400, blunder: 0.3, desc: 'Lernt gerade die Regeln' },
  { name: 'Lina', ladder: true, emoji: '🐢', elo: 600, depth: 1, noise: 250, blunder: 0.15, desc: 'Übersieht oft Figuren' },
  { name: 'Max', ladder: true, emoji: '🦊', elo: 800, depth: 2, noise: 160, blunder: 0.08, desc: 'Gelegenheitsspieler' },
  { name: 'Emma', ladder: true, emoji: '🐼', elo: 1000, depth: 2, noise: 90, blunder: 0.04, desc: 'Vereinsanfängerin' },
  { name: 'Paul', ladder: true, emoji: '🦉', elo: 1200, depth: 3, noise: 55, blunder: 0.02, desc: 'Solider Hobbyspieler' },
  { name: 'Sofia', ladder: true, emoji: '🐺', elo: 1400, depth: 3, noise: 25, blunder: 0, desc: 'Kennt die Taktiken' },
  { name: 'Viktor', ladder: true, emoji: '🦁', elo: 1600, depth: 4, noise: 12, blunder: 0, desc: 'Starker Vereinsspieler' },
  { name: 'Greta', ladder: true, emoji: '🐉', elo: 1800, time: 400, desc: 'Experte' },
  { name: 'Kaspar', ladder: true, emoji: '🤖', elo: 2000, time: 1200, desc: 'Meisteranwärter' },
  { name: 'Titan', ladder: true, emoji: '👑', elo: 2300, time: 3000, desc: 'Volle Engine-Stärke' },
  { name: 'Freund', emoji: '👥', elo: 0, human: true, desc: 'Zwei Spieler an einem Gerät' },
  // Persönlichkeiten: eigener Spielstil + Lieblingseröffnungen
  { name: 'Attila', emoji: '🗡️', elo: 1300, depth: 3, noise: 25, blunder: 0.01, persona: true, style: 'attack', book: { w: ['italienisch'], b: ['sizilianisch'] }, desc: 'Greift immer an: Schach, Opfer, Königsangriff. Spielt Italienisch und Sizilianisch.' },
  { name: 'Dagmar', emoji: '♛', elo: 1400, depth: 3, noise: 20, persona: true, style: 'solid', book: { w: ['damengambit'], b: ['slawisch', 'carokann'] }, desc: 'Spielt immer Damengambit – als Schwarz Slawisch oder Caro-Kann. Solide und positionell.' },
  { name: 'Erik', emoji: '🧮', elo: 1500, depth: 3, noise: 15, persona: true, style: 'trade', book: { w: ['spanisch'], b: ['e5schwarz', 'franzoesisch'] }, desc: 'Tauscht so oft wie möglich ab und will ins Endspiel.' },
  { name: 'Fritz', emoji: '🛡️', elo: 1150, depth: 3, noise: 30, blunder: 0.02, persona: true, style: 'defend', book: { w: ['london'], b: ['carokann', 'franzoesisch'] }, desc: 'Mauert, rochiert früh und wartet auf deine Fehler. Spielt das London-System.' },
  { name: 'Gina', emoji: '🎲', elo: 900, depth: 2, noise: 60, blunder: 0.05, persona: true, style: 'attack', book: { w: ['italienisch', 'e5schwarz'], b: ['skandinavisch'] }, desc: 'Wild und riskant – liebt Fallen und schnelle Angriffe.' }
];
const LADDER = BOTS.map((b, i) => b.ladder ? i : -1).filter(i => i >= 0);

// Eröffnungsbuch eines Bots: nächster Zug aus seinen Lieblingslinien, solange die Partie dazu passt
function bookMove(bot, game, side) {
  if (!bot.book || game.startFen !== C.START_FEN) return null;
  // eigene Farbe zuerst, dann die Linien der anderen Farbe (gleiche Hauptzüge)
  const ids = [...(bot.book[side === 0 ? 'w' : 'b'] || []), ...(bot.book[side === 0 ? 'b' : 'w'] || [])];
  const hist = game.uci(), cands = [];
  for (const id of ids) {
    const o = OPENINGS.find(x => x.id === id);
    if (!o) continue;
    for (const l of o.lines) {
      const mv = Openings.prepLine(l).map(x => x.uci);
      if (mv.length > hist.length && hist.every((u, i) => mv[i] === u)) cands.push(mv[hist.length]);
    }
  }
  return cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
}

// ---------- Bedenkzeit ----------
const TIME_CONTROLS = [
  { id: 'none', name: 'Ohne Uhr' }, { id: '1+0', name: 'Bullet 1+0', base: 60, inc: 0 }, { id: '3+2', name: 'Blitz 3+2', base: 180, inc: 2 },
  { id: '5+0', name: 'Blitz 5+0', base: 300, inc: 0 }, { id: '10+0', name: 'Rapid 10+0', base: 600, inc: 0 }, { id: '15+10', name: 'Rapid 15+10', base: 900, inc: 10 }
];
const fmtClock = ms => {
  ms = Math.max(0, ms);
  if (ms < 10000) return (ms / 1000).toFixed(1);
  const t = Math.ceil(ms / 1000);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};

// ---------- Modus: Spielen ----------
const Play = {
  game: null, botIdx: store.get('botIdx', 3), tc: store.get('timeControl', 'none'), clock: null, colorChoice: store.get('colorChoice', 'w'), userColor: 0,
  thinking: false, over: null, token: 0, viewPly: null, showEval: store.get('showEval', false), hint: null, saved: false,
  botDelay: store.get('botDelay', 1300), showLive: store.get('liveCls', true), live: { evals: [], best: [], cls: [] }, liveToken: 0, liveLoop: null,

  init() {
    const cur = store.get('current', null);
    if (cur && cur.moves) {
      this.botIdx = cur.botIdx; this.userColor = cur.userColor; this.placement = cur.placement || null; this.clock = cur.clock || null;
      if (this.clock) this.clock.last = Date.now();
      this.game = Game.fromUci(cur.startFen, cur.moves);
    }
  },
  get bot() {
    if (!this.placement) return BOTS[this.botIdx];
    // Adaptiver Bot: übernimmt die Einstellungen des Bots, dessen Elo der aktuellen Schätzung am nächsten liegt
    const elo = this.placement.est;
    let near = BOTS[0];
    for (const b of BOTS) if (b.ladder && Math.abs(b.elo - elo) < Math.abs(near.elo - elo)) near = b;
    return Object.assign({}, near, { name: 'Adaptiver Bot', emoji: '🎯', elo: Math.round(elo / 10) * 10, desc: 'Passt sich deiner Stärke an' });
  },

  // ----- Einstufungspartie -----
  // Partie ab einer beliebigen Stellung (aus Analyse, Analysebrett oder Editor)
  startFrom(fen, userColor) {
    this.placement = null;
    this.setup = false;
    switchTab('play');
    this.start(fen, userColor);
  },

  // ----- Schachuhr -----
  clockTick() {
    const k = this.clock;
    if (!k || !k.started || this.over || !this.game || mode !== 'play' || document.hidden) { if (k) k.last = Date.now(); return; }
    const now = Date.now(), side = this.game.pos.side;
    k.t[side] -= now - (k.last || now);
    k.last = now;
    if (k.t[side] <= 0) {
      k.t[side] = 0;
      // Zeit abgelaufen: Gewinn für den Gegner – außer er hat nur noch den König
      let mat = false;
      for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = this.game.pos.board[sq]; if (p && (p >> 3) === (side ^ 1) && (p & 7) !== 6) mat = true; }
      if (mat) this.finish('timeout', side ^ 1); else this.finish('insufficient');
      return;
    }
    this.renderClocks();
  },
  clockMoved(rec) {
    const k = this.clock;
    if (!k) return;
    if (k.started) k.t[rec.side] += k.inc;
    if (this.game.moves.length >= 2) k.started = true;
    k.last = Date.now();
  },
  renderClocks() {
    if (!this.clock) return;
    document.querySelectorAll('.clock[data-color]').forEach(el => {
      const c = +el.dataset.color, ms = this.clock.t[c];
      el.textContent = fmtClock(ms);
      el.classList.toggle('run', this.clock.started && !this.over && this.game.pos.side === c);
      el.classList.toggle('low', ms < 20000);
    });
  },
  botThinkMs() {
    const k = this.clock;
    if (!k) return null;
    const left = k.t[this.userColor ^ 1];
    return Math.max(80, Math.min(3000, left / 35 + k.inc * 0.7));
  },

  startPlacement() {
    this.placement = { est: 1000, cpl: {}, count: 0 };
    const prev = this.colorChoice;
    this.colorChoice = 'w';
    this.setup = false;
    this.start();
    this.colorChoice = prev;
  },
  renderPlacementBox() {
    const box = $('placeBox'), P = this.placement;
    if (!box || !P) return;
    const n = P.count || 0;
    let pieces = 0;
    for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } const t = this.game.pos.board[sq] & 7; if (t > 1 && t < 6) pieces++; }
    const phase = this.game.moves.length < 20 ? 'Eröffnung' : pieces <= 6 ? 'Endspiel' : 'Mittelspiel';
    box.innerHTML = `<div class="row"><b>🎯 Einstufungspartie</b><span class="muted small">${n} ${n === 1 ? 'Zug' : 'Züge'} bewertet · ${phase}</span></div>
      <div class="place-est"><div><span class="muted small">Deine Stärke (Schätzung)</span><b>~${Math.round(P.est / 10) * 10}</b></div>
      <div><span class="muted small">Bot spielt auf</span><b>~${this.bot.elo}</b></div></div>
      <div class="muted small">Spiel die Partie bis zum Ende – jeder Zug zählt, auch im Endspiel. Der Bot passt sich nach jedem Zug an. Tipps und Zurücknehmen sind während der Einstufung aus.</div>`;
  },

  // Einstufung über den durchschnittlichen Centipawn-Verlust (ACPL) – Züge in entschiedenen Stellungen zählen nicht
  placementUpdate(ply, res, evB, evA) {
    const P = this.placement;
    if (!P || this.game.moves[ply].side !== this.userColor || res.cls === 'forced') return;
    const cap = v => Math.max(-1000, Math.min(1000, v));
    const sgn = this.userColor === 0 ? 1 : -1;
    const before = sgn * cap(evB), after = sgn * cap(evA);
    if (Math.abs(before) > 600) return;
    P.cpl = P.cpl || {};
    P.cpl[ply] = Math.min(400, Math.max(0, before - after));
    const vals = Object.values(P.cpl), n = vals.length;
    const acpl = vals.reduce((a, b) => a + b, 0) / n;
    // Startannahme 900 Elo, mit jedem gezählten Zug zählt die echte Zugqualität mehr
    const w0 = 4;
    P.est = Math.max(200, Math.min(2500, (900 * w0 + eloFromAcpl(acpl) * n) / (w0 + n)));
    P.acpl = acpl;
    P.count = n;
  },

  async showPlacementResult(midgame) {
    const P = this.placement;
    if (!P || P.finishing) return;
    P.finishing = true;
    // auf die Bewertung der letzten Züge warten
    for (let i = 0; i < 40 && this.live.cls.length < this.game.moves.length; i++) await sleep(150);
    let elo = P.est;
    if (midgame) {
      // Partie läuft noch: klarer Vorteil oder Nachteil zählt etwas mit
      const ev = this.live.evals[this.live.evals.length - 1] || 0;
      const mine = this.userColor === 0 ? ev : -ev;
      if (mine > 300) elo += 100; else if (mine < -300) elo -= 100;
    } else {
      const r = this.over.result;
      const won = (r === '1-0' && this.userColor === 0) || (r === '0-1' && this.userColor === 1);
      const myMoves = this.game.moves.filter(m => m.side === this.userColor).length;
      if (r !== '*' && r !== '1/2-1/2') elo += won ? 150 : (myMoves < 20 ? -250 : -150);
    }
    // Sehr kurze Partie: wenig Aussagekraft – bei schneller Niederlage eher vorsichtig einstufen
    if ((P.count || 0) < 5) {
      const r = this.over && this.over.result;
      const lost = r && r !== '1/2-1/2' && r !== '*' && !((r === '1-0') === (this.userColor === 0));
      elo = Math.min(elo, lost ? 400 : 600);
    }
    elo = Math.round(Math.max(200, Math.min(2500, elo)) / 50) * 50;
    // Lernpfad: Kapitel bis zum Niveau freischalten
    const units = elo < 500 ? 0 : elo < 700 ? 2 : elo < 900 ? 3 : elo < 1100 ? 4 : elo < 1300 ? 6 : elo < 1500 ? 8 : elo < 1700 ? 9 : elo < 1900 ? 10 : elo < 2100 ? 11 : LESSONS.length;
    Learn.st.start = 'placed';
    Learn.st.placementElo = elo;
    Learn.markUnitsDone(units);
    if (!Puzzles.st.tries) { Puzzles.st.rating = elo; Puzzles.st.peak = elo; Puzzles.st.hist = [elo]; Puzzles.save(); }
    let bi = 0;
    BOTS.forEach((b, i) => { if (b.ladder && b.elo <= elo) bi = i; });
    this.placement = null;
    this.botIdx = bi; store.set('botIdx', bi);
    this.persist();
    this.renderPanel();
    markActivity();
    const g = OPENING_GROUPS.find(x => elo >= x.min && elo < x.max) || OPENING_GROUPS[0];
    const nextU = LESSONS[Math.min(units, LESSONS.length - 1)];
    Sound.play('end');
    showModal(`<div style="font-size:54px">🎯</div><h2>Deine Einstufung</h2>
      <div class="xp-gain" style="font-size:40px">~${elo} Elo</div>
      <div class="place-list">
        <div>🎓 <b>Lernpfad:</b> ${units === 0 ? 'Start ganz am Anfang' : units >= LESSONS.length ? 'alle Kapitel freigeschaltet' : `Einstieg bei Kapitel ${units + 1} „${nextU.title}“`}</div>
        <div>♟ <b>Passender Gegner:</b> ${BOTS[bi].emoji} ${BOTS[bi].name} (ca. ${BOTS[bi].elo})</div>
        <div>📖 <b>Eröffnungen:</b> ${g.icon} ${g.name} (${g.range})</div>
        ${Puzzles.st.tries ? '' : `<div>🧩 <b>Rätsel-Wertung:</b> startet bei ${elo}</div>`}
      </div>
      <p class="muted small">Die Schätzung beruht auf der Qualität deiner Züge (von der Engine bewertet) und dem Ergebnis. Mit jeder weiteren Partie wird dein Bild genauer.</p>
      ${midgame ? `<p class="small">Die Partie ist noch nicht vorbei – du spielst sie jetzt gegen ${BOTS[bi].emoji} <b>${BOTS[bi].name}</b> zu Ende.</p>
      <button class="btn primary full" data-act="cont">♟ Partie zu Ende spielen</button>
      <button class="btn full" data-act="learn">🎓 Zum Lernpfad (Partie bleibt gespeichert)</button>`
      : `<button class="btn primary full" data-act="learn">🎓 Zum Lernpfad</button>
      <button class="btn full" data-act="analyse">📈 Partie analysieren</button>
      <button class="btn full" data-act="play">♟ Gegen ${BOTS[bi].name} spielen</button>`}`, {
      cont: () => { hideModal(); this.refresh(); this.renderPanel(); this.maybeBot(); },
      learn: () => { hideModal(); switchTab('learn'); },
      analyse: () => { hideModal(); Analysis.loadRecord(this.lastRecord); switchTab('analysis'); },
      play: () => { hideModal(); this.start(); }
    });
  },

  activate() {
    board.setFlipped(this.bot.human ? board.flipped : this.userColor === 1);
    this.refresh(); this.renderPanel();
    if (this.game && !this.over) { this.maybeBot(); this.liveAnalyse(); }
  },

  start(fen, forcedColor) {
    engine.cancel();
    this.token++;
    this.game = new Game(fen || C.START_FEN);
    this.over = null; this.viewPly = null; this.hint = null; this.thinking = false; this.saved = false;
    this.resetLive();
    const c = this.colorChoice === 'r' ? (Math.random() < .5 ? 'w' : 'b') : this.colorChoice;
    this.userColor = forcedColor != null ? forcedColor : c === 'w' ? 0 : 1;
    const tc = TIME_CONTROLS.find(t => t.id === this.tc);
    this.clock = !this.placement && tc && tc.base ? { t: [tc.base * 1000, tc.base * 1000], inc: tc.inc * 1000, started: false, last: 0, name: tc.name } : null;
    board.setFlipped(this.userColor === 1 && !this.bot.human);
    this.persist();
    this.refresh(); this.renderPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.maybeBot();
  },

  persist() {
    if (!this.game || this.over) { store.set('current', null); return; }
    store.set('current', { botIdx: this.botIdx, userColor: this.userColor, startFen: this.game.startFen, moves: this.game.uci(), placement: this.placement, clock: this.clock });
  },

  isUserTurn() { return this.game && !this.over && (this.bot.human || this.game.pos.side === this.userColor); },

  // ----- Live-Zugbewertung (läuft parallel zum Bot im Analyse-Worker) -----
  resetLive() { this.liveToken++; this.live = { evals: [], best: [], cls: [] }; },
  liveAnalyse() {
    if ((!this.showLive && !this.placement) || !this.game || this.liveLoop === this.liveToken) return;
    this.liveLoop = this.liveToken;
    this.liveRun(this.liveToken);
  },
  async liveRun(tok) {
    try {
      for (;;) {
        const g = this.game, L = this.live;
        if (!g || tok !== this.liveToken || (!this.showLive && !this.placement)) return;
        const i = L.evals.length;
        if (i > g.moves.length) return;
        const pos = g.positionAt(i), st = pos.status();
        if (st) { L.evals[i] = st === 'checkmate' ? (pos.side === 0 ? -C.MATE : C.MATE) : 0; L.best[i] = null; }
        else {
          const r = await analysisEngine.request({ cmd: 'search', fen: g.startFen, moves: g.uci().slice(0, i), timeMs: 400 });
          if (!r || tok !== this.liveToken) return;
          L.evals[i] = pos.side === 0 ? r.score : -r.score; L.best[i] = r.move;
        }
        if (i > 0) {
          const res = classifyMove(g.positionAt(i - 1), g.moves[i - 1].uci, L.evals[i - 1], L.evals[i], L.best[i - 1], L.cls[i - 2]);
          L.cls[i - 1] = res.cls;
          if (this.placement) { this.placementUpdate(i - 1, res, L.evals[i - 1], L.evals[i]); if (mode === 'play') this.renderPlacementBox(); }
          const mine = this.bot.human || g.moves[i - 1].side === this.userColor;
          if (mine && i === g.moves.length && mode === 'play') {
            if (res.cls === 'brilliant') Sound.play('brilliant');
            else if (res.cls === 'blunder') Sound.play('bad');
          }
          if (mode === 'play') { this.refreshBadge(); this.renderMoves(); this.renderLiveBox(); }
        }
        if (this.showEval && mode === 'play' && this.viewPly == null && i === g.moves.length) EvalBar.set(L.evals[i]);
      }
    } finally { if (this.liveLoop === tok) this.liveLoop = null; }
  },
  refreshBadge() {
    const ply = this.viewPly == null ? this.game.moves.length : this.viewPly;
    const c = this.showLive && this.live.cls[ply - 1];
    const lm = this.game.moves[ply - 1];
    board.setOpts({ badge: c && lm ? { sq: lm.to, sym: CLS[c].sym, color: CLS[c].color } : null });
  },
  renderLiveBox() {
    const box = $('liveBox');
    if (!box) return;
    if (!this.showLive) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const g = this.game;
    let k = -1;
    for (let i = this.live.cls.length - 1; i >= 0; i--) {
      if (this.live.cls[i] && (this.bot.human || g.moves[i].side === this.userColor)) { k = i; break; }
    }
    if (k < 0) { box.innerHTML = '<span class="muted small">Nach deinem Zug siehst du hier, wie gut er war.</span>'; return; }
    const c = CLS[this.live.cls[k]], m = g.moves[k];
    const better = !['best', 'brilliant', 'great', 'forced', 'excellent'].includes(this.live.cls[k]) && this.live.best[k];
    let alt = '';
    if (better) { const p = g.positionAt(k); alt = `<div class="small muted">Besser: <b>${de(p.toSan(p.fromUci(this.live.best[k])))}</b></div>`; }
    box.innerHTML = `<span class="cls-dot" style="background:${c.color}">${c.sym}</span>
      <div><div class="t">${de(m.san)} ist ${c.phrase}</div>${alt || `<div class="small muted">${c.info}</div>`}</div>`;
  },

  refresh(animate) {
    if (mode !== 'play') return;
    if (!this.game) {
      board.movable = -1;
      board.set(new C.Position(), {});
      EvalBar.show(false);
      setStrip('top', { avatar: this.bot.emoji, name: this.bot.name, sub: this.bot.human ? '' : `(${this.bot.elo})` });
      setStrip('bottom', { avatar: '🙂', name: 'Du' });
      return;
    }
    const ply = this.viewPly == null ? this.game.moves.length : this.viewPly;
    const pos = this.viewPly == null ? this.game.pos : this.game.positionAt(ply);
    const lm = this.game.moves[ply - 1];
    board.movable = this.viewPly == null && this.isUserTurn() && !this.thinking ? this.game.pos.side : -1;
    const arrows = this.hint && this.viewPly == null ? [{ from: C.parseSq(this.hint.slice(0, 2)), to: C.parseSq(this.hint.slice(2, 4)), color: 'rgba(80,160,255,.85)' }] : [];
    const c = this.showLive && this.live.cls[ply - 1];
    board.set(pos, {
      last: lm ? [lm.from, lm.to] : null, arrows, animate: animate && lm ? [lm.from, lm.to] : null,
      badge: c && lm ? { sq: lm.to, sym: CLS[c].sym, color: CLS[c].color } : null
    });
    const me = this.bot.human ? 0 : this.userColor;
    if (this.bot.human) {
      setStrip(board.flipped ? 'bottom' : 'top', { avatar: '♚', name: 'Schwarz', pos, color: 1, clock: !!this.clock });
      setStrip(board.flipped ? 'top' : 'bottom', { avatar: '♔', name: 'Weiß', pos, color: 0, clock: !!this.clock });
    } else {
      setStrip('top', { avatar: this.bot.emoji, name: this.bot.name, sub: `(${this.bot.elo})`, pos, color: me ^ 1, thinking: this.thinking, clock: !!this.clock });
      setStrip('bottom', { avatar: '🙂', name: 'Du', pos, color: me, clock: !!this.clock });
    }
    this.renderClocks();
    renderBoardNav();
    EvalBar.show(this.showEval);
    if (this.showEval) {
      if (this.live.evals[ply] != null) EvalBar.set(this.live.evals[ply]);
      else if (!this.showLive || this.viewPly != null) this.updateEval(pos, ply);
    }
  },

  async updateEval(pos, ply) {
    const tok = this.token, key = this.game.uci().slice(0, ply).join(' ');
    this.evalKey = key;
    const st = pos.status();
    if (st) { EvalBar.set(st === 'checkmate' ? (pos.side ? C.MATE : -C.MATE) : 0); return; }
    const r = await analysisEngine.request({ cmd: 'search', fen: this.game.startFen, moves: this.game.uci().slice(0, ply), timeMs: 400 });
    if (!r || tok !== this.token || this.evalKey !== key) return;
    EvalBar.set(pos.side === 0 ? r.score : -r.score);
  },

  onUserMove(uci) {
    if (!this.isUserTurn() || this.viewPly != null) return;
    const rec = this.game.play(uci);
    if (!rec) return;
    this.hint = null;
    Sound.forMove(rec, this.game.pos);
    this.afterMove();
  },

  afterMove() {
    const lastRec = this.game.moves[this.game.moves.length - 1];
    if (lastRec) this.clockMoved(lastRec);
    this.persist();
    this.liveAnalyse();
    const st = this.game.pos.status();
    if (st) { this.finish(st); return; }
    this.refresh(true);
    this.renderPanel();
    this.maybeBot();
  },

  async maybeBot() {
    if (!this.game || this.over || this.bot.human || this.thinking || this.game.pos.side === this.userColor) return;
    this.thinking = true;
    const tok = ++this.token;
    this.refresh();
    const t0 = Date.now();
    const b = this.bot;
    const think = this.botThinkMs();
    const book = bookMove(b, this.game, this.game.pos.side);
    const r = book ? { move: book } : await engine.request({ cmd: 'bot', fen: this.game.startFen, moves: this.game.uci(),
      level: { depth: b.depth, noise: b.noise, blunder: b.blunder, time: b.time && think ? Math.min(b.time, think) : b.time, style: b.style, maxMs: think || 2500 } });
    // Bedenkzeit des Bots: mindestens die eingestellte Pause, leicht zufällig (mit Uhr kürzer)
    const delay = think ? Math.min(this.botDelay, think) : this.botDelay;
    const wait = delay * (0.8 + Math.random() * 0.4) - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (tok !== this.token) return;
    this.thinking = false;
    if (!r || !r.move) { this.refresh(); return; }
    const rec = this.game.play(r.move);
    if (rec) Sound.forMove(rec, this.game.pos);
    this.viewPly = null;
    this.afterMove();
  },

  finish(reason, winner) {
    let result;
    if (reason === 'checkmate') result = this.game.pos.side === 0 ? '0-1' : '1-0';
    else if (reason === 'resign' || reason === 'timeout') result = winner === 0 ? '1-0' : '0-1';
    else result = '1/2-1/2';
    this.over = { result, reason };
    this.thinking = false;
    this.token++;
    engine.cancel();
    store.set('current', null);
    this.saveGame();
    this.refresh(true);
    this.renderPanel();
    Sound.play('end');
    const added = this.bot.human ? 0 : MyPuzzles.addFromGame({ startFen: this.game.startFen, moves: this.game.uci(), evals: this.live.evals, best: this.live.best, cls: this.live.cls, userColor: this.userColor, date: Date.now() });
    if (this.placement) { this.showPlacementResult(); return; }
    const userWon = !this.bot.human && ((result === '1-0' && this.userColor === 0) || (result === '0-1' && this.userColor === 1));
    const userLost = !this.bot.human && result !== '1/2-1/2' && !userWon;
    const title = this.bot.human ? (result === '1-0' ? 'Weiß gewinnt' : result === '0-1' ? 'Schwarz gewinnt' : 'Remis') :
      userWon ? '🏆 Gewonnen!' : userLost ? 'Verloren' : '🤝 Remis';
    const sub = userWon ? `Du hast ${this.bot.name} besiegt! ${this.bot.ladder && this.botIdx < 9 ? `Als Nächstes: ${BOTS[this.botIdx + 1].name} ${BOTS[this.botIdx + 1].emoji}` : ''}` : '';
    showModal(`<div style="font-size:54px">${this.bot.emoji}</div><h2>${title}</h2><p class="muted">${STATUS_TEXT[reason]} · ${result}</p>
      ${sub ? `<p>${sub}</p>` : ''}
      ${added ? `<p class="small">⭐ ${added} ${added === 1 ? 'Fehler wurde' : 'Fehler wurden'} ins Fehler-Training übernommen.</p>` : ''}
      <button class="btn primary full" data-act="analyse">📈 Partie analysieren</button>
      ${userWon && this.bot.ladder && this.botIdx < 9 ? '<button class="btn full" data-act="nextBot">Nächsten Bot herausfordern</button>' : ''}
      <button class="btn full" data-act="again">Revanche</button>
      <button class="btn full" data-act="close">Schließen</button>`, {
      analyse: () => { hideModal(); Analysis.loadRecord(this.lastRecord); switchTab('analysis'); },
      nextBot: () => { hideModal(); this.botIdx++; store.set('botIdx', this.botIdx); this.start(); },
      again: () => { hideModal(); this.start(); },
      close: hideModal
    });
  },

  saveGame() {
    if (this.saved || !this.game.moves.length) return;
    this.saved = true;
    const b = this.bot;
    const rec = {
      id: Date.now(), date: Date.now(), bot: this.placement ? null : this.botIdx,
      white: b.human ? 'Weiß' : this.userColor === 0 ? 'Du' : `${b.name} (${b.elo})`,
      black: b.human ? 'Schwarz' : this.userColor === 1 ? 'Du' : `${b.name} (${b.elo})`,
      result: this.over.result, reason: this.over.reason, userColor: b.human ? null : this.userColor,
      startFen: this.game.startFen, moves: this.game.uci()
    };
    this.lastRecord = rec;
    const list = store.get('games', []);
    list.unshift(rec);
    store.set('games', list.slice(0, 60));
  },

  async getHint() {
    if (!this.isUserTurn() || this.thinking) return;
    const tok = this.token;
    $('playStatus').innerHTML = 'Suche den besten Zug …';
    const r = await engine.request({ cmd: 'search', fen: this.game.startFen, moves: this.game.uci(), timeMs: 1500 });
    if (!r || tok !== this.token || !r.move) return;
    this.hint = r.move;
    const san = de(this.game.pos.toSan(this.game.pos.fromUci(r.move)));
    $('playStatus').innerHTML = `💡 Tipp: <b>${san}</b> <span class="muted">(${fmtEval(this.game.pos.side === 0 ? r.score : -r.score)})</span>`;
    this.refresh();
  },

  takeback() {
    if (!this.game || !this.game.moves.length) return;
    if (this.thinking) { engine.cancel(); this.thinking = false; this.token++; }
    if (this.over) { this.over = null; this.saved = false; }
    this.viewPly = null; this.hint = null;
    this.game.undo();
    if (!this.bot.human && this.game.pos.side !== this.userColor && this.game.moves.length) this.game.undo();
    // Live-Bewertung auf den neuen Stand kürzen
    const n = this.game.moves.length, L = this.live;
    this.liveToken++;
    L.evals.length = Math.min(L.evals.length, n + 1); L.best.length = Math.min(L.best.length, n + 1); L.cls.length = Math.min(L.cls.length, n);
    this.persist();
    this.refresh(); this.renderPanel();
    this.maybeBot();
    this.liveAnalyse();
  },

  resign() {
    if (!this.game || this.over) return;
    if (!confirm('Wirklich aufgeben?')) return;
    const loser = this.bot.human ? this.game.pos.side : this.userColor;
    this.finish('resign', loser ^ 1);
  },

  view(ply) {
    if (!this.game) return;
    ply = Math.max(0, Math.min(this.game.moves.length, ply));
    this.viewPly = ply === this.game.moves.length ? null : ply;
    this.refresh(); this.renderMoves();
  },
  nav(d) { if (this.game) this.view((this.viewPly == null ? this.game.moves.length : this.viewPly) + d); },

  renderMoves() {
    const box = $('playMoves');
    if (!box || !this.game) return;
    const cur = this.viewPly == null ? this.game.moves.length : this.viewPly;
    box.innerHTML = moveListHtml(this.game, cur, this.showLive ? this.live.cls : null);
    box.querySelectorAll('[data-ply]').forEach(e => e.onclick = () => this.view(+e.dataset.ply));
    scrollListTo(box, box.querySelector('.cur'));
  },

  renderPanel() {
    const p = $('panel-play');
    if (mode === 'play') renderBoardNav();
    if (!this.game || this.setup) {
      const beaten = beatenBots();
      p.innerHTML = `<div class="panel-head"><div class="big-ic">${this.bot.emoji}</div><div><h2>Neue Partie</h2><div class="muted">Wähle deinen Gegner</div></div></div>
        ${(() => { const card = (b, i) => `<button class="bot-card ${i === this.botIdx ? 'active' : ''} ${beaten.has(i) ? 'has-beaten' : ''}" data-act="bot" data-arg="${i}">
          <span class="em">${b.emoji}</span><span class="nm">${b.name}</span><span class="el">${b.human ? '2 Spieler' : 'ca. ' + b.elo}</span>${beaten.has(i) ? '<span class="beaten">✔</span>' : ''}</button>`;
          return `<div class="bot-grid">${BOTS.map((b, i) => !b.persona ? card(b, i) : '').join('')}</div>
            <h3>🎭 Persönlichkeiten</h3><div class="bot-grid">${BOTS.map((b, i) => b.persona ? card(b, i) : '').join('')}</div>`; })()}
        <p class="muted small">${esc(this.bot.desc)}</p>
        <h3>Deine Farbe</h3>
        <div class="seg">${[['w', '♔ Weiß'], ['r', '🎲 Zufall'], ['b', '♚ Schwarz']].map(([k, l]) => `<button class="${this.colorChoice === k ? 'active' : ''}" data-act="color" data-arg="${k}">${l}</button>`).join('')}</div>
        <h3>⏱️ Bedenkzeit</h3>
        <div class="seg tc-seg">${TIME_CONTROLS.map(t => `<button class="${this.tc === t.id ? 'active' : ''}" data-act="tc" data-arg="${t.id}">${t.name}</button>`).join('')}</div>
        <div style="height:16px"></div>
        <button class="btn primary full" data-act="start">▶ Spielen gegen ${this.bot.name}</button>
        <div class="btn-row"><button class="btn small" data-act="place">🎯 Einstufungspartie</button><button class="btn small" data-act="pieces">🎨 Figuren ändern</button></div>
        ${this.game && this.setup ? '<button class="btn full" style="margin-top:8px" data-act="back">Zurück zur laufenden Partie</button>' : ''}`;
      bind(p, {
        bot: i => { this.botIdx = +i; store.set('botIdx', this.botIdx); this.renderPanel(); if (!this.game) this.refresh(); },
        color: c => { this.colorChoice = c; store.set('colorChoice', c); this.renderPanel(); },
        tc: v => { this.tc = v; store.set('timeControl', v); this.renderPanel(); },
        start: () => { this.setup = false; this.placement = null; this.start(); },
        place: () => this.startPlacement(),
        pieces: () => openPieceChooser(),
        back: () => { this.setup = false; this.renderPanel(); }
      });
      return;
    }
    const b = this.bot;
    const turn = this.game.pos.side === 0 ? 'Weiß' : 'Schwarz';
    const status = this.over ? `<b>${STATUS_TEXT[this.over.reason]}</b> · ${this.over.result}` :
      this.thinking ? `${b.emoji} ${b.name} denkt nach …` : this.isUserTurn() ? `<b>${turn}</b> ist am Zug${this.game.pos.inCheck() ? ' – <b style="color:var(--accent2)">Schach!</b>' : ''}` : '';
    p.innerHTML = `<div class="panel-head"><div class="big-ic">${b.emoji}</div><div><h2>${b.human ? 'Partie zu zweit' : 'gegen ' + b.name}</h2><div class="muted">${b.human ? 'Ein Gerät, zwei Spieler' : 'ca. ' + b.elo + ' Elo · ' + esc(b.desc)}</div></div></div>
      ${this.placement ? '<div class="place-box" id="placeBox"></div>' : ''}
      <div class="status-box" id="playStatus">${status}</div>
      <div class="live-box" id="liveBox"></div>
      <div class="movelist" id="playMoves"></div>
      <div class="btn-row">
        <button class="btn" data-act="hint" ${this.over || this.placement ? 'disabled' : ''}>💡 Tipp</button>
        <button class="btn" data-act="undo" ${this.placement ? 'disabled' : ''}>↶ Zurück</button>
        <button class="btn" data-act="flip">⇅ Drehen</button>
        <button class="btn danger" data-act="resign" ${this.over ? 'disabled' : ''}>🏳 Aufgeben</button>
      </div>
      <label class="chk"><input type="checkbox" id="liveChk" ${this.showLive ? 'checked' : ''}> Züge live bewerten (Brillant, Patzer …)</label>
      <label class="chk"><input type="checkbox" id="evalChk" ${this.showEval ? 'checked' : ''}> Bewertungsbalken anzeigen</label>
      ${b.human ? '' : `<div class="row" style="margin-top:6px"><span class="muted small">Bot-Tempo</span>
        <div class="seg" style="flex:0 0 230px">${[[400, 'Schnell'], [1300, 'Normal'], [2600, 'Langsam']].map(([v, l]) => `<button class="${this.botDelay === v ? 'active' : ''}" data-act="delay" data-arg="${v}">${l}</button>`).join('')}</div></div>`}
      <div style="height:10px"></div>
      ${this.over ? '<button class="btn primary full" data-act="analyse">📈 Partie analysieren</button><div style="height:6px"></div>' : ''}
      <div class="btn-row"><button class="btn" data-act="new">＋ Neues Spiel</button><button class="btn" data-act="pgn">📋 PGN</button></div>`;
    bind(p, {
      first: () => this.view(0), prev: () => this.nav(-1), next: () => this.nav(1), last: () => this.view(1e9),
      hint: () => this.getHint(), undo: () => this.takeback(), resign: () => this.resign(),
      delay: v => { this.botDelay = +v; store.set('botDelay', this.botDelay); this.renderPanel(); },
      flip: () => { board.setFlipped(!board.flipped); this.refresh(); },
      new: () => { this.setup = true; this.renderPanel(); },
      analyse: () => { Analysis.loadRecord(this.lastRecord); switchTab('analysis'); },
      pgn: () => copyText(this.game.pgn({ white: this.userColor === 0 ? 'Du' : b.name, black: this.userColor === 1 ? 'Du' : b.name, result: this.over ? this.over.result : '*' }))
    });
    $('evalChk').onchange = e => { this.showEval = e.target.checked; store.set('showEval', this.showEval); this.refresh(); };
    $('liveChk').onchange = e => {
      this.showLive = e.target.checked; store.set('liveCls', this.showLive);
      if (this.showLive) this.liveAnalyse();
      this.refresh(); this.renderMoves(); this.renderLiveBox();
    };
    this.renderMoves();
    this.renderLiveBox();
    this.renderPlacementBox();
  }
};

// Bots, die der Spieler schon besiegt hat (Index in BOTS)
function beatenBots() {
  const set = new Set();
  for (const g of store.get('games', [])) {
    if (g.userColor == null) continue;
    const won = (g.result === '1-0' && g.userColor === 0) || (g.result === '0-1' && g.userColor === 1);
    if (!won) continue;
    let idx = g.bot;
    if (idx == null) { const nm = (g.userColor === 0 ? g.black : g.white).split(' (')[0]; idx = BOTS.findIndex(b => b.name === nm); }
    if (idx >= 0) set.add(idx);
  }
  return set;
}

// Nur die Zugliste scrollen, nicht die ganze Seite
function scrollListTo(box, el) {
  if (!el) return;
  const top = el.offsetTop - box.offsetTop;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight;
}

function moveListHtml(game, curPly, classes) {
  if (!game.moves.length) return '<div class="empty">Noch keine Züge</div>';
  let html = '';
  const startNum = new C.Position(game.startFen).full;
  let num = startNum;
  const cell = (i) => {
    const m = game.moves[i];
    const cl = classes && classes[i] ? CLS[classes[i]] : null;
    const dot = cl && cl.dot ? `<span class="cls-dot" style="background:${cl.color}">${cl.sym}</span>` : '';
    return `<div class="mv ${curPly === i + 1 ? 'cur' : ''}" data-ply="${i + 1}">${dot}${de(m.san)}</div>`;
  };
  let i = 0;
  if (game.moves[0].side === 1) { html += `<div class="no">${num}.</div><div class="mv">…</div>${cell(0)}`; i = 1; num++; }
  for (; i < game.moves.length; i += 2) {
    html += `<div class="no">${num}.</div>${cell(i)}${i + 1 < game.moves.length ? cell(i + 1) : '<div></div>'}`;
    num++;
  }
  return html;
}

// ---------- Modus: Rätsel ----------
const PUZZLES = (window.PUZZLES || []).slice().sort((a, b) => a.rating - b.rating);
const PUZZLE_THEMES = [
  ['all', 'Alle', () => true], ['mine', '⭐ Meine Fehler', null],
  ['m1', 'Matt in 1', t => t.includes('Matt in 1')], ['m2', 'Matt in 2', t => t.includes('Matt in 2')],
  ['m3', 'Matt in 3+', t => t.some(x => /Matt in [3-9]/.test(x))], ['Gabel', 'Gabel', t => t.includes('Gabel')],
  ['Material gewinnen', 'Material gewinnen', t => t.includes('Material gewinnen')], ['Angriff', 'Angriff', t => t.includes('Angriff')],
  ['Stiller Zug', 'Stiller Zug', t => t.includes('Stiller Zug')], ['Endspiel', 'Endspiel', t => t.includes('Endspiel')]
];
const REVIEW_DAYS = [1, 3, 7, 21];

// Fehler aus eigenen Partien als persönliche Rätsel sammeln (Wiederholung in wachsenden Abständen)
const MyPuzzles = {
  list() { return store.get('myPuzzles', []); },
  save(l) { store.set('myPuzzles', l.slice(-300)); },
  due() { const now = Date.now(); return this.list().filter(p => (p.due || 0) <= now && (p.reps || 0) < REVIEW_DAYS.length); },
  addFromGame(g) {
    if (g.userColor == null || !g.moves || !g.evals) return 0;
    const list = this.list(), ids = new Set(list.map(p => p.id));
    const sgn = g.userColor === 0 ? 1 : -1, cap = v => Math.max(-1500, Math.min(1500, v));
    const pos = new C.Position(g.startFen);
    const fens = [pos.fen()];
    for (const u of g.moves) { const m = pos.fromUci(u); if (!m) break; pos.make(m); fens.push(pos.fen()); }
    let added = 0;
    for (let i = 0; i < g.moves.length; i++) {
      if (!['mistake', 'blunder', 'miss'].includes(g.cls[i]) || !g.best[i] || g.best[i] === g.moves[i]) continue;
      if (g.evals[i] == null || g.evals[i + 1] == null) continue;
      if (new C.Position(fens[i]).side !== g.userColor) continue;
      const before = sgn * cap(g.evals[i]), after = sgn * cap(g.evals[i + 1]);
      if (before - after < 120) continue;
      const id = 'm:' + fens[i].split(' ').slice(0, 2).join(' ') + ':' + g.best[i];
      if (ids.has(id)) continue;
      ids.add(id);
      list.push({
        id, own: true, fen: i > 0 ? fens[i - 1] : fens[i], last: i > 0 ? g.moves[i - 1] : null,
        sol: [g.best[i]], bestScore: before, played: g.moves[i], cls: g.cls[i],
        themes: ['Meine Fehler', CLS[g.cls[i]].name], date: g.date || Date.now(), label: g.label || '', reps: 0, due: 0
      });
      added++;
    }
    if (added) this.save(list);
    return added;
  },
  update(id, ok) {
    const list = this.list(), p = list.find(x => x.id === id);
    if (!p) return;
    if (ok) { p.reps = (p.reps || 0) + 1; p.due = Date.now() + REVIEW_DAYS[Math.min(p.reps - 1, REVIEW_DAYS.length - 1)] * 86400000; }
    else { p.reps = 0; p.due = Date.now() + 43200000; }
    this.save(list);
  }
};
const Puzzles = {
  st: Object.assign({ rating: 800, solved: 0, tries: 0, streak: 0, bestStreak: 0, peak: 800, done: {}, recent: [], diff: 0 }, store.get('puzzle', {})),
  cur: null, game: null, step: 0, failed: false, solved: false, lastDelta: null, msg: '', busy: false, token: 0,
  theme: store.get('puzzleTheme', 'all'), view: 'train', rush: null,

  save() { store.set('puzzle', this.st); },
  activate() {
    EvalBar.show(false);
    if (this.view === 'rush' && !this.rush) { this.renderPanel(); board.movable = -1; if (!this.game) { board.set(new C.Position(), {}); setStrip('top', null); setStrip('bottom', null); } else this.refresh(); return; }
    if (!this.cur) this.next(); else { this.refresh(); this.renderPanel(); }
  },

  pick() {
    if (!PUZZLES.length) return null;
    if (this.rush) {
      const pool = PUZZLES.filter(p => !this.rush.used.has(p.id));
      pool.sort((a, b) => Math.abs(a.rating - this.rush.rating) - Math.abs(b.rating - this.rush.rating));
      const pz = pool[Math.floor(Math.random() * Math.min(4, pool.length))];
      if (pz) this.rush.used.add(pz.id);
      return pz;
    }
    if (this.theme === 'mine') {
      const due = MyPuzzles.due().sort((a, b) => (a.due || 0) - (b.due || 0));
      return due[0] || null;
    }
    const th = PUZZLE_THEMES.find(t => t[0] === this.theme) || PUZZLE_THEMES[0];
    const all = PUZZLES.filter(p => th[2](p.themes));
    let pool = all.filter(p => !this.st.done[p.id]);
    if (!pool.length) { for (const p of all) delete this.st.done[p.id]; pool = all; }
    if (!pool.length) return null;
    const target = this.st.rating + this.st.diff + (Math.random() * 150 - 50);
    pool.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
    return pool[Math.floor(Math.random() * Math.min(3, pool.length))];
  },

  async next() {
    const pz = this.pick();
    this.token++;
    const tok = this.token;
    if (!pz) { this.cur = null; this.game = null; this.renderEmpty(); return; }
    this.cur = pz; this.step = 0; this.failed = false; this.solved = false; this.lastDelta = null; this.hintSq = -1; this.marks = null;
    this.game = new Game(pz.fen);
    this.userColor = pz.last ? this.game.pos.side ^ 1 : this.game.pos.side;
    board.setFlipped(this.userColor === 1);
    this.msg = '';
    this.busy = true;
    this.refresh(); this.renderPanel();
    if (pz.last) {
      await sleep(this.rush ? 300 : 600);
      if (tok !== this.token) return;
      const rec = this.game.play(pz.last);
      Sound.forMove(rec, this.game.pos);
    }
    if (pz.own) {
      const p0 = this.game.pos, pm = p0.fromUci(pz.played);
      this.msg = `Aus deiner Partie vom ${new Date(pz.date).toLocaleDateString('de-DE')}: Hier hast du ${pm ? '<b>' + de(p0.toSan(pm)) + '</b>' : 'einen Zug'} gespielt – ${CLS[pz.cls].phrase}. Finde einen besseren Zug!`;
    }
    this.busy = false;
    this.refresh(true); this.renderPanel();
  },

  refresh(animate) {
    if (mode !== 'puzzle' || !this.game) return;
    const lm = this.game.moves[this.game.moves.length - 1];
    board.movable = !this.busy && !this.solved && !this.showing ? this.userColor : -1;
    const marks = Object.assign({}, this.marks || {});
    if (this.hintSq >= 0) marks[this.hintSq] = 'hint';
    board.set(this.game.pos, { last: lm ? [lm.from, lm.to] : null, marks, animate: animate && lm ? [lm.from, lm.to] : null });
    setStrip('top', { avatar: this.cur.own ? '⭐' : '🧩', name: this.cur.own ? 'Dein Fehler' : 'Rätsel', sub: !this.cur.own && !this.rush && (this.solved || this.failed) ? `Wertung ${this.cur.rating}` : '', pos: this.game.pos, color: this.userColor ^ 1 });
    setStrip('bottom', { avatar: '🙂', name: 'Du', sub: `(${Math.round(this.st.rating)})`, pos: this.game.pos, color: this.userColor });
  },

  rate(win) {
    if (this.rush) return;
    if (this.cur.own) { MyPuzzles.update(this.cur.id, win); this.lastDelta = null; return; }
    const k = this.st.tries < 20 ? 40 : 24;
    const exp = 1 / (1 + Math.pow(10, (this.cur.rating - this.st.rating) / 400));
    const delta = Math.round(k * ((win ? 1 : 0) - exp));
    this.st.rating = Math.max(100, this.st.rating + delta);
    this.st.peak = Math.max(this.st.peak, this.st.rating);
    this.st.tries++;
    this.st.done[this.cur.id] = win ? 1 : 2;
    this.st.recent.unshift({ id: this.cur.id, r: this.cur.rating, ok: win });
    this.st.recent = this.st.recent.slice(0, 20);
    if (win) { this.st.solved++; this.st.streak++; this.st.bestStreak = Math.max(this.st.bestStreak, this.st.streak); }
    else this.st.streak = 0;
    this.lastDelta = delta;
    this.st.hist = (this.st.hist || [800]).concat(Math.round(this.st.rating)).slice(-60);
    this.save();
  },

  async onUserMove(uci) {
    if (this.busy || this.solved) return;
    const expected = this.cur.sol[this.step];
    const rec = this.game.play(uci);
    if (!rec) return;
    this.hintSq = -1;
    const mate = this.game.pos.status() === 'checkmate';
    let alsoGood = false;
    if (this.cur.own && uci !== expected && !mate) {
      // Eigene Fehler: jeder Zug, der fast so gut ist wie der beste, zählt
      this.busy = true; this.msg = 'Prüfe deinen Zug …';
      this.refresh(true); this.renderPanel();
      const tok = this.token;
      const r = await engine.request({ cmd: 'search', fen: this.game.startFen, moves: this.game.uci(), timeMs: 700 });
      if (tok !== this.token) return;
      this.busy = false;
      if (r) {
        const mine = Math.max(-1500, Math.min(1500, -r.score)), best = this.cur.bestScore;
        const wp = v => winPct(v);
        alsoGood = mine >= best - 60 || wp(best) - wp(mine) < 4;
      }
    }
    if (this.rush && !(uci === expected || mate)) { this.rushMiss(rec); return; }
    if (uci === expected || mate || alsoGood) {
      if (alsoGood) { this.step = this.cur.sol.length; this.marks = { [rec.to]: 'ok' }; Sound.forMove(rec, this.game.pos); this.finishSolved('✓ Auch ein starker Zug!'); return; }
      Sound.forMove(rec, this.game.pos);
      this.step++;
      this.marks = { [rec.to]: 'ok' };
      if (this.step >= this.cur.sol.length || mate) { this.finishSolved(); return; }
      this.msg = '✓ Richtig! Weiter so …';
      this.busy = true;
      this.refresh(true); this.renderPanel();
      const tok = this.token;
      await sleep(550);
      if (tok !== this.token) return;
      const r = this.game.play(this.cur.sol[this.step]);
      this.step++;
      Sound.forMove(r, this.game.pos);
      this.marks = null;
      this.busy = false;
      this.msg = 'Und jetzt?';
      this.refresh(true); this.renderPanel();
    } else {
      Sound.play('bad');
      this.marks = { [rec.to]: 'bad' };
      if (!this.failed) { this.failed = true; this.rate(false); }
      this.msg = '✗ Das ist nicht der beste Zug. Versuch es nochmal!';
      this.busy = true;
      this.refresh(true); this.renderPanel();
      const tok = this.token;
      await sleep(900);
      if (tok !== this.token) return;
      this.game.undo();
      this.marks = null;
      this.busy = false;
      this.refresh(); this.renderPanel();
    }
  },

  finishSolved(text) {
    this.solved = true;
    markActivity();
    if (this.rush) { this.rushHit(); return; }
    if (!this.failed) this.rate(true);
    Sound.play('good');
    this.msg = text || (this.failed ? '✓ Gelöst – aber nicht im ersten Versuch.' : '🎉 Perfekt gelöst!');
    if (this.cur.own && !this.failed) this.msg += ' Dieser Fehler kommt in ein paar Tagen zur Wiederholung.';
    this.refresh(true); this.renderPanel();
  },

  // ----- Rätsel-Rush und Survival -----
  startRush(m) {
    const modes = { r3: { name: '3 Minuten', ms: 180000 }, r5: { name: '5 Minuten', ms: 300000 }, surv: { name: 'Survival', ms: 0 } };
    this.rush = { mode: m, name: modes[m].name, end: modes[m].ms ? Date.now() + modes[m].ms : 0, strikes: 0, score: 0, rating: 450, used: new Set(), log: [] };
    clearInterval(this.rushTimer);
    this.rushTimer = setInterval(() => this.rushTick(), 200);
    this.next();
  },
  rushTick() {
    const R = this.rush;
    if (!R) { clearInterval(this.rushTimer); return; }
    if (R.end && Date.now() >= R.end) { this.endRush(); return; }
    const el = $('rushTime');
    if (el && R.end) { const left = R.end - Date.now(); el.textContent = fmtClock(left); el.classList.toggle('low', left < 15000); }
  },
  rushHit() {
    const R = this.rush;
    R.score++; R.log.push({ r: this.cur.rating, ok: true });
    R.rating += 55 + Math.random() * 40;
    Sound.play('good');
    this.marks = { [this.game.moves[this.game.moves.length - 1].to]: 'ok' };
    this.refresh(); this.renderPanel();
    const tok = this.token;
    setTimeout(() => { if (tok === this.token && this.rush) this.next(); }, 350);
  },
  rushMiss(rec) {
    const R = this.rush;
    R.strikes++; R.log.push({ r: this.cur.rating, ok: false });
    R.rating = Math.max(400, R.rating - 40);
    Sound.play('bad');
    this.marks = { [rec.to]: 'bad' };
    this.busy = true;
    this.refresh(true); this.renderPanel();
    const tok = this.token;
    setTimeout(() => {
      if (tok !== this.token || !this.rush) return;
      if (R.strikes >= 3) this.endRush(); else this.next();
    }, 700);
  },
  endRush() {
    const R = this.rush;
    if (!R) return;
    clearInterval(this.rushTimer);
    this.rush = null; this.token++; this.busy = false;
    const rec = store.get('rushRecords', {});
    const isRecord = R.score > (rec[R.mode] || 0);
    if (isRecord) { rec[R.mode] = R.score; store.set('rushRecords', rec); }
    markActivity();
    Sound.play('end');
    showModal(`<div style="font-size:54px">⚡</div><h2>${R.name}: ${R.score} gelöst</h2>
      ${isRecord ? '<div class="xp-gain">🏆 Neuer Rekord!</div>' : `<p class="muted">Rekord: ${rec[R.mode] || 0}</p>`}
      <div class="rush-log">${R.log.map(x => `<span class="${x.ok ? 'ok' : 'bad'}">${Math.round(x.r)}</span>`).join('')}</div>
      <button class="btn primary full" data-act="again">Nochmal</button><button class="btn full" data-act="close">Zurück zu den Rätseln</button>`, {
      again: () => { hideModal(); this.startRush(R.mode); },
      close: () => { hideModal(); this.view = 'rush'; this.next(); }
    });
  },
  renderEmpty() {
    const p = $('panel-puzzle');
    p.innerHTML = this.tabsHtml() + (this.theme === 'mine'
      ? `<div class="status-box"><b>⭐ Keine Fehler fällig</b><div class="small" style="margin-top:4px">Hier landen automatisch deine Fehler und Patzer aus Partien gegen die Bots (mit Live-Bewertung) und aus der Partieanalyse. Spiel eine Partie oder analysiere eine – dann übst du genau deine eigenen Schwachstellen.</div>
         <div class="small muted" style="margin-top:6px">Gespeichert: ${MyPuzzles.list().length} · später fällig: ${MyPuzzles.list().filter(x => (x.reps || 0) < REVIEW_DAYS.length && x.due > Date.now()).length}</div></div>`
      : '<div class="status-box">Keine Rätsel für dieses Thema gefunden.</div>') + this.themesHtml();
    this.bindCommon(p);
    board.movable = -1; board.set(new C.Position(), {}); setStrip('top', null); setStrip('bottom', null);
  },
  tabsHtml() {
    return `<div class="seg" style="margin-bottom:10px"><button class="${this.view === 'train' && !this.rush ? 'active' : ''}" data-act="view" data-arg="train">🧩 Training</button><button class="${this.view === 'rush' || this.rush ? 'active' : ''}" data-act="view" data-arg="rush">⚡ Rush</button></div>`;
  },
  themesHtml() {
    const due = MyPuzzles.due().length;
    return `<h3>Thema</h3><div class="theme-chips">${PUZZLE_THEMES.map(([id, name]) => `<button class="chip-btn ${this.theme === id ? 'active' : ''}" data-act="theme" data-arg="${id}">${name}${id === 'mine' && due ? ` <b>${due}</b>` : ''}</button>`).join('')}</div>`;
  },
  bindCommon(p) {
    bind(p, {
      view: v => { if (this.rush) { if (!confirm('Rush abbrechen?')) return; this.endRush(); hideModal(); } this.view = v; if (v === 'train' && !this.cur) this.next(); this.renderPanel(); },
      theme: v => { this.theme = v; store.set('puzzleTheme', v); this.next(); },
      rush: m => this.startRush(m),
      stop: () => this.endRush()
    });
  },

  hint() {
    if (this.solved || this.busy) return;
    if (!this.failed) { this.failed = true; this.rate(false); }
    this.hintSq = C.parseSq(this.cur.sol[this.step].slice(0, 2));
    this.msg = 'Hinweis: Ziehe mit der markierten Figur.';
    this.refresh(); this.renderPanel();
  },

  async solution() {
    if (this.solved || this.busy) return;
    if (!this.failed) { this.failed = true; this.rate(false); }
    this.showing = true;
    this.busy = true;
    const tok = this.token;
    this.msg = 'Lösung wird gezeigt …';
    this.renderPanel();
    while (this.step < this.cur.sol.length) {
      const rec = this.game.play(this.cur.sol[this.step]);
      this.step++;
      if (rec) Sound.forMove(rec, this.game.pos);
      this.refresh(true);
      await sleep(800);
      if (tok !== this.token) return;
    }
    this.showing = false;
    this.busy = false;
    this.solved = true;
    this.msg = 'Das war die Lösung. Weiter zum nächsten Rätsel!';
    this.refresh(); this.renderPanel();
  },

  renderPanel() {
    const p = $('panel-puzzle'), s = this.st, pz = this.cur;
    if (this.view === 'rush' && !this.rush) {
      const rec = store.get('rushRecords', {});
      p.innerHTML = this.tabsHtml() + `<h2>⚡ Rätsel-Rush</h2><p class="muted small">Löse so viele Rätsel wie möglich. Sie starten leicht und werden mit jedem gelösten Rätsel schwerer. Nach 3 Fehlern ist Schluss.</p>
        <div class="rush-modes">
          <button class="rush-card" data-act="rush" data-arg="r3"><span>⏱️</span><b>3 Minuten</b><small>Rekord: ${rec.r3 || 0}</small></button>
          <button class="rush-card" data-act="rush" data-arg="r5"><span>⏳</span><b>5 Minuten</b><small>Rekord: ${rec.r5 || 0}</small></button>
          <button class="rush-card" data-act="rush" data-arg="surv"><span>❤️</span><b>Survival</b><small>ohne Zeitlimit · Rekord: ${rec.surv || 0}</small></button>
        </div>`;
      this.bindCommon(p);
      return;
    }
    if (!pz) return;
    const side = this.userColor === 0 ? 'Weiß' : 'Schwarz';
    if (this.rush) {
      const R = this.rush;
      p.innerHTML = this.tabsHtml() + `<div class="rush-head"><div><div class="muted small">${R.name}</div><div class="rating-big">${R.score}</div><div class="muted small">gelöst</div></div>
        <div class="rush-time ${R.end ? '' : 'inf'}" id="rushTime">${R.end ? fmtClock(R.end - Date.now()) : '∞'}</div>
        <div class="rush-lives">${[0, 1, 2].map(i => `<span class="${i < R.strikes ? 'x' : ''}">${i < R.strikes ? '✗' : '●'}</span>`).join('')}</div></div>
        <div class="status-box ${this.marks && Object.values(this.marks)[0] === 'bad' ? 'bad' : ''}"><b>${side} am Zug</b> – finde den besten Zug!</div>
        <div class="rush-log">${R.log.slice(-24).map(x => `<span class="${x.ok ? 'ok' : 'bad'}">${Math.round(x.r)}</span>`).join('')}</div>
        <button class="btn full" data-act="stop">Beenden</button>`;
      this.bindCommon(p);
      return;
    }
    const userMoves = Math.ceil(pz.sol.length / 2);
    const delta = this.lastDelta == null ? '' : `<span class="delta ${this.lastDelta >= 0 ? 'up' : 'down'}">${this.lastDelta >= 0 ? '+' : ''}${this.lastDelta}</span>`;
    const statusCls = this.solved && !this.failed ? 'good' : this.msg.startsWith('✗') ? 'bad' : '';
    const done = this.solved;
    const rate = s.tries ? Math.round(100 * s.solved / s.tries) : 0;
    p.innerHTML = this.tabsHtml() + `<div class="row"><div><div class="muted small">${pz.own ? '⭐ Fehler-Training' : 'Deine Rätsel-Wertung'}</div>
        <div class="rating-big">${pz.own ? MyPuzzles.due().length + '<span class="muted small" style="font-size:14px"> fällig</span>' : Math.round(s.rating) + ' ' + delta}</div></div>
        <div style="text-align:right"><div class="muted small">Serie</div><div class="rating-big">🔥${s.streak}</div></div></div>
      <div class="status-box ${statusCls}">
        ${this.busy && !this.game.moves.length && pz.last ? 'Gegner zieht …' : `<b>${side} am Zug</b> – finde den besten Zug${userMoves > 1 ? ` <span class="muted">(${userMoves} Züge)</span>` : ''}`}
        ${this.msg ? `<div style="margin-top:6px">${this.msg}</div>` : ''}
      </div>
      ${done || this.failed ? `<div>${pz.own ? '' : `<span class="pill">Rätsel #${pz.id + 1}</span><span class="pill">Wertung ${pz.rating}</span>`}${pz.themes.map(t => `<span class="pill">${t}</span>`).join('')}</div>` : ''}
      <div class="btn-row">
        <button class="btn" data-act="hint" ${done ? 'disabled' : ''}>💡 Hinweis</button>
        <button class="btn" data-act="sol" ${done ? 'disabled' : ''}>👁 Lösung</button>
      </div>
      <button class="btn ${done ? 'primary' : ''} full" data-act="next">${done ? 'Nächstes Rätsel →' : 'Überspringen →'}</button>
      ${this.themesHtml()}
      ${this.theme === 'mine' ? '' : `<h3>Schwierigkeit</h3>
      <div class="seg">${[[-200, 'Leichter'], [0, 'Normal'], [200, 'Schwerer']].map(([v, l]) => `<button class="${s.diff === v ? 'active' : ''}" data-act="diff" data-arg="${v}">${l}</button>`).join('')}</div>
      <p class="muted small">Die Rätsel passen sich deiner Wertung an: Löst du sie, werden sie schwieriger.</p>`}
      <h3>Statistik</h3>
      <div class="stat-grid">
        <div class="stat"><b>${s.solved}</b><span>Gelöst</span></div>
        <div class="stat"><b>${rate}%</b><span>Quote</span></div>
        <div class="stat"><b>${Math.round(s.peak)}</b><span>Höchstwert</span></div>
        <div class="stat"><b>${s.tries}</b><span>Versuche</span></div>
        <div class="stat"><b>${s.bestStreak}</b><span>Beste Serie</span></div>
        <div class="stat"><b>${MyPuzzles.list().length}</b><span>Eigene Fehler</span></div>
      </div>
      ${s.recent.length ? `<h3>Letzte Rätsel</h3><div>${s.recent.map(r => `<span class="pill" style="background:${r.ok ? '#3f4a35' : '#5a2f2b'}">${r.ok ? '✓' : '✗'} ${r.r}</span>`).join('')}</div>` : ''}
      <div style="height:10px"></div>
      <button class="btn small" data-act="reset">Fortschritt zurücksetzen</button>`;
    this.bindCommon(p);
    bind(p, {
      hint: () => this.hint(),
      sol: () => this.solution(),
      next: () => { if (!this.solved && !this.failed && this.game.moves.length) this.rate(false); this.showing = false; this.next(); },
      diff: v => { s.diff = +v; this.save(); this.renderPanel(); },
      view: v => { this.view = v; this.renderPanel(); },
      theme: v => { this.theme = v; store.set('puzzleTheme', v); this.next(); },
      reset: () => {
        if (!confirm('Rätsel-Wertung und Statistik wirklich zurücksetzen?')) return;
        this.st = { rating: 800, solved: 0, tries: 0, streak: 0, bestStreak: 0, peak: 800, done: {}, recent: [], diff: 0 };
        this.save(); this.next();
      }
    });
  }
};

// ---------- Zugbewertung ----------
const CLS = {
  brilliant: { name: 'Brillant', phrase: 'brillant', sym: '!!', color: '#1fb5a8', dot: true, info: 'Starkes Opfer, das die Engine bestätigt' },
  great: { name: 'Großartig', phrase: 'großartig', sym: '!', color: '#5b8fd1', dot: true, info: 'Hat den Fehler des Gegners bestraft' },
  best: { name: 'Bester Zug', phrase: 'der beste Zug', sym: '★', color: '#7cb342', dot: false, info: 'Der Zug der Engine' },
  excellent: { name: 'Exzellent', phrase: 'exzellent', sym: '✓', color: '#97bf4a', dot: false, info: 'Fast so gut wie der beste Zug' },
  good: { name: 'Guter Zug', phrase: 'ein guter Zug', sym: '✓', color: '#9fae8c', dot: false, info: 'Solide, kleiner Verlust' },
  forced: { name: 'Erzwungen', phrase: 'erzwungen', sym: '□', color: '#8d8486', dot: false, info: 'Der einzige legale Zug' },
  inaccuracy: { name: 'Leichter Fehler', phrase: 'ein leichter Fehler', sym: '?!', color: '#f2b53a', dot: true, info: 'Ungenauigkeit, es gab Besseres' },
  mistake: { name: 'Fehler', phrase: 'ein Fehler', sym: '?', color: '#ff9446', dot: true, info: 'Verschlechtert die Stellung deutlich' },
  miss: { name: 'Verpasst', phrase: 'eine verpasste Chance', sym: '✗', color: '#ff6f6f', dot: true, info: 'Gegnerfehler nicht ausgenutzt' },
  blunder: { name: 'Patzer', phrase: 'ein Patzer', sym: '??', color: '#e8273a', dot: true, info: 'Grober Fehler, oft partieentscheidend' }
};
const CLS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const PIECE_VAL = [0, 1, 3, 3, 5, 9, 0];

// Opfer: die gezogene Figur steht danach ungedeckt oder günstig schlagbar
function isSacrifice(posBefore, uci) {
  const p = posBefore.clone(), m = p.fromUci(uci);
  if (!m) return false;
  const to = C.mTo(m), mover = p.side;
  const captured = (C.mFlags(m) & C.F_EP) ? 1 : (p.board[to] & 7);
  p.make(m);
  if (p.legalMoves().length === 0) return false;
  const v = PIECE_VAL[p.board[to] & 7];
  if (v < 3 || v - PIECE_VAL[captured] < 2) return false;
  let minAtt = 99;
  for (const c of p.genMoves([], true)) {
    if (C.mTo(c) !== to) continue;
    const t = p.board[C.mFrom(c)] & 7;
    minAtt = Math.min(minAtt, t === 6 ? 100 : PIECE_VAL[t]);
  }
  if (minAtt === 99) return false;
  return !p.attacked(to, mover) || minAtt < v;
}

// Bewertet einen Zug aus Sicht des Ziehenden. Bewertungen in Centipawns aus Sicht von Weiß.
function classifyMove(pos, uci, evB, evA, bestUci, prevCls) {
  const side = pos.side;
  const wb = side === 0 ? winPct(evB) : 100 - winPct(evB);
  const wa = side === 0 ? winPct(evA) : 100 - winPct(evA);
  let loss = Math.max(0, wb - wa);
  // In schon entschiedenen Stellungen ändert sich die Gewinnchance kaum –
  // daher zählt dort auch der Centipawn-Verlust (außer beim klar Gewinnenden)
  const cap = v => Math.max(-2000, Math.min(2000, v));
  const cb = side === 0 ? cap(evB) : -cap(evB), ca = side === 0 ? cap(evA) : -cap(evA);
  if (cb < 300) loss = Math.max(loss, Math.max(0, cb - ca) / 25);
  const oppErred = prevCls === 'mistake' || prevCls === 'blunder' || prevCls === 'miss';
  let cls;
  if (pos.legalMoves().length === 1) cls = 'forced';
  else if (loss < 2 && wa >= 50 && wb < 97 && isSacrifice(pos, uci)) cls = 'brilliant';
  else if (uci === bestUci || loss < 0.5) cls = oppErred && wa >= 60 ? 'great' : 'best';
  else if (loss < 2.5) cls = 'excellent';
  else if (loss < 6) cls = 'good';
  else if (oppErred && loss < 22) cls = 'miss';
  else if (loss < 12) cls = 'inaccuracy';
  else if (loss < 22) cls = 'mistake';
  else cls = 'blunder';
  return { cls, loss };
}

const Analysis = {
  record: null, game: null, evals: [], best: [], pvs: [], cls: [], ply: 0, running: false, token: 0, done: false,
  timeMs: store.get('anaTime', 600),

  activate() {
    board.setFlipped(!!(this.record && this.record.userColor === 1));
    EvalBar.show(!!this.game);
    this.refresh(); this.renderPanel();
  },

  loadRecord(rec) {
    if (!rec) return;
    analysisEngine.cancel();
    this.token++;
    this.record = rec;
    this.game = Game.fromUci(rec.startFen, rec.moves);
    this.evals = []; this.best = []; this.pvs = []; this.cls = []; this.done = false;
    this.ply = 0;
    board.setFlipped(rec.userColor === 1);
    this.run();
  },

  async run() {
    const tok = this.token, g = this.game;
    this.running = true;
    this.renderPanel();
    const p = new C.Position(g.startFen);
    for (let i = 0; i <= g.moves.length; i++) {
      if (i > 0) p.make(p.fromUci(g.moves[i - 1].uci));
      const st = p.status();
      if (st) {
        this.evals[i] = st === 'checkmate' ? (p.side === 0 ? -C.MATE : C.MATE) : 0;
        this.best[i] = null; this.pvs[i] = [];
      } else {
        const r = await analysisEngine.request({ cmd: 'search', fen: g.startFen, moves: g.uci().slice(0, i), timeMs: this.timeMs });
        if (tok !== this.token) return;
        if (!r) { this.running = false; return; }
        this.evals[i] = p.side === 0 ? r.score : -r.score;
        this.best[i] = r.move; this.pvs[i] = r.pv;
      }
      if (mode === 'analysis') this.renderProgress(i / g.moves.length);
    }
    this.classify();
    this.running = false;
    this.done = true;
    this.addedMistakes = MyPuzzles.addFromGame({ startFen: this.game.startFen, moves: this.game.uci(), evals: this.evals, best: this.best, cls: this.cls,
      userColor: this.record.userColor, date: this.record.date, label: '' });
    if (this.record.id && this.record.userColor != null) {
      const games = store.get('games', []), gi = games.findIndex(x => x.id === this.record.id);
      if (gi >= 0) { games[gi].acc = Math.round(this.summary[this.record.userColor].acc * 10) / 10; store.set('games', games); }
    }
    if (mode === 'analysis') { this.refresh(); this.renderPanel(); }
  },

  // Gewinnwahrscheinlichkeit vor/nach jedem Zug aus Sicht des Ziehenden
  classify() {
    const g = this.game;
    this.losses = [];
    const pos = new C.Position(g.startFen);
    for (let i = 0; i < g.moves.length; i++) {
      const r = classifyMove(pos, g.moves[i].uci, this.evals[i], this.evals[i + 1], this.best[i], this.cls[i - 1]);
      this.cls[i] = r.cls;
      this.losses[i] = r.loss;
      pos.make(pos.fromUci(g.moves[i].uci));
    }
    this.summary = [0, 1].map(side => {
      const idx = g.moves.map((m, i) => i).filter(i => g.moves[i].side === side);
      const accs = idx.map(i => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * this.losses[i]) - 3.1669)));
      // Mittel aus arithmetischem und harmonischem Mittel: grobe Fehler wiegen schwerer
      const mean = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
      const harm = accs.length ? accs.length / accs.reduce((a, b) => a + 1 / Math.max(5, b), 0) : 0;
      const acc = (mean + harm) / 2;
      const counts = {};
      for (const k of CLS_ORDER) counts[k] = 0;
      for (const i of idx) counts[this.cls[i]]++;
      const pts = [[0, 200], [50, 400], [70, 1000], [80, 1400], [90, 1900], [95, 2200], [100, 2500]];
      let elo = null;
      if (accs.length >= 5) {
        for (let k = 1; k < pts.length; k++) if (acc <= pts[k][0]) {
          const [a0, e0] = pts[k - 1], [a1, e1] = pts[k];
          elo = Math.round((e0 + (acc - a0) / (a1 - a0) * (e1 - e0)) / 50) * 50;
          break;
        }
      }
      return { acc, counts, elo };
    });
  },

  refresh() {
    if (mode !== 'analysis') return;
    if (!this.game) {
      board.movable = -1;
      board.set(new C.Position(), {});
      EvalBar.show(false);
      setStrip('top', null); setStrip('bottom', null);
      return;
    }
    const pos = this.game.positionAt(this.ply);
    const lm = this.game.moves[this.ply - 1];
    const opts = { last: lm ? [lm.from, lm.to] : null, arrows: [] };
    if (lm && this.cls[this.ply - 1]) {
      const cl = CLS[this.cls[this.ply - 1]];
      opts.badge = { sq: lm.to, sym: cl.sym, color: cl.color };
      const bm = this.best[this.ply - 1];
      if (bm && bm !== lm.uci && ['inaccuracy', 'mistake', 'miss', 'blunder', 'good'].includes(this.cls[this.ply - 1]))
        opts.arrows.push({ from: C.parseSq(bm.slice(0, 2)), to: C.parseSq(bm.slice(2, 4)), color: 'rgba(129,182,76,.9)' });
    }
    if (this.showBest && this.best[this.ply]) {
      const bm = this.best[this.ply];
      opts.arrows.push({ from: C.parseSq(bm.slice(0, 2)), to: C.parseSq(bm.slice(2, 4)), color: 'rgba(60,140,255,.85)' });
    }
    board.movable = -1;
    board.set(pos, opts);
    renderBoardNav();
    EvalBar.show(true);
    EvalBar.set(this.evals[this.ply] != null ? this.evals[this.ply] : null);
    const r = this.record;
    const topColor = board.flipped ? 0 : 1;
    setStrip('top', { avatar: topColor ? '♚' : '♔', name: topColor ? r.black : r.white, pos, color: topColor });
    setStrip('bottom', { avatar: topColor ? '♔' : '♚', name: topColor ? r.white : r.black, pos, color: topColor ^ 1 });
  },

  go(ply) {
    if (!this.game) return;
    this.ply = Math.max(0, Math.min(this.game.moves.length, ply));
    this.refresh();
    this.renderExplain();
    this.renderMoves();
    this.renderGraph();
  },

  sanLine(ply, uciList, n) {
    const p = this.game.positionAt(ply), out = [];
    for (const u of (uciList || []).slice(0, n)) {
      const m = p.fromUci(u);
      if (!m) break;
      out.push(de(p.toSan(m)));
      p.make(m);
    }
    return out.join(' ');
  },

  renderExplain() {
    const box = $('anaExplain');
    if (!box) return;
    if (this.ply === 0) {
      const b = this.best[0];
      box.innerHTML = b ? `Startstellung · Bewertung <b>${fmtEval(this.evals[0])}</b>` : 'Startstellung';
      return;
    }
    const i = this.ply - 1, m = this.game.moves[i], c = this.cls[i];
    const num = Math.floor((new C.Position(this.game.startFen).full * 2 + (this.game.moves[0].side) + i) / 2);
    const label = `${num}${m.side === 0 ? '.' : '…'} ${de(m.san)}`;
    if (!c) { box.innerHTML = `<b>${label}</b> <span class="muted">– wird analysiert …</span>`; return; }
    const cl = CLS[c];
    let html = `<div><span class="cls-dot" style="background:${cl.color}">${cl.sym}</span> <b>${label}</b> ist <b style="color:${cl.color}">${cl.phrase}</b> <span class="muted">(${fmtEval(this.evals[this.ply])})</span></div>`;
    if (!['best', 'forced', 'brilliant', 'great'].includes(c) && this.best[i]) {
      html += `<div class="small" style="margin-top:4px">Besser war <b>${this.sanLine(i, [this.best[i]], 1)}</b> <span class="muted">(${fmtEval(this.evals[i])})</span><br><span class="muted">Hauptvariante: ${this.sanLine(i, this.pvs[i], 6)}</span></div>`;
    }
    if (this.best[this.ply]) html += `<div class="small muted" style="margin-top:4px">Beste Fortsetzung jetzt: ${this.sanLine(this.ply, this.pvs[this.ply], 5)}</div>`;
    box.innerHTML = html;
  },

  renderMoves() {
    const box = $('anaMoves');
    if (!box) return;
    box.innerHTML = moveListHtml(this.game, this.ply, this.cls);
    box.querySelectorAll('[data-ply]').forEach(e => e.onclick = () => this.go(+e.dataset.ply));
    scrollListTo(box, box.querySelector('.cur'));
  },

  renderGraph() {
    const svg = $('anaGraph');
    if (!svg || !this.evals.length) return;
    const n = Math.max(1, this.game.moves.length), W = 400, H = 90;
    const pts = this.evals.map((e, i) => [i / n * W, H - winPct(e) / 100 * H]);
    let d = `M0,${H} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${pts[pts.length - 1][0].toFixed(1)},${H} Z`;
    let dots = '';
    this.cls.forEach((c, i) => {
      if (['mistake', 'miss', 'blunder', 'brilliant'].includes(c)) {
        const p = pts[i + 1];
        if (p) dots += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${CLS[c].color}" stroke="#222" stroke-width="1"/>`;
      }
    });
    const cx = this.ply / n * W;
    svg.innerHTML = `<path d="${d}" fill="#f0f0f0"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#888" stroke-width=".5" stroke-dasharray="3 3"/>
      ${dots}<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#81b64c" stroke-width="2"/>`;
  },

  renderProgress(f) {
    const bar = $('anaProg');
    if (bar) bar.style.width = Math.round(f * 100) + '%';
    const t = $('anaProgTxt');
    if (t) t.textContent = `Analysiere … ${Math.round(f * 100)}%`;
    this.renderGraph();
  },

  renderPanel() {
    const p = $('panel-analysis');
    const games = store.get('games', []);
    const listHtml = games.length ? games.map((g, i) => gameItemHtml(g, i)).join('') : '<p class="muted">Noch keine gespeicherten Partien. Spiel eine Partie gegen den Bot!</p>';

    const settings = `<div class="row"><span class="muted small">Analysetiefe</span>
      <select id="anaTime">${[[250, 'Schnell'], [600, 'Normal'], [1500, 'Gründlich'], [3000, 'Sehr gründlich']].map(([v, l]) => `<option value="${v}" ${this.timeMs === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;

    if (!this.game) {
      const curGame = Play.game && Play.game.moves.length;
      p.innerHTML = `<h2>Partieanalyse</h2>
        <p class="muted small">Die Engine bewertet jeden Zug, berechnet deine Genauigkeit und zeigt dir Fehler und bessere Züge.</p>
        <div class="btn-row"><button class="btn" data-act="free">🔍 Analysebrett</button><button class="btn" data-act="editor">✏️ Stellung aufbauen</button></div>
        ${curGame ? '<button class="btn primary full" data-act="cur">Aktuelle Partie analysieren</button>' : ''}
        <h3>Gespeicherte Partien</h3>${listHtml}
        <h3>PGN einfügen</h3>
        <textarea id="pgnIn" placeholder="PGN-Text einfügen, z. B. 1. e4 e5 2. Sf3 Sc6 3. Lb5 … (deutsche oder englische Notation)"></textarea>
        <div style="height:6px"></div><button class="btn full" data-act="import">PGN analysieren</button>
        <div style="height:10px"></div>${settings}`;
    } else {
      const s = this.summary;
      const r = this.record;
      p.innerHTML = `<div class="row"><h2>Analyse</h2><button class="btn small" data-act="close">← Partien</button></div>
        <div class="muted small">${esc(r.white)} – ${esc(r.black)} · ${r.result || ''}</div>
        ${this.running ? `<div class="progress"><div id="anaProg"></div></div><div class="muted small" id="anaProgTxt">Analysiere …</div>` : ''}
        ${this.done && s ? `<div class="acc-row">
            <div class="acc-box white"><div class="muted small">♔ ${esc(r.white)}</div><div class="acc">${s[0].acc.toFixed(1)}</div><div class="muted small">Genauigkeit${s[0].elo ? ` · ~${s[0].elo} Elo` : ''}</div></div>
            <div class="acc-box black"><div class="muted small">♚ ${esc(r.black)}</div><div class="acc">${s[1].acc.toFixed(1)}</div><div class="muted small">Genauigkeit${s[1].elo ? ` · ~${s[1].elo} Elo` : ''}</div></div>
          </div>
          <table class="cls-table">${CLS_ORDER.map(k => `<tr><td class="n ${s[0].counts[k] ? '' : 'zero'}">${s[0].counts[k]}</td><td><span class="cls-dot" style="background:${CLS[k].color}">${CLS[k].sym}</span> ${CLS[k].name}</td><td class="n ${s[1].counts[k] ? '' : 'zero'}">${s[1].counts[k]}</td></tr>`).join('')}</table>` : ''}
        <div style="height:8px"></div>
        ${this.done && this.addedMistakes ? `<div class="status-box good small">⭐ <b>${this.addedMistakes} ${this.addedMistakes === 1 ? 'Fehler' : 'Fehler'}</b> ins Fehler-Training übernommen. <button class="btn small" data-act="mistakes">Jetzt üben</button></div>` : ''}
        <svg class="graph" id="anaGraph" viewBox="0 0 400 90" preserveAspectRatio="none"></svg>
        <div class="explain" id="anaExplain"></div>
        <div class="btn-row">
          <button class="btn small" data-act="nextErr">⚠ Nächster Fehler</button>
          <button class="btn small" data-act="best">${this.showBest ? '🔵 Pfeil aus' : '🔵 Bester Zug'}</button>
          <button class="btn small" data-act="flip">⇅ Drehen</button>
        </div>
        <div class="movelist" id="anaMoves"></div>
        <div class="btn-row"><button class="btn small" data-act="fromhere">♟ Ab hier spielen</button><button class="btn small" data-act="board">🔍 Analysebrett</button></div>
        <div class="btn-row"><button class="btn small" data-act="pgn">📋 PGN kopieren</button><button class="btn small" data-act="redo">↻ Neu analysieren</button></div>
        ${settings}`;
      const graph = $('anaGraph');
      graph.onclick = e => {
        const rc = graph.getBoundingClientRect();
        this.go(Math.round((e.clientX - rc.left) / rc.width * this.game.moves.length));
      };
    }
    bind(p, {
      cur: () => {
        const b = Play.bot, g = Play.game;
        this.loadRecord({
          date: Date.now(), white: b.human ? 'Weiß' : Play.userColor === 0 ? 'Du' : b.name, black: b.human ? 'Schwarz' : Play.userColor === 1 ? 'Du' : b.name,
          result: Play.over ? Play.over.result : '*', userColor: b.human ? null : Play.userColor, startFen: g.startFen, moves: g.uci()
        });
        this.activate();
      },
      open: i => { this.loadRecord(games[+i]); this.activate(); },
      del: (i, e) => { e.stopPropagation(); games.splice(+i, 1); store.set('games', games); this.renderPanel(); },
      import: () => {
        try {
          const { game, headers } = parsePgn($('pgnIn').value);
          if (!game.moves.length) throw new Error('Keine Züge gefunden');
          this.loadRecord({ date: Date.now(), white: headers.White || 'Weiß', black: headers.Black || 'Schwarz', result: headers.Result || '*', userColor: null, startFen: game.startFen, moves: game.uci() });
          this.activate();
        } catch (err) { alert(err.message); }
      },
      close: () => { analysisEngine.cancel(); this.token++; this.game = null; this.record = null; this.running = false; this.activate(); },
      first: () => this.go(0), prev: () => this.go(this.ply - 1), next: () => this.go(this.ply + 1), last: () => this.go(1e9),
      nextErr: () => {
        for (let k = 1; k <= this.cls.length; k++) {
          const i = (this.ply + k - 1) % this.cls.length;
          if (['inaccuracy', 'mistake', 'miss', 'blunder'].includes(this.cls[i])) { this.go(i + 1); return; }
        }
      },
      best: () => { this.showBest = !this.showBest; this.renderPanel(); this.refresh(); },
      flip: () => { board.setFlipped(!board.flipped); this.refresh(); },
      pgn: () => copyText(this.game.pgn(this.record)),
      redo: () => this.loadRecord(this.record),
      fromhere: () => { const p = this.game.positionAt(this.ply); openPlayFrom(p.fen()); },
      board: () => Free.open(this.game.startFen, this.game.uci(), this.ply),
      free: () => Free.open(),
      editor: () => Editor.open(),
      mistakes: () => { Puzzles.theme = 'mine'; store.set('puzzleTheme', 'mine'); Puzzles.view = 'train'; Puzzles.cur = null; switchTab('puzzle'); }
    });
    const sel = $('anaTime');
    if (sel) sel.onchange = e => { this.timeMs = +e.target.value; store.set('anaTime', this.timeMs); };
    if (this.game) { this.renderExplain(); this.renderMoves(); this.renderGraph(); }
  }
};

// ---------- Allgemeines ----------
function showModal(html, actions) {
  $('modalBox').innerHTML = html;
  bind($('modalBox'), actions || {});
  $('modal').classList.remove('hidden');
}
function hideModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') hideModal(); });

function copyText(t, what) {
  what = what || 'PGN';
  const done = () => showModal(`<h2>📋 Kopiert</h2><p class="muted">${what} ist in der Zwischenablage.</p><button class="btn full" data-act="c">OK</button>`, { c: hideModal });
  const fallback = () => {
    showModal(`<h2>${what}</h2><textarea readonly style="min-height:180px">${esc(t)}</textarea><button class="btn full" data-act="c">Schließen</button>`, { c: hideModal });
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
}

// ---------- Tage-Serie (Lernen und Rätsel zählen) ----------
function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function getActivity() {
  const a = store.get('activity', { last: null, streak: 0, best: 0 });
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (a.last !== dayKey(new Date()) && a.last !== dayKey(y)) a.streak = 0;
  return a;
}
function markActivity() {
  const a = store.get('activity', { last: null, streak: 0, best: 0 });
  const today = dayKey(new Date()), y = new Date(); y.setDate(y.getDate() - 1);
  if (a.last === today) return;
  a.streak = a.last === dayKey(y) ? a.streak + 1 : 1;
  a.best = Math.max(a.best || 0, a.streak);
  a.last = today;
  store.set('activity', a);
}

// ---------- Modus: Lernpfad ----------
// Lektionen in Pfad-Reihenfolge; nach jedem Kapitel ein Wiederholungs-Knoten
const ALL_LESSONS = LESSONS.flatMap((u, ui) => [
  ...u.lessons.map(l => ({ unit: u, ui, lesson: l })),
  { unit: u, ui, lesson: { id: 'rev-' + u.id, title: 'Wiederholung', icon: '🔁', review: true } }
]);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const TEST_TYPES = ['quiz', 'move', 'mate', 'check', 'line'];
const unitSteps = (u, types) => u.lessons.flatMap(l => l.steps.filter(st => types.includes(st.t)));
const PRAISE = ['Richtig!', 'Super!', 'Klasse!', 'Genau!', 'Perfekt!', 'Stark!', 'Sehr gut!'];
const mdText = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

const Learn = {
  st: Object.assign({ done: {}, xp: 0 }, store.get('learn', {})),
  lesson: null, unit: null, idx: 0, mistakes: 0, pos: null, locked: false, solved: false, fb: null, token: 0,

  save() { store.set('learn', this.st); },
  isUnlocked(k) { return k === 0 || this.st.done[ALL_LESSONS[k - 1].lesson.id] != null || this.st.done[ALL_LESSONS[k].lesson.id] != null; },
  nextIndex() { const k = ALL_LESSONS.findIndex(x => this.st.done[x.lesson.id] == null); return k < 0 ? null : k; },

  activate() {
    if (this.lesson) { this.setMode('lesson'); this.draw(); this.renderBar(); }
    else { this.setMode('path'); this.renderPath(); }
  },
  setMode(m) {
    document.body.classList.toggle('learn-mode', m === 'path');
    document.body.classList.toggle('lesson-mode', m === 'lesson');
    resize();
  },

  // ----- Pfad-Übersicht -----
  renderPath() {
    if (this.st.start == null && !Object.keys(this.st.done).length) { this.renderOnboarding(); return; }
    const act = getActivity();
    const doneCount = ALL_LESSONS.filter(x => !x.lesson.review && this.st.done[x.lesson.id] != null).length;
    const total = ALL_LESSONS.filter(x => !x.lesson.review).length;
    const next = this.nextIndex();
    const canMix = doneCount > 0;
    let html = `<div class="learn-head">
        <div><h1>Lernpfad</h1><p class="muted">Von null auf Schach – Schritt für Schritt.</p></div>
        <div class="chips"><span class="chip">🔥 ${act.streak} ${act.streak === 1 ? 'Tag' : 'Tage'}</span><span class="chip">⚡ ${this.st.xp} XP</span><span class="chip">🎓 ${doneCount}/${total}</span></div>
      </div>
      <div class="learn-actions">
        <button class="btn primary" data-act="mix" ${canMix ? '' : 'disabled'}>🔁 Übungs-Mix</button>
        <button class="btn" data-act="endgames">🏁 Endspiel-Trainer</button>
        <button class="btn" data-act="placement">🎯 Einstufungspartie</button>
      </div>`;
    let lastUi = -1;
    ALL_LESSONS.forEach((x, k) => {
      const u = x.unit, ui = x.ui, l = x.lesson;
      if (ui !== lastUi) {
        if (lastUi >= 0) html += '</div>';
        lastUi = ui;
        const uDone = u.lessons.filter(q => this.st.done[q.id] != null).length;
        const firstK = ALL_LESSONS.findIndex(q => q.ui === ui);
        const canJump = !this.isUnlocked(firstK) && ui > 0;
        html += `<div class="unit-banner u${ui % 8}"><div class="ub-ic">${u.icon}</div><div><div class="ub-k">Kapitel ${ui + 1}</div><b>${u.title}</b><div class="ub-d">${u.desc}</div></div>
          ${canJump ? `<button class="ub-jump" data-act="jump" data-arg="${ui}">⏩ Springen</button>` : `<div class="ub-p">${uDone}/${u.lessons.length}</div>`}</div><div class="path">`;
      }
      const stars = this.st.done[l.id];
      const unlocked = this.isUnlocked(k), current = k === next;
      const cls = stars != null ? 'done' : current ? 'current' : unlocked ? 'open' : 'locked';
      const xoff = Math.round(Math.sin((k + 1) * 1.1) * Math.max(20, Math.min(70, (Math.min(window.innerWidth, document.documentElement.clientWidth) - 200) / 2)));
      const icon = stars != null ? (l.review ? '🔁' : '✓') : unlocked ? l.icon : '🔒';
      html += `<div class="node-wrap" style="transform:translateX(${xoff}px)">
        ${current ? '<div class="go-bubble">LOS!</div>' : ''}
        <button class="node ${cls} ${l.review ? 'review' : ''} u${ui % 8}" data-act="open" data-arg="${k}" ${unlocked ? '' : 'disabled'}>${icon}</button>
        <div class="node-label">${l.title}</div>
        ${stars ? `<div class="node-stars">${'★'.repeat(stars)}<span>${'★'.repeat(3 - stars)}</span></div>` : stars === 0 ? '<div class="node-stars skipped">übersprungen</div>' : ''}
      </div>`;
    });
    html += `</div><div class="path-end">${next == null ? '🏆 Du hast den ganzen Lernpfad geschafft! Halte dein Wissen mit dem Übungs-Mix frisch.' : '🏆 Am Ende wartet die Meisterprüfung.'}</div>`;
    $('learn').innerHTML = html;
    bind($('learn'), {
      open: k => this.start(+k),
      mix: () => this.startMix(),
      placement: () => { if (doneCount === 0 || confirm('Einstufungspartie starten? Danach werden die Kapitel bis zu deinem Niveau freigeschaltet.')) this.startPlacement(); },
      jump: ui => this.startJump(+ui),
      endgames: () => this.renderEndgames()
    });
    const cur = $('learn').querySelector('.node.current');
    if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  },

  renderEndgames() {
    this.view = 'endgames';
    const eg = this.st.endgames || {};
    $('learn').innerHTML = `<div class="learn-head"><div><h1>🏁 Endspiel-Trainer</h1><p class="muted">Die wichtigsten Endspiel-Techniken – gegen die Engine, die sich bestmöglich verteidigt.</p></div>
        <button class="btn" data-act="back">← Lernpfad</button></div>
      <div class="eg-grid">${ENDGAMES.map(g => { const r = eg[g.id]; return `<button class="eg-card ${r ? 'done' : ''}" data-act="eg" data-arg="${g.id}">
        <div class="eg-ic">${g.icon}</div><div><b>${g.title}</b><div class="muted small">${g.level} · ${g.step.t === 'hold' ? 'Remis halten' : g.step.t === 'promote' ? 'Bauer umwandeln' : 'Matt setzen'} · max. ${g.step.max} Züge</div>
        ${r ? `<div class="eg-best">✓ geschafft${r.best ? ` · Bestwert ${r.best} Züge` : ''}</div>` : ''}</div></button>`; }).join('')}</div>`;
    bind($('learn'), { back: () => { this.view = null; this.renderPath(); }, eg: id => this.startEndgame(id) });
  },
  startEndgame(id) {
    const g = ENDGAMES.find(x => x.id === id);
    if (!g) return;
    this.begin({ kind: 'endgame', id: g.id, title: g.title, icon: g.icon, steps: [{ t: 'info', text: g.info }, g.step] }, null);
  },

  renderOnboarding() {
    $('learn').innerHTML = `<div class="onboard">
      <div class="ob-logo">♞</div>
      <h1>Willkommen beim Lernpfad!</h1>
      <p class="muted">Wie viel kannst du schon? Wähle deinen Start.</p>
      <button class="ob-card" data-act="begin"><div class="ob-ic">🌱</div><div><b>Von Anfang an</b><span>Ich lerne Schach neu – vom Brett über die Figuren bis zum Matt.</span></div></button>
      <button class="ob-card" data-act="test"><div class="ob-ic">🎯</div><div><b>Einstufungspartie</b><span>Ich kann schon spielen. Eine Partie gegen einen adaptiven Bot, der sich meiner Stärke anpasst – danach weiß die App, wo ich einsteige.</span></div></button>
    </div>`;
    bind($('learn'), {
      begin: () => { this.st.start = 'begin'; this.save(); this.renderPath(); },
      test: () => this.startPlacement()
    });
  },

  // ----- Lektion -----
  start(k) {
    const x = ALL_LESSONS[k];
    if (!x) return;
    let lesson = x.lesson;
    if (lesson.review) {
      // Wiederholung: gemischte Übungen aus dem Kapitel (ohne reine Erklärungen und lange Prüfungen)
      const pool = shuffle(unitSteps(x.unit, ['quiz', 'collect', 'move', 'check', 'mate', 'line']));
      lesson = Object.assign({}, lesson, { steps: pool.slice(0, 6) });
    }
    this.begin(Object.assign({ kind: lesson.review ? 'review' : 'lesson' }, lesson), k, x.unit);
  },
  begin(session, k, unit) {
    this.k = k; this.lesson = session; this.unit = unit || null; this.idx = 0; this.mistakes = 0;
    this.isTest = session.kind === 'jump';
    this.setMode('lesson');
    this.startStep();
  },
  startMix() {
    // Übungs-Mix: bevorzugt Lektionen mit wenigen Sternen
    const pool = [];
    for (const x of ALL_LESSONS) {
      const s = this.st.done[x.lesson.id];
      if (x.lesson.review || s == null) continue;
      const w = s >= 3 ? 1 : 3;
      for (const st of x.lesson.steps) if (['quiz', 'collect', 'move', 'check', 'mate', 'line'].includes(st.t)) for (let i = 0; i < w; i++) pool.push(st);
    }
    const steps = [];
    for (const st of shuffle(pool)) { if (!steps.includes(st)) steps.push(st); if (steps.length >= 8) break; }
    if (!steps.length) return;
    this.begin({ kind: 'mix', id: 'mix', title: 'Übungs-Mix', icon: '🔁', steps }, null);
  },
  startPlacement() { switchTab('play'); Play.startPlacement(); },
  startJump(ui) {
    const before = LESSONS.slice(0, ui).filter(u => u.lessons.some(l => this.st.done[l.id] == null));
    const pool = shuffle(before.flatMap(u => shuffle(unitSteps(u, TEST_TYPES)).slice(0, 3)));
    const steps = pool.slice(0, Math.min(8, Math.max(4, pool.length)));
    this.jumpUi = ui;
    this.begin({ kind: 'jump', id: 'jump', title: 'Sprung zu Kapitel ' + (ui + 1), icon: '⏩', steps }, null);
  },
  markUnitsDone(uptoUi) {
    for (const x of ALL_LESSONS) if (x.ui < uptoUi && this.st.done[x.lesson.id] == null) this.st.done[x.lesson.id] = 0;
    this.save();
  },
  exit() {
    this.token++;
    engine.cancel();
    const wasEndgame = this.lesson && this.lesson.kind === 'endgame';
    this.lesson = null;
    this.setMode('path');
    if (wasEndgame) this.renderEndgames(); else this.renderPath();
  },
  get step() { return this.lesson.steps[this.idx]; },

  startStep() {
    const st = this.step;
    this.token++;
    this.solved = st.t === 'info'; this.fb = null; this.locked = false; this.lastMove = null;
    this.lineIdx = 0; this.userMoves = 0; this.history = []; this.wrongOpts = new Set(); this.hintUsed = false; this.stepFailed = false;
    const fen = lessonFen(st);
    this.startFen = fen;
    this.pos = fen ? this.makePos(fen, st.t === 'collect') : null;
    this.stars = (st.stars || []).map(C.parseSq);
    const interactive = !['info', 'quiz'].includes(st.t);
    this.userSide = st.user ? (st.user === 'b' ? 1 : 0) : this.pos ? (st.last ? this.pos.side ^ 1 : this.pos.side) : 0;
    board.setFlipped(!!(interactive && this.pos && this.userSide === 1));
    if (st.last) {
      this.locked = true;
      this.draw();
      this.renderBar();
      const tok = this.token;
      setTimeout(() => {
        if (tok !== this.token) return;
        const m = this.pos.fromUci(st.last);
        this.lastMove = [C.mFrom(m), C.mTo(m)];
        this.pos.make(m);
        this.history.push(st.last);
        Sound.play('move');
        this.locked = false;
        this.draw(true);
      }, 700);
    } else this.draw();
    this.renderBar();
    if (this.pos && ['hold', 'playmate', 'promote'].includes(st.t) && this.pos.side !== this.userSide) this.engineReply();
  },

  makePos(fen, collect) {
    const p = new C.Position(fen);
    let wk = false, bk = false;
    for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } if (p.board[sq] === 6) wk = true; if (p.board[sq] === 14) bk = true; }
    if (collect) {
      // Sammelübung: freie Figurenzüge ohne Könige und Schachregeln, Weiß zieht immer
      p.legalMoves = function () { return this.genMoves([], false).filter(m => !(C.mFlags(m) & C.F_CASTLE)); };
      p.inCheck = () => false;
      p.status = () => null;
    } else if (!wk || !bk) {
      p.inCheck = () => false;
    }
    return p;
  },

  draw(animate) {
    const st = this.step;
    document.body.classList.toggle('no-board', !this.pos);
    if (!this.pos) return;
    const interactive = !['info', 'quiz'].includes(st.t);
    board.movable = interactive && !this.locked && !this.solved ? this.pos.side : -1;
    const marks = {};
    for (const s of st.marks || []) marks[C.parseSq(s)] = 'mark';
    if (this.fbSq) marks[this.fbSq[0]] = this.fbSq[1];
    board.set(this.pos, {
      last: this.lastMove, marks, stars: this.stars,
      arrows: (st.arrows || []).map(([a, b]) => ({ from: C.parseSq(a), to: C.parseSq(b), color: 'rgba(255,170,60,.85)' })),
      animate: animate && this.lastMove ? this.lastMove : null
    });
  },

  renderBar() {
    const st = this.step, n = this.lesson.steps.length;
    $('lessonTop').innerHTML = `<button class="lt-close" data-act="close" title="Lektion verlassen">✕</button>
      <div class="lt-prog"><div style="width:${Math.round(this.idx / n * 100)}%"></div></div>
      <div class="lt-title">${this.lesson.icon} ${this.lesson.title}</div>`;
    bind($('lessonTop'), { close: () => { if (this.idx === 0 || confirm('Lektion verlassen? Dein Fortschritt in dieser Lektion geht verloren.')) this.exit(); } });

    const typeLabel = { info: '📖 Lernen', quiz: '❓ Frage', collect: '⭐ Sammeln', move: '🎯 Finde den Zug', check: '⚡ Schach geben', mate: '👑 Matt in 1', any: '🛡️ Rette den König', line: '⚔️ Taktik', playmate: '🏆 Prüfung', promote: '👑 Umwandeln', hold: '🛡️ Halten' }[st.t];
    const testInfo = this.isTest ? ` · Frage ${this.idx + 1}/${n}` : '';
    let html = `<div class="lb-type">${typeLabel}${testInfo}</div><div class="lb-text">${mdText(st.t === 'quiz' ? st.q : st.text)}</div>`;
    if (st.t === 'quiz') {
      html += `<div class="lb-opts">${st.opts.map((o, i) => {
        const c = this.solved && i === st.a ? 'right' : this.wrongOpts.has(i) ? 'wrong' : '';
        return `<button class="opt ${c}" data-act="opt" data-arg="${i}" ${this.solved || this.wrongOpts.has(i) ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}</div>`;
    }
    if (['playmate', 'promote', 'hold'].includes(st.t)) html += `<div class="lb-count">Zug ${this.userMoves} von ${st.max}</div>`;
    if (this.fb) html += `<div class="lb-fb ${this.fb.ok ? 'ok' : 'bad'}"><b>${this.fb.title}</b>${this.fb.text ? ' ' + mdText(this.fb.text) : ''}</div>`;
    if (this.solved) html += `<button class="btn primary full lb-next" data-act="next">${this.idx + 1 >= n ? 'Abschließen' : 'Weiter'}</button>`;
    else if (this.fb && !this.fb.ok && this.fb.retry) html += `<button class="btn full" data-act="retry">↻ Nochmal versuchen</button>`;
    else if (!this.isTest && ['move', 'line', 'mate', 'check'].includes(st.t)) html += `<button class="btn small lb-skip" data-act="hint">💡 Tipp</button>`;
    $('lessonBar').innerHTML = html;
    bind($('lessonBar'), {
      opt: i => this.answer(+i),
      next: () => this.next(),
      retry: () => this.startStep(),
      hint: () => this.hint()
    });
    const nb = $('lessonBar').querySelector('.lb-next, [data-act=retry]');
    if (nb) setTimeout(() => nb.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
  },

  answer(i) {
    const st = this.step;
    if (i === st.a) { this.solved = true; this.fb = { ok: true, title: this.praise(), text: st.why }; Sound.play('good'); }
    else if (this.isTest) { this.wrongOpts.add(i); this.mistakes++; this.stepFailed = true; this.solved = true; this.fb = { ok: false, title: 'Leider falsch.', text: 'Richtig wäre: **' + st.opts[st.a] + '**. ' + (st.why || '') }; Sound.play('bad'); }
    else { this.wrongOpts.add(i); this.mistakes++; this.fb = { ok: false, title: 'Leider falsch.', text: 'Versuch es nochmal!' }; Sound.play('bad'); }
    this.renderBar();
  },
  praise() { return PRAISE[Math.floor(Math.random() * PRAISE.length)]; },

  hint() {
    const st = this.step;
    if (!this.hintUsed) { this.hintUsed = true; this.mistakes++; }
    let uci = null;
    if (st.t === 'move') uci = st.ok[0];
    else if (st.t === 'line') uci = st.sol[this.lineIdx];
    else {
      const want = st.t === 'mate' ? 'checkmate' : 'check';
      for (const m of this.pos.legalMoves()) {
        this.pos.make(m);
        const hit = want === 'checkmate' ? this.pos.status() === 'checkmate' : this.pos.inCheck();
        this.pos.unmake();
        if (hit) { uci = this.pos.toUci(m); break; }
      }
    }
    if (!uci) return;
    this.hinted = true;
    this.fbSq = [C.parseSq(uci.slice(0, 2)), 'hint'];
    this.fb = { ok: true, title: '💡 Tipp:', text: 'Ziehe mit der markierten Figur.' };
    this.draw(); this.renderBar();
    this.fbSq = null;
  },

  success(text) {
    this.solved = true;
    this.fb = { ok: true, title: this.praise(), text: text || this.step.good || '' };
    Sound.play('good');
    this.draw(); this.renderBar();
  },

  wrong(text, undo) {
    this.mistakes++;
    if (this.isTest) {
      this.stepFailed = true; this.solved = true;
      this.fb = { ok: false, title: 'Leider falsch.', text: text };
      Sound.play('bad');
      this.draw(); this.renderBar();
      return;
    }
    this.fb = { ok: false, title: 'Nicht ganz.', text };
    Sound.play('bad');
    this.locked = true;
    this.draw(); this.renderBar();
    const tok = this.token;
    setTimeout(() => {
      if (tok !== this.token) return;
      if (undo) { this.pos.unmake(); this.history.pop(); this.lastMove = this.prevLast; }
      this.locked = false;
      this.draw();
    }, 1100);
  },

  onUserMove(uci) {
    const st = this.step;
    if (this.locked || this.solved || !this.pos) return;
    const m = this.pos.fromUci(uci);
    if (!m) return;
    const cap = !!(C.mFlags(m) & C.F_CAP);
    const san = st.t === 'collect' ? '' : this.pos.toSan(m);
    this.prevLast = this.lastMove;
    this.lastMove = [C.mFrom(m), C.mTo(m)];
    this.pos.make(m);
    this.history.push(uci);
    this.fb = null;

    if (st.t === 'collect') {
      this.pos.side = 0;
      this.pos.ep = -1;
      const to = C.mTo(m);
      const hadStar = this.stars.includes(to);
      this.stars = this.stars.filter(s => s !== to);
      Sound.play(cap || hadStar ? 'capture' : 'move');
      let black = false;
      for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } if (this.pos.board[sq] && (this.pos.board[sq] >> 3)) black = true; }
      if (!this.stars.length && !black) this.success();
      else { this.draw(true); this.renderBar(); }
      return;
    }

    Sound.forMove({ capture: cap, san }, this.pos);
    const status = this.pos.status();
    switch (st.t) {
      case 'move':
        if (st.ok.includes(uci)) this.success();
        else if (uci.length === 5 && st.ok.some(o => o.slice(0, 4) === uci.slice(0, 4))) this.wrong('Fast! Wähle beim Umwandeln eine **Dame** – sie ist am stärksten.', true);
        else this.wrong(st.why || 'Probier einen anderen Zug.', true);
        break;
      case 'check':
        if (this.pos.inCheck()) this.success(status === 'checkmate' ? 'Sogar Schachmatt!' : '');
        else this.wrong('Das ist kein Schach – der schwarze König wird nicht angegriffen.', true);
        break;
      case 'mate':
        if (status === 'checkmate') this.success('Schachmatt! 🎉');
        else if (status === 'stalemate') this.wrong('Oh nein – **Patt**! Schwarz kann nicht ziehen, steht aber nicht im Schach. Das wäre nur Remis.', true);
        else if (this.pos.inCheck()) this.wrong('Schach – aber der König kann noch entkommen. Das ist noch kein Matt.', true);
        else this.wrong('Das ist noch kein Matt. Greife den König so an, dass er nicht entkommen kann.', true);
        break;
      case 'any':
        this.success('Der König ist in Sicherheit.');
        break;
      case 'line':
        if (uci === st.sol[this.lineIdx] || status === 'checkmate') {
          this.lineIdx += 2;
          if (this.lineIdx >= st.sol.length || status === 'checkmate') { this.success(); return; }
          this.fb = { ok: true, title: this.praise(), text: 'Und weiter …' };
          this.locked = true;
          this.draw(true); this.renderBar();
          const tok = this.token;
          setTimeout(() => {
            if (tok !== this.token) return;
            const r = this.pos.fromUci(st.sol[this.lineIdx - 1]);
            const rc = !!(C.mFlags(r) & C.F_CAP), rs = this.pos.toSan(r);
            this.lastMove = [C.mFrom(r), C.mTo(r)];
            this.pos.make(r);
            this.history.push(st.sol[this.lineIdx - 1]);
            Sound.forMove({ capture: rc, san: rs }, this.pos);
            this.locked = false;
            this.fb = { ok: true, title: 'Jetzt du!', text: '' };
            this.draw(true); this.renderBar();
          }, 650);
        } else this.wrong('Das ist nicht der stärkste Zug. Schau, welche Figuren auf einer Linie stehen!', true);
        break;
      case 'hold':
        this.userMoves++;
        if (status && status !== 'checkmate') { this.success('Remis! Du hast die Stellung gehalten. 🛡️'); return; }
        if (this.userMoves >= st.max) { this.success(`${st.max} Züge gehalten – das ist Remis! 🛡️`); return; }
        this.engineReply();
        break;
      case 'promote':
        this.userMoves++;
        if (uci.length === 5) { this.checkPromotion(); return; }
        if (status) { this.failPlay('Die Partie ist remis – der Bauer kommt nicht mehr durch.'); return; }
        if (this.userMoves >= st.max) { this.failPlay(`${st.max} Züge sind um. Der König muss dem Bauern den Weg bahnen!`); return; }
        this.engineReply();
        break;
      case 'playmate':
        this.userMoves++;
        if (status === 'checkmate') { this.success(`Schachmatt in ${this.userMoves} Zügen! 🏆`); return; }
        if (status) { this.failPlay(status === 'stalemate' ? 'Patt! Schwarz hat keinen Zug mehr, steht aber nicht im Schach – Remis.' : 'Die Partie ist remis.'); return; }
        if (this.userMoves >= st.max) { this.failPlay(`${st.max} Züge sind um. Drücke den König schneller an den Rand!`); return; }
        this.engineReply();
        break;
    }
  },

  // Nach der Umwandlung prüfen, ob die neue Dame auch überlebt
  async checkPromotion() {
    this.locked = true;
    this.draw(true); this.renderBar();
    const tok = this.token;
    const r = await engine.request({ cmd: 'search', fen: this.startFen, moves: this.history, timeMs: 600 });
    if (tok !== this.token) return;
    if (!r || -r.score > 400) this.success('Umgewandelt – eine neue Dame! 👑');
    else this.failPlay('Umgewandelt – aber die neue Dame geht sofort verloren. Sichere die Umwandlung vorher ab!');
  },

  failPlay(text) {
    this.mistakes++;
    this.fb = { ok: false, title: 'Nicht geschafft.', text, retry: true };
    Sound.play('bad');
    this.locked = true;
    this.draw(true); this.renderBar();
  },

  async engineReply() {
    this.locked = true;
    this.draw(true); this.renderBar();
    const tok = this.token, t0 = Date.now();
    const r = await engine.request({ cmd: 'search', fen: this.startFen, moves: this.history, timeMs: 350 });
    const wait = 500 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (tok !== this.token || !r || !r.move) return;
    const m = this.pos.fromUci(r.move);
    const cap = !!(C.mFlags(m) & C.F_CAP), san = this.pos.toSan(m);
    this.lastMove = [C.mFrom(m), C.mTo(m)];
    this.pos.make(m);
    this.history.push(r.move);
    Sound.forMove({ capture: cap, san }, this.pos);
    const st = this.pos.status(), t = this.step.t;
    if (t === 'hold') {
      if (r.move.length === 5) { this.failPlay('Der Bauer ist durchgekommen. Bleib mit dem König vor dem Bauern und halte die Opposition!'); return; }
      if (st === 'checkmate') { this.failPlay('Schachmatt – leider verloren.'); return; }
      if (st) { this.success('Remis! Du hast die Stellung gehalten. 🛡️'); return; }
    } else if (st) { this.failPlay(st === 'insufficient' ? (t === 'promote' ? 'Der Bauer wurde geschlagen – jetzt ist es remis.' : 'Deine Figur wurde geschlagen – jetzt kann niemand mehr gewinnen.') : 'Die Partie ist remis.'); return; }
    this.locked = false;
    this.draw(true); this.renderBar();
  },

  next() {
    if (this.lesson.kind === 'jump' && this.mistakes > 1) { this.finishJump(false); return; }
    if (this.idx + 1 < this.lesson.steps.length) { this.idx++; this.startStep(); return; }
    if (this.lesson.kind === 'jump') { this.finishJump(true); return; }
    this.finish();
  },

  finishJump(ok) {
    const ui = this.jumpUi;
    if (ok) { this.markUnitsDone(ui); markActivity(); }
    Sound.play(ok ? 'end' : 'bad');
    showModal(`<div style="font-size:54px">${ok ? '⏩' : '💪'}</div><h2>${ok ? 'Sprung geschafft!' : 'Noch nicht ganz'}</h2>
      <p class="muted">${ok ? `Kapitel ${ui + 1} „${LESSONS[ui].title}“ ist freigeschaltet.` : 'Zu viele Fehler – arbeite dich lieber Schritt für Schritt dorthin vor. Du schaffst das!'}</p>
      <button class="btn primary full" data-act="ok">Zum Lernpfad</button>`, { ok: () => { hideModal(); this.exit(); } });
  },

  finish() {
    const stars = this.mistakes === 0 ? 3 : this.mistakes <= 2 ? 2 : 1;
    if (this.lesson.kind === 'endgame') {
      const eg = this.st.endgames = this.st.endgames || {}, id = this.lesson.id, moves = this.userMoves;
      const prev = eg[id], record = !prev || !prev.best || moves < prev.best;
      eg[id] = { best: prev && prev.best ? Math.min(prev.best, moves) : moves };
      this.st.xp += 15; this.save(); markActivity(); Sound.play('end');
      showModal(`<div style="font-size:54px">${this.lesson.icon}</div><h2>Endspiel gemeistert!</h2>
        <p class="muted">${this.lesson.title} in <b>${moves}</b> Zügen${record && prev ? ' – neuer Bestwert!' : ''}</p><div class="xp-gain">+15 XP</div>
        <button class="btn primary full" data-act="again">Nochmal</button><button class="btn full" data-act="list">Zum Endspiel-Trainer</button>`, {
        again: () => { hideModal(); this.startEndgame(id); },
        list: () => { hideModal(); this.token++; engine.cancel(); this.lesson = null; this.setMode('path'); this.renderEndgames(); }
      });
      return;
    }
    if (this.lesson.kind === 'mix') {
      const xp = 5 + stars * 5;
      this.st.xp += xp; this.save(); markActivity(); Sound.play('end');
      showModal(`<div class="finish-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}" style="animation-delay:${i * .15}s">★</span>`).join('')}</div>
        <h2>Übungs-Mix geschafft!</h2><p class="muted">${this.mistakes === 0 ? 'fehlerfrei 🎯' : this.mistakes + ' Fehler'} · Wiederholung festigt das Wissen.</p>
        <div class="xp-gain">+${xp} XP</div>
        <button class="btn primary full" data-act="again">Noch ein Mix</button>
        <button class="btn full" data-act="path">Zum Lernpfad</button>`, { again: () => { hideModal(); this.startMix(); }, path: () => { hideModal(); this.exit(); } });
      return;
    }
    const first = !this.st.done[this.lesson.id];
    const xp = (first ? 10 : 5) + stars * 5;
    this.st.done[this.lesson.id] = Math.max(stars, this.st.done[this.lesson.id] || 0);
    this.st.xp += xp;
    this.save();
    markActivity();
    Sound.play('end');
    const unitDone = ALL_LESSONS.filter(x => x.unit === this.unit).every(x => this.st.done[x.lesson.id] != null);
    const nextK = this.k + 1 < ALL_LESSONS.length ? this.k + 1 : null;
    showModal(`<div class="finish-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}" style="animation-delay:${i * .15}s">★</span>`).join('')}</div>
      <h2>${unitDone && first ? 'Kapitel geschafft! 🏆' : this.lesson.review ? 'Wiederholung geschafft!' : 'Lektion geschafft!'}</h2>
      <p class="muted">${this.lesson.title} · ${this.mistakes === 0 ? 'fehlerfrei 🎯' : this.mistakes + (this.mistakes === 1 ? ' Fehler' : ' Fehler')}</p>
      <div class="xp-gain">+${xp} XP</div>
      ${nextK != null ? `<button class="btn primary full" data-act="cont">Nächste Lektion: ${ALL_LESSONS[nextK].lesson.title}</button>` : ''}
      <button class="btn full" data-act="path">Zum Lernpfad</button>`, {
      cont: () => { hideModal(); this.start(nextK); },
      path: () => { hideModal(); this.exit(); }
    });
  }
};

// ---------- Modus: Eröffnungen ----------
const OPEN_LINES = OPENINGS.flatMap(o => o.lines.map(l => ({ o, l })));
const DAY = 86400000;
const INTERVALS = [1, 3, 7, 14, 30];

const Openings = {
  st: Object.assign({ lines: {}, group: 'all', color: 'all' }, store.get('openings', {})),
  view: 'list', op: null, line: null, game: null, ply: 0, queue: null, token: 0,

  save() { store.set('openings', this.st); },
  lineStat(id) { return this.st.lines[id] || { reps: 0, streak: 0, due: 0 }; },
  isLearned(id) { return this.lineStat(id).streak >= 2; },
  dueLines() { const now = Date.now(); return OPEN_LINES.filter(x => { const s = this.st.lines[x.l.id]; return s && s.reps > 0 && s.due <= now; }); },
  recommendedGroup() {
    const r = Puzzles.st.rating;
    return OPENING_GROUPS.find(g => r >= g.min && r < g.max) || OPENING_GROUPS[0];
  },

  activate() {
    document.body.classList.toggle('openings-mode', this.view === 'list');
    resize();
    if (this.view === 'list') this.renderList();
    else { board.setFlipped(this.op.side === 'b'); this.refresh(); this.renderPanel(); }
  },
  showList() {
    this.token++; this.view = 'list'; this.queue = null;
    this.activate();
  },

  // ----- Übersicht -----
  renderList() {
    const due = this.dueLines().length, rec = this.recommendedGroup();
    const learnedTotal = OPEN_LINES.filter(x => this.isLearned(x.l.id)).length;
    let html = `<div class="learn-head"><div><h1>Eröffnungen</h1><p class="muted">Lerne Repertoire-Linien Zug für Zug – mit Wiederholungen in wachsenden Abständen.</p></div>
      <div class="chips"><span class="chip">📚 ${learnedTotal}/${OPEN_LINES.length} Linien gelernt</span></div></div>
      ${due ? `<button class="due-banner" data-act="due"><span>🔁</span><div><b>${due} ${due === 1 ? 'Linie ist' : 'Linien sind'} zur Wiederholung fällig</b><div class="muted small">Kurz durchspielen, damit sie im Kopf bleiben</div></div><span>›</span></button>` : ''}
      <div class="op-filters">
        <div class="seg">${[['all', 'Alle'], ...OPENING_GROUPS.map(g => [g.id, g.icon + ' ' + g.name])].map(([v, l]) => `<button class="${this.st.group === v ? 'active' : ''}" data-act="group" data-arg="${v}">${l}</button>`).join('')}</div>
        <div class="seg">${[['all', 'Beide Farben'], ['w', '♔ Als Weiß'], ['b', '♚ Als Schwarz']].map(([v, l]) => `<button class="${this.st.color === v ? 'active' : ''}" data-act="color" data-arg="${v}">${l}</button>`).join('')}</div>
      </div>`;
    for (const g of OPENING_GROUPS) {
      if (this.st.group !== 'all' && this.st.group !== g.id) continue;
      const ops = OPENINGS.filter(o => o.group === g.id && (this.st.color === 'all' || o.side === this.st.color));
      if (!ops.length) continue;
      html += `<div class="op-group"><div class="og-head"><span class="og-ic">${g.icon}</span><div><b>${g.name}</b> <span class="muted">· ${g.range}</span>${g.id === rec.id ? ' <span class="pill rec">⭐ Empfohlen für dich</span>' : ''}<div class="muted small">${g.why}</div></div></div>
        <div class="op-grid">${ops.map(o => {
          const learned = o.lines.filter(l => this.isLearned(l.id)).length;
          const started = o.lines.filter(l => this.lineStat(l.id).reps > 0).length;
          return `<button class="op-card" data-act="open" data-arg="${o.id}">
            <div class="row"><span class="op-side ${o.side}">${o.side === 'w' ? '♔ Weiß' : '♚ Schwarz'}</span><span class="muted small">${o.eco}</span></div>
            <b>${o.name}</b><div class="muted small op-why">${o.why}</div>
            <div class="op-prog"><div style="width:${learned / o.lines.length * 100}%"></div></div>
            <div class="muted small">${learned}/${o.lines.length} gelernt${started > learned ? ` · ${started - learned} in Arbeit` : ''}</div></button>`;
        }).join('')}</div></div>`;
    }
    html += `<p class="muted small" style="margin-top:20px">Die Elo-Einordnung ist eine Trainer-Empfehlung: Sie richtet sich danach, wie viel Theorie eine Eröffnung braucht und wie klar ihre Pläne sind – keine Gewinnstatistik.</p>`;
    $('openings').innerHTML = html;
    bind($('openings'), {
      group: v => { this.st.group = v; this.save(); this.renderList(); },
      color: v => { this.st.color = v; this.save(); this.renderList(); },
      open: id => this.openOpening(id),
      due: () => this.startQueue(this.dueLines())
    });
  },

  openOpening(id) {
    this.op = OPENINGS.find(o => o.id === id);
    this.view = 'detail'; this.line = null; this.queue = null;
    this.game = new Game();
    this.activate();
  },

  // Linie in Züge (UCI + Kommentar) übersetzen
  prepLine(l) {
    if (l._moves) return l._moves;
    const p = new C.Position(), out = [];
    for (const x of parseOpeningLine(l.moves)) {
      const m = p.fromSan(x.san);
      if (!m) break;
      out.push({ uci: p.toUci(m), comment: x.comment });
      p.make(m);
    }
    l._moves = out;
    return out;
  },
  mySide() { return this.op.side === 'w' ? 0 : 1; },

  // ----- Ansehen -----
  watch(lineId) {
    this.line = this.op.lines.find(l => l.id === lineId);
    const mv = this.prepLine(this.line);
    this.game = new Game();
    for (const x of mv) this.game.play(x.uci);
    this.view = 'watch'; this.ply = 0;
    this.activate();
  },
  go(ply) { this.ply = Math.max(0, Math.min(this.game.moves.length, ply)); this.refresh(); this.renderPanel(); },

  // ----- Üben -----
  drill(lineId) {
    this.line = this.op.lines.find(l => l.id === lineId);
    this.prepLine(this.line);
    this.token++;
    this.game = new Game();
    this.view = 'drill'; this.mistakes = 0; this.wrongTries = 0; this.fb = null; this.done = false; this.hintArrow = null; this.locked = false;
    this.activate();
    if (this.mySide() === 1) this.autoReply();
  },
  startQueue(list) {
    if (!list.length) return;
    this.queue = shuffle(list.map(x => ({ op: x.o.id, line: x.l.id })));
    this.nextInQueue();
  },
  nextInQueue() {
    const q = this.queue.shift();
    if (!q) { this.showList(); return; }
    this.op = OPENINGS.find(o => o.id === q.op);
    this.drill(q.line);
  },
  expected() { return this.line._moves[this.game.moves.length]; },

  onUserMove(uci) {
    if (this.view !== 'drill' || this.done || this.locked) return;
    const exp = this.expected();
    if (!exp) return;
    if (uci === exp.uci) {
      const rec = this.game.play(uci);
      Sound.forMove(rec, this.game.pos);
      this.wrongTries = 0; this.hintArrow = null;
      this.fb = { ok: true, text: exp.comment || 'Richtig!' };
      if (this.game.moves.length >= this.line._moves.length) { this.complete(); return; }
      this.refresh(true); this.renderPanel();
      this.autoReply();
    } else {
      this.mistakes++; this.wrongTries++;
      Sound.play('bad');
      const san = de(this.game.pos.toSan(this.game.pos.fromUci(uci)));
      this.fb = { ok: false, text: `${san} gehört nicht zu dieser Linie.${this.wrongTries >= 2 ? ' Der Pfeil zeigt dir den Repertoire-Zug.' : ' Versuch es nochmal!'}` };
      if (this.wrongTries >= 2) this.hintArrow = exp.uci;
      this.refresh(); this.renderPanel();
    }
  },
  async autoReply() {
    const exp = this.expected();
    if (!exp) return;
    this.locked = true;
    this.refresh(); this.renderPanel();
    const tok = this.token;
    await sleep(550);
    if (tok !== this.token) return;
    const rec = this.game.play(exp.uci);
    Sound.forMove(rec, this.game.pos);
    this.locked = false;
    if (exp.comment && (!this.fb || this.fb.ok)) this.fb = { ok: true, text: exp.comment };
    if (this.game.moves.length >= this.line._moves.length) { this.complete(); return; }
    this.refresh(true); this.renderPanel();
  },
  hint() {
    const exp = this.expected();
    if (!exp || this.done) return;
    this.mistakes++;
    this.hintArrow = exp.uci;
    this.refresh(); this.renderPanel();
  },
  complete() {
    this.done = true;
    const s = Object.assign({ reps: 0, streak: 0, due: 0 }, this.st.lines[this.line.id]);
    s.reps++;
    if (this.mistakes === 0) { s.streak++; s.due = Date.now() + INTERVALS[Math.min(s.streak - 1, INTERVALS.length - 1)] * DAY; }
    else { s.streak = 0; s.due = Date.now() + DAY / 2; }
    s.last = Date.now();
    this.st.lines[this.line.id] = s;
    this.save();
    markActivity();
    Sound.play(this.mistakes === 0 ? 'good' : 'move');
    this.refresh(true); this.renderPanel();
  },

  refresh(animate) {
    if (mode !== 'openings' || this.view === 'list') return;
    const g = this.game;
    const ply = this.view === 'watch' ? this.ply : g.moves.length;
    const pos = this.view === 'watch' ? g.positionAt(ply) : g.pos;
    const lm = g.moves[ply - 1];
    const arrows = [];
    if (this.view === 'watch' && g.moves[ply]) arrows.push({ from: g.moves[ply].from, to: g.moves[ply].to, color: 'rgba(124,196,127,.8)' });
    if (this.view === 'drill' && this.hintArrow) arrows.push({ from: C.parseSq(this.hintArrow.slice(0, 2)), to: C.parseSq(this.hintArrow.slice(2, 4)), color: 'rgba(80,160,255,.85)' });
    board.movable = this.view === 'drill' && !this.done && !this.locked && g.pos.side === this.mySide() ? this.mySide() : -1;
    board.set(pos, { last: lm ? [lm.from, lm.to] : null, arrows, animate: animate && lm ? [lm.from, lm.to] : null });
    EvalBar.show(false);
    setStrip('top', null); setStrip('bottom', null);
    renderBoardNav();
  },

  renderPanel() {
    const p = $('panel-openings'), o = this.op;
    if (!o) return;
    const g = OPENING_GROUPS.find(x => x.id === o.group);
    const head = `<div class="panel-head"><button class="btn small" data-act="back">←</button><div><h2>${o.name}</h2><div class="muted">${o.side === 'w' ? '♔ als Weiß' : '♚ als Schwarz'} · ${o.eco} · ${g.icon} ${g.range}</div></div></div>`;
    let html = head;
    if (this.view === 'detail') {
      html += `<div class="status-box"><b>Warum diese Eröffnung?</b><div class="small" style="margin-top:4px">${o.why}</div></div>
        <div class="status-box"><b>Die Idee</b><div class="small" style="margin-top:4px">${o.idea}</div></div>
        <h3>Linien</h3>${o.lines.map(l => {
          const s = this.lineStat(l.id), now = Date.now();
          const badge = s.reps === 0 ? '<span class="pill">Neu</span>' : s.due <= now ? '<span class="pill due">🔁 fällig</span>' : this.isLearned(l.id) ? '<span class="pill ok">✓ gelernt</span>' : `<span class="pill">${'★'.repeat(Math.min(s.streak, 3))}${'☆'.repeat(Math.max(0, 2 - s.streak))} lernen</span>`;
          return `<div class="line-item"><div><b>${l.name}</b> ${badge}<div class="muted small">${this.prepLine(l).length} Halbzüge${s.due > now && s.reps ? ' · wieder fällig in ' + Math.max(1, Math.round((s.due - now) / DAY)) + ' T.' : ''}</div></div>
            <div class="li-btns"><button class="btn small" data-act="watch" data-arg="${l.id}">▶ Ansehen</button><button class="btn small primary-s" data-act="drill" data-arg="${l.id}">🎯 Üben</button></div></div>`;
        }).join('')}
        <div style="height:8px"></div><button class="btn primary full" data-act="all">🎯 Alle Linien üben</button>`;
    } else if (this.view === 'watch') {
      const mv = this.line._moves, c = this.ply > 0 ? mv[this.ply - 1].comment : '';
      html += `<h3>${this.line.name}</h3>
        <div class="explain">${this.ply === 0 ? 'Startstellung – blättere mit ▶ durch die Züge. Der grüne Pfeil zeigt den nächsten Zug.' : `<b>${de(this.game.moves[this.ply - 1].san)}</b>${c ? ' – ' + esc(c) : ''}`}</div>
        <div class="movelist" id="opMoves"></div>
        <button class="btn primary full" data-act="drill" data-arg="${this.line.id}">🎯 Jetzt üben</button>`;
    } else {
      const total = this.line._moves.length, mine = this.line._moves.filter((x, i) => (i % 2) === this.mySide()).length;
      const doneMine = this.game.moves.filter(m => m.side === this.mySide()).length;
      html += `<h3>${this.queue ? '🔁 Wiederholung · ' : ''}${this.line.name}</h3>
        <div class="progress"><div style="width:${this.game.moves.length / total * 100}%"></div></div>
        <div class="muted small">Dein Zug ${Math.min(doneMine + (this.done ? 0 : 1), mine)} von ${mine}</div>
        ${this.done ? `<div class="status-box ${this.mistakes === 0 ? 'good' : ''}"><b>${this.mistakes === 0 ? '🎉 Perfekt gespielt!' : '✓ Linie geschafft'}</b><div class="small">${this.mistakes === 0 ? 'Nächste Wiederholung in ' + INTERVALS[Math.min(this.lineStat(this.line.id).streak - 1, INTERVALS.length - 1)] + ' Tag(en).' : this.mistakes + ' Fehler – die Linie kommt bald nochmal dran.'}</div></div>`
        : `<div class="status-box ${this.fb ? (this.fb.ok ? 'good' : 'bad') : ''}">${this.fb ? esc(this.fb.text) : (this.locked ? 'Gegner zieht …' : `Spiele den Repertoire-Zug für ${this.mySide() === 0 ? 'Weiß' : 'Schwarz'}!`)}</div>`}
        <div class="movelist" id="opMoves"></div>
        ${this.done ? (this.queue && this.queue.length ? `<button class="btn primary full" data-act="nextq">Weiter (${this.queue.length} übrig)</button>` : `<button class="btn primary full" data-act="drill" data-arg="${this.line.id}">↻ Nochmal üben</button>`)
        : `<div class="btn-row"><button class="btn" data-act="hint">💡 Tipp</button><button class="btn" data-act="drill" data-arg="${this.line.id}">↻ Neu starten</button></div>`}
        <div style="height:6px"></div><button class="btn full" data-act="${this.queue ? 'list' : 'detail'}">${this.queue ? 'Wiederholung beenden' : 'Zur Eröffnung'}</button>`;
    }
    p.innerHTML = html;
    bind(p, {
      back: () => this.view === 'detail' || this.queue ? this.showList() : (this.view = 'detail', this.activate()),
      watch: id => this.watch(id), drill: id => this.drill(id),
      all: () => this.startQueue(o.lines.map(l => ({ o, l }))),
      hint: () => this.hint(), nextq: () => this.nextInQueue(),
      detail: () => { this.token++; this.view = 'detail'; this.activate(); }, list: () => this.showList()
    });
    const box = $('opMoves');
    if (box) {
      box.innerHTML = moveListHtml(this.game, this.view === 'watch' ? this.ply : this.game.moves.length, null);
      if (this.view === 'watch') box.querySelectorAll('[data-ply]').forEach(e => e.onclick = () => this.go(+e.dataset.ply));
      scrollListTo(box, box.querySelector('.cur'));
    }
  }
};

// ---------- Freies Analysebrett ----------
const Free = {
  game: new Game(), ply: 0, engineOn: store.get('freeEngine', true), lines: [], token: 0, multi: 3,

  open(fen, moves, ply) {
    this.game = Game.fromUci(fen || C.START_FEN, moves || []);
    this.ply = ply != null ? Math.min(ply, this.game.moves.length) : this.game.moves.length;
    switchTab('free');
  },
  activate() { this.refresh(); this.renderPanel(); this.analyse(); },
  pos() { return this.game.positionAt(this.ply); },

  onUserMove(uci) {
    // Zug aus einer früheren Stellung: ab hier neue Variante
    if (this.ply < this.game.moves.length) this.game = Game.fromUci(this.game.startFen, this.game.uci().slice(0, this.ply));
    const rec = this.game.play(uci);
    if (!rec) return;
    Sound.forMove(rec, this.game.pos);
    this.ply = this.game.moves.length;
    this.lines = [];
    this.refresh(true); this.renderPanel(); this.analyse();
  },
  go(p) {
    this.ply = Math.max(0, Math.min(this.game.moves.length, p));
    this.lines = [];
    this.refresh(); this.renderPanel(); this.analyse();
  },

  async analyse() {
    const tok = ++this.token;
    this.lines = [];
    freeEngine = freeEngine || new EngineClient();
    if (this.busy) freeEngine.cancel();
    this.busy = false;
    const pos = this.pos(), st = pos.status();
    this.status = st;
    if (!this.engineOn) { this.renderLines(); return; }
    if (st) { EvalBar.set(st === 'checkmate' ? (pos.side ? C.MATE : -C.MATE) : 0); this.renderLines(); return; }
    const moves = this.game.uci().slice(0, this.ply), exclude = [];
    const n = Math.min(this.multi, pos.legalMoves().length);
    this.renderLines();
    this.busy = true;
    for (let i = 0; i < n; i++) {
      const r = await freeEngine.request({ cmd: 'search', fen: this.game.startFen, moves, timeMs: i === 0 ? 900 : 500, exclude: exclude.slice() });
      if (tok !== this.token) return;
      if (!r || !r.move) { this.busy = false; return; }
      exclude.push(r.move);
      this.lines.push({ move: r.move, score: pos.side === 0 ? r.score : -r.score, pv: r.pv, depth: r.depth });
      if (i === 0) EvalBar.set(this.lines[0].score);
      this.refresh(); this.renderLines();
    }
    this.busy = false;
  },

  refresh(animate) {
    if (mode !== 'free') return;
    const pos = this.pos(), lm = this.game.moves[this.ply - 1];
    board.movable = pos.status() ? -1 : pos.side;
    const colors = ['rgba(124,196,127,.9)', 'rgba(80,160,255,.65)', 'rgba(80,160,255,.4)'];
    const arrows = this.engineOn ? this.lines.map((l, i) => ({ from: C.parseSq(l.move.slice(0, 2)), to: C.parseSq(l.move.slice(2, 4)), color: colors[i] })).reverse() : [];
    board.set(pos, { last: lm ? [lm.from, lm.to] : null, arrows, animate: animate && lm ? [lm.from, lm.to] : null });
    EvalBar.show(this.engineOn);
    setStrip('top', null); setStrip('bottom', null);
    renderBoardNav();
  },

  sanLine(pv, n) {
    const p = this.pos(), out = [];
    let num = p.full, first = true;
    for (const u of (pv || []).slice(0, n)) {
      const m = p.fromUci(u);
      if (!m) break;
      const san = de(p.toSan(m));
      out.push(p.side === 0 ? `${num}. ${san}` : first ? `${num}… ${san}` : san);
      if (p.side === 1) num++;
      p.make(m);
      first = false;
    }
    return out.join(' ');
  },

  renderLines() {
    const box = $('freeLines');
    if (!box) return;
    if (!this.engineOn) { box.innerHTML = '<div class="muted small">Engine ist aus.</div>'; return; }
    if (this.status) { box.innerHTML = `<div class="status-box"><b>${STATUS_TEXT[this.status]}</b></div>`; return; }
    if (!this.lines.length) { box.innerHTML = '<div class="muted small">Engine rechnet …</div>'; return; }
    box.innerHTML = this.lines.map((l, i) => `<button class="eng-line" data-i="${i}"><span class="eng-ev ${l.score >= 0 ? 'w' : 'b'}">${fmtEval(l.score)}</span><span class="eng-pv">${this.sanLine(l.pv, 8)}</span></button>`).join('')
      + `<div class="muted small">Tiefe ${this.lines[0].depth} · Tippe eine Zeile, um ihren ersten Zug zu spielen.</div>`;
    box.querySelectorAll('.eng-line').forEach(b => b.onclick = () => this.onUserMove(this.lines[+b.dataset.i].move));
  },

  renderPanel() {
    const p = $('panel-free');
    const pos = this.pos();
    p.innerHTML = `<div class="panel-head"><div class="big-ic">🔍</div><div><h2>Analysebrett</h2><div class="muted">Beide Seiten ziehen frei · ${pos.side === 0 ? 'Weiß' : 'Schwarz'} am Zug</div></div></div>
      <div class="row"><label class="chk"><input type="checkbox" id="freeEng" ${this.engineOn ? 'checked' : ''}> Engine-Vorschläge (3 beste Züge)</label></div>
      <div id="freeLines" class="eng-lines"></div>
      <div class="movelist" id="freeMoves"></div>
      <div class="btn-row">
        <button class="btn small" data-act="flip">⇅ Drehen</button>
        <button class="btn small" data-act="reset">↺ Startstellung</button>
        <button class="btn small" data-act="edit">✏️ Bearbeiten</button>
      </div>
      <button class="btn primary full" data-act="play">♟ Ab hier gegen den Bot spielen</button>
      <div class="btn-row"><button class="btn small" data-act="fen">📋 FEN</button><button class="btn small" data-act="pgn">📋 PGN</button></div>
      <h3>Stellung oder Partie laden</h3>
      <textarea id="freeIn" placeholder="FEN (z. B. r1bqkbnr/pppp1ppp/2n5/…) oder PGN einfügen"></textarea>
      <div style="height:6px"></div><button class="btn full" data-act="load">Laden</button>`;
    bind(p, {
      flip: () => { board.setFlipped(!board.flipped); this.refresh(); },
      reset: () => { this.game = new Game(); this.ply = 0; this.activate(); },
      edit: () => Editor.open(pos.fen()),
      play: () => openPlayFrom(pos.fen(), pos.side),
      fen: () => copyText(pos.fen(), 'FEN'),
      pgn: () => copyText(this.game.pgn({ white: '?', black: '?', result: '*' })),
      load: () => {
        const t = $('freeIn').value.trim();
        if (!t) return;
        try {
          if (/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}\s+[wb]/.test(t)) {
            const err = validateFen(t);
            if (err) throw new Error(err);
            this.game = new Game(t); this.ply = 0;
          } else {
            const { game } = parsePgn(t);
            this.game = game; this.ply = game.moves.length;
          }
          this.activate();
        } catch (e) { alert(e.message); }
      }
    });
    $('freeEng').onchange = e => { this.engineOn = e.target.checked; store.set('freeEngine', this.engineOn); this.refresh(); this.analyse(); };
    const box = $('freeMoves');
    box.innerHTML = moveListHtml(this.game, this.ply, null);
    box.querySelectorAll('[data-ply]').forEach(e => e.onclick = () => this.go(+e.dataset.ply));
    scrollListTo(box, box.querySelector('.cur'));
    this.renderLines();
  }
};

// Prüft eine FEN auf Spielbarkeit; gibt eine Fehlermeldung oder null zurück
function validateFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  if (rows.length !== 8) return 'Die Stellung braucht genau 8 Reihen.';
  const count = c => (parts[0].match(new RegExp(c, 'g')) || []).length;
  if (count('K') !== 1 || count('k') !== 1) return 'Jede Seite braucht genau einen König.';
  if (/[pP]/.test(rows[0]) || /[pP]/.test(rows[7])) return 'Bauern dürfen nicht auf der ersten oder letzten Reihe stehen.';
  if (count('[PNBRQK]') > 16 || count('[pnbrqk]') > 16) return 'Zu viele Figuren für eine Seite (höchstens 16).';
  let p;
  try { p = new C.Position(fen); } catch (e) { return 'Ungültige Stellung.'; }
  if (p.attacked(p.kingSq[p.side ^ 1], p.side)) return 'Die Seite, die nicht am Zug ist, steht im Schach – so eine Stellung ist unmöglich.';
  return null;
}

// Partie ab einer Stellung starten – Farbe abfragen
function openPlayFrom(fen, side) {
  const err = validateFen(fen);
  if (err) { alert(err); return; }
  const p = new C.Position(fen);
  if (p.status() === 'checkmate' || p.status() === 'stalemate') { alert('In dieser Stellung ist die Partie schon vorbei.'); return; }
  const b = Play.bot.persona || Play.bot.human || Play.placement ? BOTS[3] : Play.bot;
  showModal(`<h2>♟ Ab hier spielen</h2><p class="muted">${p.side === 0 ? 'Weiß' : 'Schwarz'} ist am Zug. Gegen ${b.emoji} ${b.name} (ca. ${b.elo}) – den Gegner kannst du danach unter „Neues Spiel“ ändern.</p>
    <button class="btn primary full" data-act="w">♔ Ich spiele Weiß</button><button class="btn primary full" data-act="b">♚ Ich spiele Schwarz</button>
    <button class="btn full" data-act="c">Abbrechen</button>`, {
    w: () => { hideModal(); Play.botIdx = BOTS.indexOf(b); Play.startFrom(fen, 0); },
    b: () => { hideModal(); Play.botIdx = BOTS.indexOf(b); Play.startFrom(fen, 1); },
    c: hideModal
  });
}

// ---------- Stellungs-Editor ----------
const Editor = {
  cells: Array(64).fill(''), side: 'w', castle: { K: true, Q: true, k: true, q: true }, tool: 'P',

  open(fen) { this.loadFen(fen || C.START_FEN); switchTab('editor'); },
  loadFen(fen) {
    const parts = fen.trim().split(/\s+/);
    this.cells = Array(64).fill('');
    let r = 7, f = 0;
    for (const ch of parts[0]) {
      if (ch === '/') { r--; f = 0; continue; }
      if (/\d/.test(ch)) { f += +ch; continue; }
      if (r >= 0 && f < 8) this.cells[r * 8 + f] = ch;
      f++;
    }
    this.side = parts[1] === 'b' ? 'b' : 'w';
    const cs = parts[2] || '-';
    this.castle = { K: cs.includes('K'), Q: cs.includes('Q'), k: cs.includes('k'), q: cs.includes('q') };
  },
  placement() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', e = 0;
      for (let f = 0; f < 8; f++) { const c = this.cells[r * 8 + f]; if (!c) { e++; continue; } if (e) { row += e; e = 0; } row += c; }
      rows.push(row + (e || ''));
    }
    return rows.join('/');
  },
  fen() {
    const c = this.cells, cs = this.castle;
    let castle = '';
    if (cs.K && c[4] === 'K' && c[7] === 'R') castle += 'K';
    if (cs.Q && c[4] === 'K' && c[0] === 'R') castle += 'Q';
    if (cs.k && c[60] === 'k' && c[63] === 'r') castle += 'k';
    if (cs.q && c[60] === 'k' && c[56] === 'r') castle += 'q';
    return `${this.placement()} ${this.side} ${castle || '-'} - 0 1`;
  },
  activate() {
    board.editHandler = sq => this.click(sq);
    EvalBar.show(false);
    this.refresh(); this.renderPanel();
  },
  click(sq) {
    const i = (sq >> 4) * 8 + (sq & 7);
    if (this.tool === 'x' || this.cells[i] === this.tool) this.cells[i] = '';
    else {
      if (this.tool === 'K' || this.tool === 'k') this.cells = this.cells.map(c => c === this.tool ? '' : c);
      this.cells[i] = this.tool;
    }
    Sound.play('move');
    this.refresh(); this.renderStatus();
  },
  refresh() {
    if (mode !== 'editor') return;
    let p;
    try { p = new C.Position(this.fen()); } catch (e) { p = new C.Position('8/8/8/8/8/8/8/8 w - - 0 1'); }
    if (!this.cells.includes('K') || !this.cells.includes('k')) p.inCheck = () => false;
    board.movable = -1;
    board.set(p, {});
    setStrip('top', null); setStrip('bottom', null);
    renderBoardNav();
  },
  renderStatus() {
    const el = $('edStatus');
    if (!el) return;
    const err = validateFen(this.fen());
    el.className = 'status-box ' + (err ? 'bad' : 'good');
    el.innerHTML = err ? '⚠️ ' + err : '✓ Gültige Stellung';
    $('edFen').value = this.fen();
    p_disable(['edAna', 'edPlay'], !!err);
  },
  renderPanel() {
    const p = $('panel-editor');
    const codes = 'KQRBNP';
    const pal = c => `<button class="pal ${this.tool === c ? 'active' : ''}" data-act="tool" data-arg="${c}">${pieceHtml(codes.indexOf(c.toUpperCase()) === -1 ? 0 : ((6 - codes.indexOf(c.toUpperCase())) | (c === c.toLowerCase() ? 8 : 0)))}</button>`;
    p.innerHTML = `<div class="panel-head"><div class="big-ic">✏️</div><div><h2>Stellung aufbauen</h2><div class="muted">Figur wählen, dann aufs Feld tippen</div></div></div>
      <div class="palette">${[...'KQRBNP'].map(pal).join('')}${[...'kqrbnp'].map(pal).join('')}<button class="pal eraser ${this.tool === 'x' ? 'active' : ''}" data-act="tool" data-arg="x">🧽</button></div>
      <p class="muted small">Tippe nochmal auf eine gleiche Figur, um sie zu entfernen.</p>
      <h3>Am Zug</h3>
      <div class="seg">${[['w', '♔ Weiß'], ['b', '♚ Schwarz']].map(([v, l]) => `<button class="${this.side === v ? 'active' : ''}" data-act="side" data-arg="${v}">${l}</button>`).join('')}</div>
      <h3>Rochade erlaubt</h3>
      <div class="castle-row">${[['K', 'Weiß kurz'], ['Q', 'Weiß lang'], ['k', 'Schwarz kurz'], ['q', 'Schwarz lang']].map(([k, l]) => `<label class="chk"><input type="checkbox" data-c="${k}" ${this.castle[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="btn-row"><button class="btn small" data-act="start">Startstellung</button><button class="btn small" data-act="clear">Leeren</button><button class="btn small" data-act="flip">⇅ Drehen</button></div>
      <div id="edStatus" class="status-box"></div>
      <button class="btn primary full" id="edAna" data-act="ana">🔍 Analysieren</button>
      <div style="height:6px"></div>
      <button class="btn full" id="edPlay" data-act="play">♟ Gegen den Bot spielen</button>
      <h3>FEN</h3>
      <textarea id="edFen" style="min-height:56px"></textarea>
      <div style="height:6px"></div>
      <div class="btn-row"><button class="btn small" data-act="loadfen">FEN übernehmen</button><button class="btn small" data-act="copy">📋 Kopieren</button></div>`;
    bind(p, {
      tool: c => { this.tool = c; this.renderPanel(); },
      side: v => { this.side = v; this.renderPanel(); this.refresh(); },
      start: () => { this.loadFen(C.START_FEN); this.refresh(); this.renderPanel(); },
      clear: () => { this.cells = Array(64).fill(''); this.cells[4] = 'K'; this.cells[60] = 'k'; this.refresh(); this.renderPanel(); },
      flip: () => { board.setFlipped(!board.flipped); this.refresh(); },
      ana: () => { const f = this.fen(); if (!validateFen(f)) Free.open(f); },
      play: () => { const f = this.fen(); if (!validateFen(f)) openPlayFrom(f); },
      loadfen: () => { const f = $('edFen').value.trim(); const e = validateFen(f); if (e && !/^\S+\s+[wb]/.test(f)) { alert('Ungültige FEN'); return; } try { this.loadFen(f); this.refresh(); this.renderPanel(); } catch (x) { alert('Ungültige FEN'); } },
      copy: () => copyText(this.fen(), 'FEN')
    });
    p.querySelectorAll('[data-c]').forEach(cb => cb.onchange = () => { this.castle[cb.dataset.c] = cb.checked; this.renderStatus(); });
    this.renderStatus();
  }
};
function p_disable(ids, v) { for (const id of ids) { const el = $(id); if (el) el.disabled = v; } }

// ---------- Steuerleiste unter dem Brett ----------
function renderBoardNav() {
  const nav = $('boardNav');
  const ana = mode === 'analysis' && Analysis.game, play = mode === 'play' && Play.game && !Play.setup;
  const op = mode === 'openings' && Openings.view === 'watch';
  const fr = mode === 'free';
  if (!ana && !play && !op && !fr) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  const g = fr ? Free.game : op ? Openings.game : ana ? Analysis.game : Play.game;
  const ply = fr ? Free.ply : op ? Openings.ply : ana ? Analysis.ply : (Play.viewPly == null ? g.moves.length : Play.viewPly);
  const n = g.moves.length;
  let info = '<span class="muted">Startstellung</span>';
  if (ply > 0) {
    const m = g.moves[ply - 1];
    const num = new C.Position(g.startFen).full + Math.floor((ply - 1 + g.moves[0].side) / 2);
    const c = op || fr ? null : ana ? Analysis.cls[ply - 1] : (Play.showLive && Play.live.cls[ply - 1]);
    const dot = c ? `<span class="cls-dot" style="background:${CLS[c].color}">${CLS[c].sym}</span>` : '';
    info = `${dot}<b>${num}${m.side === 0 ? '.' : '…'} ${de(m.san)}</b>${c ? `<span class="muted nav-cls">${CLS[c].name}</span>` : ''}`;
  }
  if (play && Play.viewPly != null) info += ' <span class="pill">Rückblick</span>';
  nav.innerHTML = `<button class="btn" data-act="first" ${ply === 0 ? 'disabled' : ''} title="Anfang">⏮</button>
    <button class="btn" data-act="prev" ${ply === 0 ? 'disabled' : ''} title="Zurück (←)">◀</button>
    <div class="nav-info">${info}<span class="muted small">${ply}/${n}</span></div>
    <button class="btn" data-act="next" ${ply >= n ? 'disabled' : ''} title="Vor (→)">▶</button>
    <button class="btn" data-act="last" ${ply >= n ? 'disabled' : ''} title="Ende">⏭</button>`;
  const go = fr ? p => Free.go(p) : op ? p => Openings.go(p) : ana ? p => Analysis.go(p) : p => Play.view(p);
  bind(nav, { first: () => go(0), prev: () => go(ply - 1), next: () => go(ply + 1), last: () => go(1e9) });
}

// ---------- Übersicht ----------
function sparkline(vals, color) {
  if (!vals || vals.length < 2) return '';
  const W = 200, H = 44, min = Math.min(...vals) - 10, max = Math.max(...vals) + 10;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * W).toFixed(1)},${(H - (v - min) / (max - min) * H).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="${color}" opacity=".15"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

const Home = {
  activate() { this.render(); },
  render() {
    const games = store.get('games', []), ps = Puzzles.st;
    const vsBot = games.filter(g => g.userColor != null);
    let w = 0, d = 0, l = 0;
    for (const g of vsBot) {
      if (g.result === '1/2-1/2') d++;
      else if ((g.result === '1-0') === (g.userColor === 0)) w++; else l++;
    }
    const tot = Math.max(1, w + d + l);
    const accs = games.filter(g => g.acc != null).slice(0, 10).map(g => g.acc);
    const avgAcc = accs.length ? (accs.reduce((a, b) => a + b, 0) / accs.length).toFixed(1) : '–';
    const beaten = beatenBots();
    const nextBot = BOTS.findIndex((b, i) => b.ladder && !beaten.has(i));
    const cur = Play.game && !Play.over && Play.game.moves.length;
    const last = games[0];
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
    $('home').innerHTML = `
      <div class="hero"><div class="hero-btns"><button data-act="pieces">🎨</button><button class="hero-sound" data-act="sound">${Sound.on ? '🔊' : '🔇'}</button></div><h1>${greet}! ♞</h1><p>Spiele gegen Bots, löse Rätsel und lerne aus deinen Fehlern – komplett offline.</p></div>
      <div class="actions">
        ${cur ? `<button class="action main" data-act="resume"><div class="ai">▶</div><div><b>Partie fortsetzen</b><span>gegen ${Play.bot.name} · Zug ${Math.ceil(Play.game.moves.length / 2)}</span></div></button>`
        : `<button class="action main" data-act="play"><div class="ai">${BOTS[Play.botIdx].emoji}</div><div><b>Spielen</b><span>gegen ${BOTS[Play.botIdx].name} (ca. ${BOTS[Play.botIdx].elo})</span></div></button>`}
        ${(() => { const nk = Learn.nextIndex(); return `<button class="action" data-act="learn"><div class="ai">🎓</div><div><b>Lernpfad</b><span>${nk == null ? 'Alles geschafft! Übe mit dem Mix' : 'Weiter mit: ' + ALL_LESSONS[nk].lesson.title} · ${ALL_LESSONS.filter(x => !x.lesson.review && Learn.st.done[x.lesson.id] != null).length}/${ALL_LESSONS.filter(x => !x.lesson.review).length}</span></div></button>`; })()}
        ${(() => { const d = Openings.dueLines().length; return `<button class="action" data-act="openings"><div class="ai">📖</div><div><b>Eröffnungen</b><span>${d ? `🔁 ${d} Linie${d === 1 ? '' : 'n'} fällig` : OPENINGS.length + ' Eröffnungen nach Elo sortiert'}</span></div></button>`; })()}
        <button class="action" data-act="puzzle"><div class="ai">🧩</div><div><b>Rätsel lösen</b><span>Deine Wertung: ${Math.round(ps.rating)} · Serie 🔥${ps.streak}</span></div></button>
        <button class="action" data-act="analyse" ${last ? '' : 'disabled'}><div class="ai">📈</div><div><b>Letzte Partie analysieren</b><span>${last ? `${esc(last.white)} – ${esc(last.black)}` : 'Noch keine Partie gespielt'}</span></div></button>
      </div>
      <div class="cards">
        <div class="card"><div class="label">Rätsel-Wertung</div><div class="value">${Math.round(ps.rating)}</div>
          <div class="hint">Höchstwert ${Math.round(ps.peak)} · ${ps.solved} gelöst</div>${sparkline(ps.hist, '#ff8a9b')}</div>
        <div class="card"><div class="label">Partien gegen Bots</div><div class="value">${w + d + l}</div>
          <div class="hint"><span style="color:var(--ok)">${w} Siege</span> · ${d} Remis · <span style="color:var(--danger)">${l} Niederlagen</span></div>
          <div class="wdl"><div class="w" style="width:${w / tot * 100}%"></div><div class="d" style="width:${d / tot * 100}%"></div><div class="l" style="width:${l / tot * 100}%"></div></div></div>
        <div class="card"><div class="label">Ø Genauigkeit</div><div class="value">${avgAcc}${accs.length ? '<small style="font-size:18px">%</small>' : ''}</div>
          <div class="hint">${accs.length ? `aus deinen letzten ${accs.length} analysierten Partien` : 'Analysiere eine Partie, um sie zu sehen'}</div></div>
        <div class="card"><div class="label">Tage-Serie</div><div class="value">🔥 ${getActivity().streak}</div>
          <div class="hint">Lerne oder löse jeden Tag ein Rätsel · Rekord ${getActivity().best || 0} · ⚡ ${Learn.st.xp} XP</div></div>
      </div>
      <div style="height:16px"></div>
      <div class="two-col">
        <div class="card"><div class="row"><div class="label">Bot-Leiter</div><span class="muted small">${beaten.size} von 10 besiegt</span></div>
          <p class="muted small">Besiege jeden Bot, um dich nach oben zu arbeiten.${nextBot >= 0 ? ` Nächstes Ziel: <b>${BOTS[nextBot].name}</b>.` : ' Alle besiegt – Respekt! 👑'}</p>
          <div class="ladder">${BOTS.filter(b => b.ladder).map((b, i) => `<div class="rung ${beaten.has(i) ? 'done' : i > nextBot && nextBot >= 0 ? 'locked' : ''}" data-act="bot" data-arg="${i}">
            <span class="em">${beaten.has(i) ? '✅' : b.emoji}</span><b>${b.name}</b><div class="muted">${b.elo}</div></div>`).join('')}</div></div>
        <div class="card"><div class="label">Zugbewertungen</div><div style="height:10px"></div>
          <div class="legend">${CLS_ORDER.map(k => `<div><span class="cls-dot" style="background:${CLS[k].color}">${CLS[k].sym}</span>${CLS[k].name}</div>`).join('')}</div>
          <p class="muted small" style="margin-bottom:0">Die Bewertung siehst du live beim Spielen und in der Analyse.</p></div>
      </div>
      ${games.length ? `<h3>Letzte Partien</h3>${games.slice(0, 5).map((g, i) => gameItemHtml(g, i)).join('')}` : ''}`;
    bind($('home'), {
      resume: () => switchTab('play'),
      play: () => { Play.setup = true; switchTab('play'); },
      puzzle: () => switchTab('puzzle'),
      learn: () => switchTab('learn'),
      openings: () => switchTab('openings'),
      pieces: () => openPieceChooser(),
      sound: () => { Sound.on = !Sound.on; store.set('sound', Sound.on); soundLabel(); this.render(); },
      analyse: () => { Analysis.loadRecord(store.get('games', [])[0]); switchTab('analysis'); },
      bot: i => { Play.botIdx = +i; store.set('botIdx', Play.botIdx); Play.setup = true; switchTab('play'); },
      open: i => { Analysis.loadRecord(store.get('games', [])[+i]); switchTab('analysis'); },
      del: (i, e) => { e.stopPropagation(); const gs = store.get('games', []); gs.splice(+i, 1); store.set('games', gs); this.render(); }
    });
  }
};

function gameItemHtml(g, i) {
  const uc = g.userColor;
  const res = g.result === '1/2-1/2' || uc == null ? 'draw' : ((g.result === '1-0') === (uc === 0) ? 'win' : 'loss');
  const resTxt = g.result === '1/2-1/2' ? 'Remis' : uc == null ? g.result : res === 'win' ? 'Sieg' : 'Niederl.';
  return `<div class="game-item" data-act="open" data-arg="${i}"><div class="res ${res}">${resTxt}</div>
    <div class="info"><b>${esc(g.white)}</b> – <b>${esc(g.black)}</b><br><span class="muted">${new Date(g.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${Math.ceil(g.moves.length / 2)} Züge · ${STATUS_TEXT[g.reason] || g.result}${g.acc != null ? ` · 🎯 ${g.acc}%` : ''}</span></div>
    <button class="btn small" data-act="del" data-arg="${i}" title="Löschen">✕</button></div>`;
}

let mode = 'home';
const modes = { home: Home, learn: Learn, openings: Openings, play: Play, puzzle: Puzzles, analysis: Analysis, free: Free, editor: Editor };
const TAB_OF = { free: 'analysis', editor: 'analysis' };
function switchTab(name) {
  mode = name;
  if (name !== 'learn') { document.body.classList.remove('learn-mode', 'lesson-mode', 'no-board'); }
  if (name !== 'openings') document.body.classList.remove('openings-mode');
  document.body.classList.toggle('home-mode', name === 'home');
  document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === (TAB_OF[name] || name)));
  for (const k of ['play', 'puzzle', 'analysis', 'openings', 'free', 'editor']) $('panel-' + k).classList.toggle('hidden', k !== name);
  board.sel = -1;
  board.editHandler = null;
  modes[name].activate();
  renderBoardNav();
  store.set('tab', name);
  window.scrollTo(0, 0);
}

function resize() {
  const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
  const wide = vw > 980;
  if (document.body.classList.contains('lesson-mode')) {
    const w = wide ? vw - 210 - 60 : vw - 32;
    const h = window.innerHeight - (wide ? 290 : 250);
    document.documentElement.style.setProperty('--sq', Math.max(34, Math.min(80, Math.floor(Math.min(w, h) / 8))) + 'px');
    return;
  }
  const evalW = $('evalbar') && $('evalbar').style.display === 'none' ? 0 : 36;
  const availW = wide ? vw - 210 - 410 - 90 - evalW : vw - 32 - evalW;
  const availH = window.innerHeight - 40 - 96;
  let sq = Math.floor(Math.min(availW, wide ? availH : availW * 1.5) / 8);
  sq = Math.max(34, Math.min(sq, 96));
  document.documentElement.style.setProperty('--sq', sq + 'px');
}

const board = new Board($('board'));
board.onMove = uci => modes[mode].onUserMove(uci);
EvalBar.init();
resize();
window.addEventListener('resize', resize);
document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
const soundLabel = () => { $('soundBtn').innerHTML = Sound.on ? '🔊<span class="lbl"> Ton an</span>' : '🔇<span class="lbl"> Ton aus</span>'; };
soundLabel();
$('piecesBtn').onclick = () => openPieceChooser();
$('soundBtn').onclick = () => { Sound.on = !Sound.on; store.set('sound', Sound.on); soundLabel(); };
document.addEventListener('click', e => { if (e.target.closest('button, .game-item, .rung')) Sound.play('ui'); }, true);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!d) return;
  if (mode === 'analysis' && Analysis.game) { Analysis.go(Analysis.ply + d); e.preventDefault(); }
  if (mode === 'openings' && Openings.view === 'watch') { Openings.go(Openings.ply + d); e.preventDefault(); }
  if (mode === 'free') { Free.go(Free.ply + d); e.preventDefault(); }
  if (mode === 'play' && Play.game) { Play.nav(d); e.preventDefault(); }
});

Play.init();
setInterval(() => Play.clockTick(), 100);
switchTab(store.get('tab', 'home'));
