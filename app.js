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
    const r = eng.search(pos, { timeMs: msg.timeMs || 1000, maxDepth: msg.maxDepth });
    return { move: r.move ? pos.toUci(r.move) : null, score: r.score, depth: r.depth, pv: pvUci(r.pv) };
  }
  if (msg.cmd === 'bot') {
    const L = msg.level;
    if (L.time) { const r = eng.search(pos, { timeMs: L.time }); return { move: r.move ? pos.toUci(r.move) : null }; }
    const sc = eng.rootScores(pos, L.depth, 2500);
    if (!sc.length) return { move: null };
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
  checkmate: 'Schachmatt', stalemate: 'Patt', insufficient: 'Ungenügendes Material',
  fifty: '50-Züge-Regel', repetition: 'Dreifache Stellungswiederholung', resign: 'Aufgabe'
};

// ---------- Brett ----------
const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
const pieceHtml = p => `<span class="piece ${p >> 3 ? 'b' : 'w'}">${GLYPH[p & 7]}︎</span>`;

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
      if (o.badge && o.badge.sq === sq) html += `<span class="badge" style="background:${o.badge.color}">${o.badge.sym}</span>`;
      d.innerHTML = html;
      if (sq === this.dragFrom && this.dragging && d.firstChild) d.firstChild.classList.add('dragging');
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
    (info.thinking ? '<div class="thinking">denkt nach …</div>' : '');
}

// ---------- Bots ----------
const BOTS = [
  { name: 'Bruno', emoji: '🐣', elo: 400, depth: 1, noise: 400, blunder: 0.3, desc: 'Lernt gerade die Regeln' },
  { name: 'Lina', emoji: '🐢', elo: 600, depth: 1, noise: 250, blunder: 0.15, desc: 'Übersieht oft Figuren' },
  { name: 'Max', emoji: '🦊', elo: 800, depth: 2, noise: 160, blunder: 0.08, desc: 'Gelegenheitsspieler' },
  { name: 'Emma', emoji: '🐼', elo: 1000, depth: 2, noise: 90, blunder: 0.04, desc: 'Vereinsanfängerin' },
  { name: 'Paul', emoji: '🦉', elo: 1200, depth: 3, noise: 55, blunder: 0.02, desc: 'Solider Hobbyspieler' },
  { name: 'Sofia', emoji: '🐺', elo: 1400, depth: 3, noise: 25, blunder: 0, desc: 'Kennt die Taktiken' },
  { name: 'Viktor', emoji: '🦁', elo: 1600, depth: 4, noise: 12, blunder: 0, desc: 'Starker Vereinsspieler' },
  { name: 'Greta', emoji: '🐉', elo: 1800, time: 400, desc: 'Experte' },
  { name: 'Kaspar', emoji: '🤖', elo: 2000, time: 1200, desc: 'Meisteranwärter' },
  { name: 'Titan', emoji: '👑', elo: 2300, time: 3000, desc: 'Volle Engine-Stärke' },
  { name: 'Freund', emoji: '👥', elo: 0, human: true, desc: 'Zwei Spieler an einem Gerät' }
];

// ---------- Modus: Spielen ----------
const Play = {
  game: null, botIdx: store.get('botIdx', 3), colorChoice: store.get('colorChoice', 'w'), userColor: 0,
  thinking: false, over: null, token: 0, viewPly: null, showEval: store.get('showEval', false), hint: null, saved: false,
  showLive: store.get('liveCls', true), live: { evals: [], best: [], cls: [] }, liveToken: 0, liveLoop: null,

  init() {
    const cur = store.get('current', null);
    if (cur && cur.moves) {
      this.botIdx = cur.botIdx; this.userColor = cur.userColor;
      this.game = Game.fromUci(cur.startFen, cur.moves);
    }
  },
  get bot() { return BOTS[this.botIdx]; },

  activate() {
    board.setFlipped(this.bot.human ? board.flipped : this.userColor === 1);
    this.refresh(); this.renderPanel();
    if (this.game && !this.over) { this.maybeBot(); this.liveAnalyse(); }
  },

  start() {
    engine.cancel();
    this.token++;
    this.game = new Game();
    this.over = null; this.viewPly = null; this.hint = null; this.thinking = false; this.saved = false;
    this.resetLive();
    const c = this.colorChoice === 'r' ? (Math.random() < .5 ? 'w' : 'b') : this.colorChoice;
    this.userColor = c === 'w' ? 0 : 1;
    board.setFlipped(this.userColor === 1 && !this.bot.human);
    this.persist();
    this.refresh(); this.renderPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.maybeBot();
  },

  persist() {
    if (!this.game || this.over) { store.set('current', null); return; }
    store.set('current', { botIdx: this.botIdx, userColor: this.userColor, startFen: this.game.startFen, moves: this.game.uci() });
  },

  isUserTurn() { return this.game && !this.over && (this.bot.human || this.game.pos.side === this.userColor); },

  // ----- Live-Zugbewertung (läuft parallel zum Bot im Analyse-Worker) -----
  resetLive() { this.liveToken++; this.live = { evals: [], best: [], cls: [] }; },
  liveAnalyse() {
    if (!this.showLive || !this.game || this.liveLoop === this.liveToken) return;
    this.liveLoop = this.liveToken;
    this.liveRun(this.liveToken);
  },
  async liveRun(tok) {
    try {
      for (;;) {
        const g = this.game, L = this.live;
        if (!g || tok !== this.liveToken || !this.showLive) return;
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
      setStrip(board.flipped ? 'bottom' : 'top', { avatar: '♚', name: 'Schwarz', pos, color: 1 });
      setStrip(board.flipped ? 'top' : 'bottom', { avatar: '♔', name: 'Weiß', pos, color: 0 });
    } else {
      setStrip('top', { avatar: this.bot.emoji, name: this.bot.name, sub: `(${this.bot.elo})`, pos, color: me ^ 1, thinking: this.thinking });
      setStrip('bottom', { avatar: '🙂', name: 'Du', pos, color: me });
    }
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
    const r = await engine.request({ cmd: 'bot', fen: this.game.startFen, moves: this.game.uci(), level: { depth: b.depth, noise: b.noise, blunder: b.blunder, time: b.time } });
    const wait = 450 + Math.random() * 400 - (Date.now() - t0);
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
    else if (reason === 'resign') result = winner === 0 ? '1-0' : '0-1';
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
    const userWon = !this.bot.human && ((result === '1-0' && this.userColor === 0) || (result === '0-1' && this.userColor === 1));
    const userLost = !this.bot.human && result !== '1/2-1/2' && !userWon;
    const title = this.bot.human ? (result === '1-0' ? 'Weiß gewinnt' : result === '0-1' ? 'Schwarz gewinnt' : 'Remis') :
      userWon ? '🏆 Gewonnen!' : userLost ? 'Verloren' : '🤝 Remis';
    const sub = userWon ? `Du hast ${this.bot.name} besiegt! ${this.botIdx < 9 ? `Als Nächstes: ${BOTS[this.botIdx + 1].name} ${BOTS[this.botIdx + 1].emoji}` : ''}` : '';
    showModal(`<div style="font-size:54px">${this.bot.emoji}</div><h2>${title}</h2><p class="muted">${STATUS_TEXT[reason]} · ${result}</p>
      ${sub ? `<p>${sub}</p>` : ''}
      <button class="btn primary full" data-act="analyse">📈 Partie analysieren</button>
      ${userWon && this.botIdx < 9 ? '<button class="btn full" data-act="nextBot">Nächsten Bot herausfordern</button>' : ''}
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
      id: Date.now(), date: Date.now(), bot: this.botIdx,
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
    const c = box.querySelector('.cur');
    if (c) c.scrollIntoView({ block: 'nearest' });
  },

  renderPanel() {
    const p = $('panel-play');
    if (!this.game || this.setup) {
      const beaten = beatenBots();
      p.innerHTML = `<div class="panel-head"><div class="big-ic">${this.bot.emoji}</div><div><h2>Neue Partie</h2><div class="muted">Wähle deinen Gegner</div></div></div>
        <div class="bot-grid">${BOTS.map((b, i) => `<button class="bot-card ${i === this.botIdx ? 'active' : ''} ${beaten.has(i) ? 'has-beaten' : ''}" data-act="bot" data-arg="${i}">
          <span class="em">${b.emoji}</span><span class="nm">${b.name}</span><span class="el">${b.human ? '2 Spieler' : 'ca. ' + b.elo}</span>${beaten.has(i) ? '<span class="beaten">✔</span>' : ''}</button>`).join('')}</div>
        <p class="muted small">${esc(this.bot.desc)}</p>
        <h3>Deine Farbe</h3>
        <div class="seg">${[['w', '♔ Weiß'], ['r', '🎲 Zufall'], ['b', '♚ Schwarz']].map(([k, l]) => `<button class="${this.colorChoice === k ? 'active' : ''}" data-act="color" data-arg="${k}">${l}</button>`).join('')}</div>
        <div style="height:16px"></div>
        <button class="btn primary full" data-act="start">▶ Spielen gegen ${this.bot.name}</button>
        ${this.game && this.setup ? '<button class="btn full" style="margin-top:8px" data-act="back">Zurück zur laufenden Partie</button>' : ''}`;
      bind(p, {
        bot: i => { this.botIdx = +i; store.set('botIdx', this.botIdx); this.renderPanel(); if (!this.game) this.refresh(); },
        color: c => { this.colorChoice = c; store.set('colorChoice', c); this.renderPanel(); },
        start: () => { this.setup = false; this.start(); },
        back: () => { this.setup = false; this.renderPanel(); }
      });
      return;
    }
    const b = this.bot;
    const turn = this.game.pos.side === 0 ? 'Weiß' : 'Schwarz';
    const status = this.over ? `<b>${STATUS_TEXT[this.over.reason]}</b> · ${this.over.result}` :
      this.thinking ? `${b.emoji} ${b.name} denkt nach …` : this.isUserTurn() ? `<b>${turn}</b> ist am Zug${this.game.pos.inCheck() ? ' – <b style="color:var(--accent2)">Schach!</b>' : ''}` : '';
    p.innerHTML = `<div class="panel-head"><div class="big-ic">${b.emoji}</div><div><h2>${b.human ? 'Partie zu zweit' : 'gegen ' + b.name}</h2><div class="muted">${b.human ? 'Ein Gerät, zwei Spieler' : 'ca. ' + b.elo + ' Elo · ' + esc(b.desc)}</div></div></div>
      <div class="status-box" id="playStatus">${status}</div>
      <div class="live-box" id="liveBox"></div>
      <div class="movelist" id="playMoves"></div>
      <div class="btn-row">
        <button class="btn small" data-act="first" title="Anfang">⏮</button>
        <button class="btn small" data-act="prev" title="Zurück (←)">◀</button>
        <button class="btn small" data-act="next" title="Vor (→)">▶</button>
        <button class="btn small" data-act="last" title="Aktuell">⏭</button>
      </div>
      <div class="btn-row">
        <button class="btn" data-act="hint" ${this.over ? 'disabled' : ''}>💡 Tipp</button>
        <button class="btn" data-act="undo">↶ Zurück</button>
        <button class="btn" data-act="flip">⇅ Drehen</button>
        <button class="btn danger" data-act="resign" ${this.over ? 'disabled' : ''}>🏳 Aufgeben</button>
      </div>
      <label class="chk"><input type="checkbox" id="liveChk" ${this.showLive ? 'checked' : ''}> Züge live bewerten (Brillant, Patzer …)</label>
      <label class="chk"><input type="checkbox" id="evalChk" ${this.showEval ? 'checked' : ''}> Bewertungsbalken anzeigen</label>
      <div style="height:10px"></div>
      ${this.over ? '<button class="btn primary full" data-act="analyse">📈 Partie analysieren</button><div style="height:6px"></div>' : ''}
      <div class="btn-row"><button class="btn" data-act="new">＋ Neues Spiel</button><button class="btn" data-act="pgn">📋 PGN</button></div>`;
    bind(p, {
      first: () => this.view(0), prev: () => this.nav(-1), next: () => this.nav(1), last: () => this.view(1e9),
      hint: () => this.getHint(), undo: () => this.takeback(), resign: () => this.resign(),
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
const Puzzles = {
  st: Object.assign({ rating: 800, solved: 0, tries: 0, streak: 0, bestStreak: 0, peak: 800, done: {}, recent: [], diff: 0 }, store.get('puzzle', {})),
  cur: null, game: null, step: 0, failed: false, solved: false, lastDelta: null, msg: '', busy: false, token: 0,

  save() { store.set('puzzle', this.st); },
  activate() { if (!this.cur) this.next(); else { this.refresh(); this.renderPanel(); } EvalBar.show(false); },

  pick() {
    if (!PUZZLES.length) return null;
    let pool = PUZZLES.filter(p => !this.st.done[p.id]);
    if (!pool.length) { this.st.done = {}; pool = PUZZLES; }
    const target = this.st.rating + this.st.diff + (Math.random() * 150 - 50);
    pool.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
    return pool[Math.floor(Math.random() * Math.min(3, pool.length))];
  },

  async next() {
    const pz = this.pick();
    this.token++;
    const tok = this.token;
    if (!pz) { $('panel-puzzle').innerHTML = '<h2>Keine Rätsel gefunden</h2><p>puzzles.js fehlt.</p>'; return; }
    this.cur = pz; this.step = 0; this.failed = false; this.solved = false; this.lastDelta = null; this.hintSq = -1; this.marks = null;
    this.game = new Game(pz.fen);
    this.userColor = this.game.pos.side ^ 1;
    board.setFlipped(this.userColor === 1);
    this.msg = '';
    this.busy = true;
    this.refresh(); this.renderPanel();
    await sleep(600);
    if (tok !== this.token) return;
    const rec = this.game.play(pz.last);
    Sound.forMove(rec, this.game.pos);
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
    setStrip('top', { avatar: '🧩', name: 'Rätsel', sub: this.solved || this.failed ? `Wertung ${this.cur.rating}` : '', pos: this.game.pos, color: this.userColor ^ 1 });
    setStrip('bottom', { avatar: '🙂', name: 'Du', sub: `(${Math.round(this.st.rating)})`, pos: this.game.pos, color: this.userColor });
  },

  rate(win) {
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
    if (uci === expected || mate) {
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

  finishSolved() {
    this.solved = true;
    if (!this.failed) this.rate(true);
    Sound.play('good');
    this.msg = this.failed ? '✓ Gelöst – aber nicht im ersten Versuch.' : '🎉 Perfekt gelöst!';
    this.refresh(true); this.renderPanel();
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
    if (!pz) return;
    const side = this.userColor === 0 ? 'Weiß' : 'Schwarz';
    const userMoves = Math.ceil(pz.sol.length / 2);
    const delta = this.lastDelta == null ? '' : `<span class="delta ${this.lastDelta >= 0 ? 'up' : 'down'}">${this.lastDelta >= 0 ? '+' : ''}${this.lastDelta}</span>`;
    const statusCls = this.solved && !this.failed ? 'good' : this.msg.startsWith('✗') ? 'bad' : '';
    const done = this.solved;
    const rate = s.tries ? Math.round(100 * s.solved / s.tries) : 0;
    p.innerHTML = `<div class="row"><div><div class="muted small">Deine Rätsel-Wertung</div>
        <div class="rating-big">${Math.round(s.rating)} ${delta}</div></div>
        <div style="text-align:right"><div class="muted small">Serie</div><div class="rating-big">🔥${s.streak}</div></div></div>
      <div class="status-box ${statusCls}">
        ${this.busy && !this.game.moves.length ? 'Gegner zieht …' : `<b>${side} am Zug</b> – finde den besten Zug${userMoves > 1 ? ` <span class="muted">(${userMoves} Züge)</span>` : ''}`}
        ${this.msg ? `<div style="margin-top:6px">${this.msg}</div>` : ''}
      </div>
      ${done || this.failed ? `<div><span class="pill">Rätsel #${pz.id + 1}</span><span class="pill">Wertung ${pz.rating}</span>${pz.themes.map(t => `<span class="pill">${t}</span>`).join('')}</div>` : ''}
      <div class="btn-row">
        <button class="btn" data-act="hint" ${done ? 'disabled' : ''}>💡 Hinweis</button>
        <button class="btn" data-act="sol" ${done ? 'disabled' : ''}>👁 Lösung</button>
      </div>
      <button class="btn ${done ? 'primary' : ''} full" data-act="next">${done ? 'Nächstes Rätsel →' : 'Überspringen →'}</button>
      <h3>Schwierigkeit</h3>
      <div class="seg">${[[-200, 'Leichter'], [0, 'Normal'], [200, 'Schwerer']].map(([v, l]) => `<button class="${s.diff === v ? 'active' : ''}" data-act="diff" data-arg="${v}">${l}</button>`).join('')}</div>
      <p class="muted small">Die Rätsel passen sich deiner Wertung an: Löst du sie, werden sie schwieriger.</p>
      <h3>Statistik</h3>
      <div class="stat-grid">
        <div class="stat"><b>${s.solved}</b><span>Gelöst</span></div>
        <div class="stat"><b>${rate}%</b><span>Quote</span></div>
        <div class="stat"><b>${Math.round(s.peak)}</b><span>Höchstwert</span></div>
        <div class="stat"><b>${s.tries}</b><span>Versuche</span></div>
        <div class="stat"><b>${s.bestStreak}</b><span>Beste Serie</span></div>
        <div class="stat"><b>${PUZZLES.length}</b><span>Rätsel gesamt</span></div>
      </div>
      ${s.recent.length ? `<h3>Letzte Rätsel</h3><div>${s.recent.map(r => `<span class="pill" style="background:${r.ok ? '#3f4a35' : '#5a2f2b'}">${r.ok ? '✓' : '✗'} ${r.r}</span>`).join('')}</div>` : ''}
      <div style="height:10px"></div>
      <button class="btn small" data-act="reset">Fortschritt zurücksetzen</button>`;
    bind(p, {
      hint: () => this.hint(),
      sol: () => this.solution(),
      next: () => { if (!this.solved && !this.failed && this.game.moves.length) this.rate(false); this.showing = false; this.next(); },
      diff: v => { s.diff = +v; this.save(); this.renderPanel(); },
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
    const c = box.querySelector('.cur');
    if (c) c.scrollIntoView({ block: 'nearest' });
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
        <svg class="graph" id="anaGraph" viewBox="0 0 400 90" preserveAspectRatio="none"></svg>
        <div class="explain" id="anaExplain"></div>
        <div class="btn-row">
          <button class="btn small" data-act="first">⏮</button><button class="btn small" data-act="prev">◀</button>
          <button class="btn small" data-act="next">▶</button><button class="btn small" data-act="last">⏭</button>
        </div>
        <div class="btn-row">
          <button class="btn small" data-act="nextErr">⚠ Nächster Fehler</button>
          <button class="btn small" data-act="best">${this.showBest ? '🔵 Pfeil aus' : '🔵 Bester Zug'}</button>
          <button class="btn small" data-act="flip">⇅ Drehen</button>
        </div>
        <div class="movelist" id="anaMoves"></div>
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
      redo: () => this.loadRecord(this.record)
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

function copyText(t) {
  const done = () => showModal('<h2>📋 Kopiert</h2><p class="muted">PGN ist in der Zwischenablage.</p><button class="btn full" data-act="c">OK</button>', { c: hideModal });
  const fallback = () => {
    showModal(`<h2>PGN</h2><textarea readonly style="min-height:180px">${esc(t)}</textarea><button class="btn full" data-act="c">Schließen</button>`, { c: hideModal });
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
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
    const nextBot = BOTS.findIndex((b, i) => !b.human && !beaten.has(i));
    const cur = Play.game && !Play.over && Play.game.moves.length;
    const last = games[0];
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
    $('home').innerHTML = `
      <div class="hero"><h1>${greet}! ♞</h1><p>Spiele gegen Bots, löse Rätsel und lerne aus deinen Fehlern – komplett offline.</p></div>
      <div class="actions">
        ${cur ? `<button class="action main" data-act="resume"><div class="ai">▶</div><div><b>Partie fortsetzen</b><span>gegen ${Play.bot.name} · Zug ${Math.ceil(Play.game.moves.length / 2)}</span></div></button>`
        : `<button class="action main" data-act="play"><div class="ai">${BOTS[Play.botIdx].emoji}</div><div><b>Spielen</b><span>gegen ${BOTS[Play.botIdx].name} (ca. ${BOTS[Play.botIdx].elo})</span></div></button>`}
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
        <div class="card"><div class="label">Beste Rätsel-Serie</div><div class="value">🔥 ${ps.bestStreak}</div>
          <div class="hint">${ps.tries ? Math.round(100 * ps.solved / ps.tries) : 0}% Erfolgsquote · ${PUZZLES.length} Rätsel verfügbar</div></div>
      </div>
      <div style="height:16px"></div>
      <div class="two-col">
        <div class="card"><div class="row"><div class="label">Bot-Leiter</div><span class="muted small">${beaten.size} von 10 besiegt</span></div>
          <p class="muted small">Besiege jeden Bot, um dich nach oben zu arbeiten.${nextBot >= 0 ? ` Nächstes Ziel: <b>${BOTS[nextBot].name}</b>.` : ' Alle besiegt – Respekt! 👑'}</p>
          <div class="ladder">${BOTS.filter(b => !b.human).map((b, i) => `<div class="rung ${beaten.has(i) ? 'done' : i > nextBot && nextBot >= 0 ? 'locked' : ''}" data-act="bot" data-arg="${i}">
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
const modes = { home: Home, play: Play, puzzle: Puzzles, analysis: Analysis };
function switchTab(name) {
  mode = name;
  document.body.classList.toggle('home-mode', name === 'home');
  document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  for (const k of ['play', 'puzzle', 'analysis']) $('panel-' + k).classList.toggle('hidden', k !== name);
  board.sel = -1;
  modes[name].activate();
  store.set('tab', name);
  window.scrollTo(0, 0);
}

function resize() {
  const wide = window.innerWidth > 980;
  const evalW = $('evalbar') && $('evalbar').style.display === 'none' ? 0 : 36;
  const availW = wide ? window.innerWidth - 210 - 410 - 90 - evalW : window.innerWidth - 32 - evalW;
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
$('soundBtn').onclick = () => { Sound.on = !Sound.on; store.set('sound', Sound.on); soundLabel(); };
document.addEventListener('click', e => { if (e.target.closest('button, .game-item, .rung')) Sound.play('ui'); }, true);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!d) return;
  if (mode === 'analysis' && Analysis.game) { Analysis.go(Analysis.ply + d); e.preventDefault(); }
  if (mode === 'play' && Play.game) { Play.nav(d); e.preventDefault(); }
});

Play.init();
switchTab(store.get('tab', 'home'));
