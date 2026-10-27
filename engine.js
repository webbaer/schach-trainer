// Schach-Engine: Regeln (0x88-Brett), Bewertung und Alpha-Beta-Suche.
// Die gesamte Engine steckt in einer Factory-Funktion, damit sie sowohl im
// Hauptthread, in einem Web Worker (per toString/Blob) als auch in Node läuft.
function chessEngineFactory() {
  'use strict';

  const WHITE = 0, BLACK = 1;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const N_OFF = [-33, -31, -18, -14, 14, 18, 31, 33];
  const B_OFF = [-17, -15, 15, 17];
  const R_OFF = [-16, -1, 1, 16];
  const K_OFF = [-17, -16, -15, -1, 1, 15, 16, 17];
  const MATE = 100000, INF = 1000000, MATE_BOUND = MATE - 1000;
  const MAX_PLY = 96;

  // ---------- Zobrist-Hashing ----------
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) | 0;
    };
  }
  const rand = rng(20240607);
  const Z1 = new Int32Array(2400), Z2 = new Int32Array(2400);
  for (let i = 0; i < 2400; i++) { Z1[i] = rand(); Z2[i] = rand(); }
  const Z_SIDE = 2048, Z_CASTLE = 2049, Z_EP = 2065;

  const castleMask = new Uint8Array(128).fill(15);
  castleMask[4] = 12; castleMask[7] = 14; castleMask[0] = 13;
  castleMask[116] = 3; castleMask[119] = 11; castleMask[112] = 7;

  const mkMove = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);
  const mFrom = m => m & 127;
  const mTo = m => (m >> 7) & 127;
  const mPromo = m => (m >> 14) & 7;
  const mFlags = m => (m >> 17) & 31;

  const FILES = 'abcdefgh';
  const sqName = sq => FILES[sq & 7] + ((sq >> 4) + 1);
  const parseSq = s => (parseInt(s[1], 10) - 1) * 16 + FILES.indexOf(s[0]);
  const PIECE_CHARS = ' pnbrqk';

  // ---------- Position ----------
  class Position {
    constructor(fen) {
      this.board = new Int8Array(128);
      this.kingSq = [4, 116];
      this.load(fen || START_FEN);
    }

    load(fen) {
      const parts = fen.trim().split(/\s+/);
      const b = this.board;
      b.fill(0);
      let r = 7, f = 0;
      for (const ch of parts[0]) {
        if (ch === '/') { r--; f = 0; continue; }
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const lower = ch.toLowerCase();
        const t = PIECE_CHARS.indexOf(lower);
        if (t < 1 || r < 0 || f > 7) throw new Error('Ungültige FEN');
        const c = ch === lower ? 1 : 0;
        const sq = r * 16 + f;
        b[sq] = t | (c << 3);
        if (t === KING) this.kingSq[c] = sq;
        f++;
      }
      this.side = parts[1] === 'b' ? BLACK : WHITE;
      const cs = parts[2] || '-';
      this.castle = (cs.includes('K') ? 1 : 0) | (cs.includes('Q') ? 2 : 0) |
        (cs.includes('k') ? 4 : 0) | (cs.includes('q') ? 8 : 0);
      this.ep = parts[3] && parts[3] !== '-' ? parseSq(parts[3]) : -1;
      this.half = parseInt(parts[4], 10) || 0;
      this.full = parseInt(parts[5], 10) || 1;
      this.undo = [];
      this.computeHash();
      this.hashHist = [this.h1];
    }

    clone() {
      const p = Object.create(Position.prototype);
      p.board = new Int8Array(this.board);
      p.kingSq = this.kingSq.slice();
      p.side = this.side; p.castle = this.castle; p.ep = this.ep;
      p.half = this.half; p.full = this.full;
      p.h1 = this.h1; p.h2 = this.h2;
      p.undo = this.undo.slice();
      p.hashHist = this.hashHist.slice();
      return p;
    }

    computeHash() {
      let h1 = 0, h2 = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = this.board[sq];
        if (p) { h1 ^= Z1[p * 128 + sq]; h2 ^= Z2[p * 128 + sq]; }
      }
      if (this.side) { h1 ^= Z1[Z_SIDE]; h2 ^= Z2[Z_SIDE]; }
      h1 ^= Z1[Z_CASTLE + this.castle]; h2 ^= Z2[Z_CASTLE + this.castle];
      if (this.ep >= 0) { h1 ^= Z1[Z_EP + this.ep]; h2 ^= Z2[Z_EP + this.ep]; }
      this.h1 = h1; this.h2 = h2;
    }

    fen() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 16 + f];
          if (!p) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          const ch = PIECE_CHARS[p & 7];
          s += (p >> 3) ? ch : ch.toUpperCase();
        }
        if (empty) s += empty;
        if (r) s += '/';
      }
      let cs = '';
      if (this.castle & 1) cs += 'K';
      if (this.castle & 2) cs += 'Q';
      if (this.castle & 4) cs += 'k';
      if (this.castle & 8) cs += 'q';
      return s + ' ' + (this.side ? 'b' : 'w') + ' ' + (cs || '-') + ' ' +
        (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
    }

    attacked(sq, by) {
      const b = this.board, cb = by << 3;
      let s;
      if (by === WHITE) {
        s = sq - 15; if (!(s & 0x88) && b[s] === PAWN) return true;
        s = sq - 17; if (!(s & 0x88) && b[s] === PAWN) return true;
      } else {
        s = sq + 15; if (!(s & 0x88) && b[s] === (PAWN | 8)) return true;
        s = sq + 17; if (!(s & 0x88) && b[s] === (PAWN | 8)) return true;
      }
      const kn = KNIGHT | cb, kg = KING | cb;
      for (let i = 0; i < 8; i++) {
        s = sq + N_OFF[i]; if (!(s & 0x88) && b[s] === kn) return true;
        s = sq + K_OFF[i]; if (!(s & 0x88) && b[s] === kg) return true;
      }
      const bi = BISHOP | cb, ro = ROOK | cb, qu = QUEEN | cb;
      for (let i = 0; i < 4; i++) {
        let off = B_OFF[i];
        s = sq + off;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) { if (p === bi || p === qu) return true; break; }
          s += off;
        }
        off = R_OFF[i];
        s = sq + off;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) { if (p === ro || p === qu) return true; break; }
          s += off;
        }
      }
      return false;
    }

    inCheck() { return this.attacked(this.kingSq[this.side], this.side ^ 1); }

    genMoves(out, capsOnly) {
      const b = this.board, us = this.side, them = us ^ 1;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p || (p >> 3) !== us) continue;
        const t = p & 7;
        if (t === PAWN) {
          const dir = us ? -16 : 16;
          const startRank = us ? 6 : 1, promoRank = us ? 0 : 7;
          const to = sq + dir;
          if (!(to & 0x88) && !b[to]) {
            if ((to >> 4) === promoRank) {
              out.push(mkMove(sq, to, QUEEN, 0));
              if (!capsOnly) {
                out.push(mkMove(sq, to, ROOK, 0));
                out.push(mkMove(sq, to, BISHOP, 0));
                out.push(mkMove(sq, to, KNIGHT, 0));
              }
            } else if (!capsOnly) {
              out.push(mkMove(sq, to, 0, 0));
              if ((sq >> 4) === startRank && !b[to + dir]) out.push(mkMove(sq, to + dir, 0, F_DOUBLE));
            }
          }
          for (let k = 0; k < 2; k++) {
            const c = sq + dir + (k ? 1 : -1);
            if (c & 0x88) continue;
            const q = b[c];
            if (q && (q >> 3) === them) {
              if ((c >> 4) === promoRank) {
                out.push(mkMove(sq, c, QUEEN, F_CAP));
                out.push(mkMove(sq, c, ROOK, F_CAP));
                out.push(mkMove(sq, c, BISHOP, F_CAP));
                out.push(mkMove(sq, c, KNIGHT, F_CAP));
              } else out.push(mkMove(sq, c, 0, F_CAP));
            } else if (c === this.ep) {
              out.push(mkMove(sq, c, 0, F_CAP | F_EP));
            }
          }
        } else if (t === KNIGHT || t === KING) {
          const offs = t === KNIGHT ? N_OFF : K_OFF;
          for (let i = 0; i < 8; i++) {
            const to = sq + offs[i];
            if (to & 0x88) continue;
            const q = b[to];
            if (!q) { if (!capsOnly) out.push(mkMove(sq, to, 0, 0)); }
            else if ((q >> 3) === them) out.push(mkMove(sq, to, 0, F_CAP));
          }
          if (t === KING && !capsOnly) {
            const base = us ? 112 : 0;
            if (sq === base + 4) {
              const kr = us ? 4 : 1, qr = us ? 8 : 2;
              if ((this.castle & kr) && !b[base + 5] && !b[base + 6] && b[base + 7] === (ROOK | (us << 3)) &&
                !this.attacked(base + 4, them) && !this.attacked(base + 5, them) && !this.attacked(base + 6, them))
                out.push(mkMove(sq, base + 6, 0, F_CASTLE));
              if ((this.castle & qr) && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === (ROOK | (us << 3)) &&
                !this.attacked(base + 4, them) && !this.attacked(base + 3, them) && !this.attacked(base + 2, them))
                out.push(mkMove(sq, base + 2, 0, F_CASTLE));
            }
          }
        } else {
          const dirs = t === BISHOP ? B_OFF : t === ROOK ? R_OFF : K_OFF;
          for (let i = 0; i < dirs.length; i++) {
            const off = dirs[i];
            let to = sq + off;
            while (!(to & 0x88)) {
              const q = b[to];
              if (!q) { if (!capsOnly) out.push(mkMove(sq, to, 0, 0)); }
              else { if ((q >> 3) === them) out.push(mkMove(sq, to, 0, F_CAP)); break; }
              to += off;
            }
          }
        }
      }
      return out;
    }

    xz(i) { this.h1 ^= Z1[i]; this.h2 ^= Z2[i]; }

    make(m) {
      const b = this.board;
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 31;
      const us = this.side, piece = b[from];
      let capSq = to;
      if (flags & F_EP) capSq = us === WHITE ? to - 16 : to + 16;
      const captured = b[capSq];
      this.undo.push(m, captured, this.castle, this.ep, this.half, this.h1, this.h2);
      if (this.ep >= 0) this.xz(Z_EP + this.ep);
      this.xz(Z_CASTLE + this.castle);
      if (captured) { b[capSq] = 0; this.xz(captured * 128 + capSq); }
      b[from] = 0; this.xz(piece * 128 + from);
      const placed = promo ? (promo | (us << 3)) : piece;
      b[to] = placed; this.xz(placed * 128 + to);
      if (flags & F_CASTLE) {
        let rf, rt;
        if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
        const rook = b[rf];
        b[rf] = 0; this.xz(rook * 128 + rf);
        b[rt] = rook; this.xz(rook * 128 + rt);
      }
      if ((piece & 7) === KING) this.kingSq[us] = to;
      this.castle &= castleMask[from] & castleMask[to];
      this.ep = (flags & F_DOUBLE) ? (from + to) >> 1 : -1;
      this.half = ((piece & 7) === PAWN || captured) ? 0 : this.half + 1;
      if (us === BLACK) this.full++;
      this.side = us ^ 1;
      this.xz(Z_SIDE);
      this.xz(Z_CASTLE + this.castle);
      if (this.ep >= 0) this.xz(Z_EP + this.ep);
      this.hashHist.push(this.h1);
    }

    unmake() {
      const u = this.undo, b = this.board;
      const h2 = u.pop(), h1 = u.pop(), half = u.pop(), ep = u.pop(), castle = u.pop(), captured = u.pop(), m = u.pop();
      this.hashHist.pop();
      this.side ^= 1;
      const us = this.side;
      if (m === 0) { // Nullzug
        this.ep = ep; this.half = half; this.castle = castle; this.h1 = h1; this.h2 = h2;
        return;
      }
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 31;
      const piece = promo ? (PAWN | (us << 3)) : b[to];
      b[from] = piece;
      b[to] = 0;
      if (captured) b[(flags & F_EP) ? (us === WHITE ? to - 16 : to + 16) : to] = captured;
      if (flags & F_CASTLE) {
        let rf, rt;
        if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
        b[rf] = b[rt]; b[rt] = 0;
      }
      if ((piece & 7) === KING) this.kingSq[us] = from;
      if (us === BLACK) this.full--;
      this.castle = castle; this.ep = ep; this.half = half; this.h1 = h1; this.h2 = h2;
    }

    makeNull() {
      this.undo.push(0, 0, this.castle, this.ep, this.half, this.h1, this.h2);
      if (this.ep >= 0) this.xz(Z_EP + this.ep);
      this.ep = -1;
      this.half = 0;
      this.side ^= 1;
      this.xz(Z_SIDE);
      this.hashHist.push(this.h1);
    }

    legalMoves() {
      const list = this.genMoves([], false), res = [], us = this.side;
      for (const m of list) {
        this.make(m);
        if (!this.attacked(this.kingSq[us], us ^ 1)) res.push(m);
        this.unmake();
      }
      return res;
    }

    isRepetition() {
      const hh = this.hashHist, n = hh.length - 1, h = this.h1;
      const lim = Math.max(0, n - this.half);
      for (let i = n - 2; i >= lim; i -= 2) if (hh[i] === h) return true;
      return false;
    }

    repetitionCount() {
      const hh = this.hashHist, n = hh.length - 1, h = this.h1;
      const lim = Math.max(0, n - this.half);
      let c = 1;
      for (let i = n - 2; i >= lim; i -= 2) if (hh[i] === h) c++;
      return c;
    }

    insufficient() {
      const b = this.board;
      let minors = 0, bishopColors = 0, bishops = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = b[sq] & 7;
        if (!t || t === KING) continue;
        if (t === PAWN || t === ROOK || t === QUEEN) return false;
        minors++;
        if (t === BISHOP) { bishops++; bishopColors |= 1 << (((sq >> 4) + (sq & 7)) & 1); }
      }
      if (minors <= 1) return true;
      return bishops === minors && bishopColors !== 3;
    }

    // Spielstatus für die Oberfläche
    status() {
      const moves = this.legalMoves();
      if (!moves.length) return this.inCheck() ? 'checkmate' : 'stalemate';
      if (this.insufficient()) return 'insufficient';
      if (this.half >= 100) return 'fifty';
      if (this.repetitionCount() >= 3) return 'repetition';
      return null;
    }

    pieceAt(name) {
      const p = this.board[parseSq(name)];
      if (!p) return null;
      return { type: PIECE_CHARS[p & 7], color: (p >> 3) ? 'b' : 'w' };
    }

    toUci(m) {
      const pr = mPromo(m);
      return sqName(mFrom(m)) + sqName(mTo(m)) + (pr ? PIECE_CHARS[pr] : '');
    }

    fromUci(uci) {
      for (const m of this.legalMoves()) if (this.toUci(m) === uci) return m;
      return 0;
    }

    toSan(m, legal) {
      legal = legal || this.legalMoves();
      const from = mFrom(m), to = mTo(m), flags = mFlags(m), promo = mPromo(m);
      const t = this.board[from] & 7;
      let san;
      if (flags & F_CASTLE) san = to > from ? 'O-O' : 'O-O-O';
      else if (t === PAWN) {
        san = (flags & F_CAP) ? FILES[from & 7] + 'x' + sqName(to) : sqName(to);
        if (promo) san += '=' + PIECE_CHARS[promo].toUpperCase();
      } else {
        san = PIECE_CHARS[t].toUpperCase();
        let sameFile = false, sameRank = false, ambiguous = false;
        for (const o of legal) {
          if (o === m || mTo(o) !== to || mFrom(o) === from) continue;
          if ((this.board[mFrom(o)] & 7) !== t) continue;
          ambiguous = true;
          if ((mFrom(o) & 7) === (from & 7)) sameFile = true;
          if ((mFrom(o) >> 4) === (from >> 4)) sameRank = true;
        }
        if (ambiguous) {
          if (!sameFile) san += FILES[from & 7];
          else if (!sameRank) san += (from >> 4) + 1;
          else san += sqName(from);
        }
        if (flags & F_CAP) san += 'x';
        san += sqName(to);
      }
      this.make(m);
      if (this.inCheck()) san += this.legalMoves().length ? '+' : '#';
      this.unmake();
      return san;
    }

    fromSan(san) {
      const clean = s => s.replace(/[+#!?]/g, '').replace(/0/g, 'O').replace(/e\.p\./, '').trim();
      const target = clean(san);
      const legal = this.legalMoves();
      for (const m of legal) if (clean(this.toSan(m, legal)) === target) return m;
      // tolerant: fehlendes "=" bei Umwandlung (e8Q)
      for (const m of legal) if (clean(this.toSan(m, legal)).replace('=', '') === target.replace('=', '')) return m;
      return 0;
    }
  }

  // ---------- Bewertung ----------
  const MAT_MG = [0, 100, 320, 330, 500, 900, 0];
  const MAT_EG = [0, 120, 300, 320, 530, 940, 0];
  const PHASE = [0, 0, 1, 1, 2, 4, 0];
  const PST = {
    1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  };
  const PST_KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
  const PAWN_EG_RANK = [0, 0, 5, 10, 20, 35, 60, 0];
  const PASSED = [0, 5, 10, 18, 30, 50, 80, 0];
  const CENTER_DIST = sq => {
    const r = sq >> 4, f = sq & 7;
    return Math.max(3 - r, r - 4) + Math.max(3 - f, f - 4);
  };

  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  function evaluate(pos) {
    const b = pos.board;
    const mg = [0, 0], eg = [0, 0], nonPawn = [0, 0], bishops = [0, 0];
    let phase = 0;
    pawnFiles[0].fill(0); pawnFiles[1].fill(0);
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p) continue;
      const c = p >> 3, t = p & 7;
      const r = sq >> 4, f = sq & 7;
      const idx = c === WHITE ? (7 - r) * 8 + f : r * 8 + f;
      if (t === KING) {
        mg[c] += PST[6][idx];
        eg[c] += PST_KING_EG[idx];
        continue;
      }
      mg[c] += MAT_MG[t] + PST[t][idx];
      eg[c] += MAT_EG[t] + (t === PAWN ? PAWN_EG_RANK[c ? 7 - r : r] : PST[t][idx]);
      phase += PHASE[t];
      if (t === PAWN) pawnFiles[c][f]++;
      else { nonPawn[c] += MAT_MG[t]; if (t === BISHOP) bishops[c]++; }
    }
    // Bauernstruktur und Turm auf offenen Linien
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      const t = p & 7;
      if (t !== PAWN && t !== ROOK) continue;
      const c = p >> 3, f = sq & 7, r = sq >> 4;
      const own = pawnFiles[c], opp = pawnFiles[c ^ 1];
      if (t === ROOK) {
        if (!own[f]) { const bonus = opp[f] ? 8 : 18; mg[c] += bonus; eg[c] += bonus >> 1; }
        continue;
      }
      if ((f === 0 || !own[f - 1]) && (f === 7 || !own[f + 1])) { mg[c] -= 12; eg[c] -= 15; }
      if (own[f] > 1) { mg[c] -= 6; eg[c] -= 10; }
      let passed = true;
      const dir = c ? -16 : 16, enemyPawn = PAWN | ((c ^ 1) << 3);
      for (let s = sq + dir; !(s & 0x88) && passed; s += dir) {
        if (b[s] === enemyPawn) passed = false;
        if (f > 0 && b[s - 1] === enemyPawn) passed = false;
        if (f < 7 && b[s + 1] === enemyPawn) passed = false;
      }
      if (passed) {
        const rr = c ? 7 - r : r;
        mg[c] += PASSED[rr] >> 1;
        eg[c] += PASSED[rr] + (PASSED[rr] >> 1);
      }
    }
    for (let c = 0; c < 2; c++) if (bishops[c] >= 2) { mg[c] += 30; eg[c] += 45; }

    // Matt-Hilfe im Endspiel: gegnerischen König an den Rand drängen
    const matDiff = (eg[0] - eg[1]);
    if (phase <= 8 && Math.abs(matDiff) > 250) {
      const w = matDiff > 0 ? 0 : 1, l = w ^ 1;
      const lk = pos.kingSq[l], wk = pos.kingSq[w];
      const kd = Math.max(Math.abs((lk >> 4) - (wk >> 4)), Math.abs((lk & 7) - (wk & 7)));
      eg[w] += 12 * CENTER_DIST(lk) + 6 * (7 - kd);
    }
    // Ohne Bauern und mit kleinem Vorteil ist es oft remis
    let score;
    if (phase > 24) phase = 24;
    score = ((mg[0] - mg[1]) * phase + (eg[0] - eg[1]) * (24 - phase)) / 24;
    const strong = score > 0 ? 0 : 1;
    if (!pawnFiles[strong].some(x => x) && nonPawn[strong] - nonPawn[strong ^ 1] < 400) score /= 4;
    score = score | 0;
    return (pos.side === WHITE ? score : -score) + 10;
  }

  // ---------- Suche ----------
  const VAL = [0, 100, 320, 330, 500, 900, 2000];
  const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const EXACT = 1, LOWER = 2, UPPER = 3;

  class Engine {
    constructor(ttBits) {
      const size = 1 << (ttBits || TT_BITS);
      this.ttMask = size - 1;
      this.ttKey = new Int32Array(size);
      this.ttMove = new Int32Array(size);
      this.ttScore = new Int32Array(size);
      this.ttDepth = new Int8Array(size);
      this.ttFlag = new Int8Array(size);
      this.history = new Int32Array(16 * 128);
      this.killers = new Int32Array(MAX_PLY * 2 + 4);
      this.nodes = 0;
      this.stop = false;
    }

    clear() {
      this.ttKey.fill(0); this.ttFlag.fill(0); this.history.fill(0);
    }

    ttStore(pos, depth, score, flag, move, ply) {
      const i = pos.h1 & this.ttMask;
      if (this.ttKey[i] === pos.h2 && this.ttDepth[i] > depth && flag !== EXACT) return;
      if (score > MATE_BOUND) score += ply; else if (score < -MATE_BOUND) score -= ply;
      this.ttKey[i] = pos.h2; this.ttMove[i] = move; this.ttScore[i] = score;
      this.ttDepth[i] = depth; this.ttFlag[i] = flag;
    }

    orderMoves(pos, moves, ttMove, ply) {
      const scores = new Int32Array(moves.length), b = pos.board;
      const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (m === ttMove) { scores[i] = 10000000; continue; }
        const flags = mFlags(m), promo = mPromo(m);
        if (flags & F_CAP) {
          const victim = (flags & F_EP) ? PAWN : b[mTo(m)] & 7;
          scores[i] = 1000000 + VAL[victim] * 10 - VAL[b[mFrom(m)] & 7] / 10;
        } else if (promo === QUEEN) scores[i] = 900000;
        else if (m === k1) scores[i] = 800000;
        else if (m === k2) scores[i] = 790000;
        else scores[i] = this.history[b[mFrom(m)] * 128 + mTo(m)];
      }
      return scores;
    }

    checkTime() {
      if ((++this.nodes & 2047) === 0) {
        if (Date.now() > this.deadline || (this.nodeLimit && this.nodes > this.nodeLimit)) this.stop = true;
      }
    }

    quiesce(pos, alpha, beta, ply) {
      this.checkTime();
      if (this.stop) return 0;
      const inChk = pos.inCheck();
      if (ply >= MAX_PLY) return evaluate(pos);
      let best = -INF;
      let stand = 0;
      if (!inChk) {
        stand = evaluate(pos);
        if (stand >= beta) return stand;
        if (stand > alpha) alpha = stand;
        best = stand;
      }
      const moves = pos.genMoves([], !inChk);
      const scores = this.orderMoves(pos, moves, 0, ply);
      const us = pos.side, b = pos.board;
      let legal = 0;
      for (let i = 0; i < moves.length; i++) {
        let bi = i;
        for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[bi]) bi = j;
        const m = moves[bi]; moves[bi] = moves[i]; moves[i] = m;
        const sc = scores[bi]; scores[bi] = scores[i]; scores[i] = sc;
        if (!inChk && !mPromo(m)) {
          const victim = (mFlags(m) & F_EP) ? PAWN : b[mTo(m)] & 7;
          if (stand + VAL[victim] + 200 < alpha) continue;
        }
        pos.make(m);
        if (pos.attacked(pos.kingSq[us], us ^ 1)) { pos.unmake(); continue; }
        legal++;
        const s = -this.quiesce(pos, -beta, -alpha, ply + 1);
        pos.unmake();
        if (this.stop) return 0;
        if (s > best) {
          best = s;
          if (s > alpha) { alpha = s; if (s >= beta) break; }
        }
      }
      if (inChk && !legal) return -MATE + ply;
      return best;
    }

    negamax(pos, depth, alpha, beta, ply, allowNull) {
      this.checkTime();
      if (this.stop) return 0;
      const isRoot = ply === 0;
      if (!isRoot) {
        if (pos.half >= 100 || pos.isRepetition() || pos.insufficient()) return 0;
        // Matt-Distanz-Pruning
        const ma = -MATE + ply, mb = MATE - ply - 1;
        if (ma > alpha) alpha = ma;
        if (mb < beta) beta = mb;
        if (alpha >= beta) return alpha;
      }
      const inChk = pos.inCheck();
      if (inChk && ply < MAX_PLY - 10) depth++;
      if (depth <= 0 || ply >= MAX_PLY) return this.quiesce(pos, alpha, beta, ply);

      const pvNode = beta - alpha > 1;
      const ti = pos.h1 & this.ttMask;
      let ttMove = 0;
      if (this.ttKey[ti] === pos.h2 && this.ttFlag[ti]) {
        ttMove = this.ttMove[ti];
        if (!isRoot && this.ttDepth[ti] >= depth) {
          let s = this.ttScore[ti];
          if (s > MATE_BOUND) s -= ply; else if (s < -MATE_BOUND) s += ply;
          const fl = this.ttFlag[ti];
          if (fl === EXACT && !pvNode) return s;
          if (fl === LOWER && s >= beta) return s;
          if (fl === UPPER && s <= alpha) return s;
        }
      }

      const us = pos.side;
      if (!inChk && !pvNode && Math.abs(beta) < MATE_BOUND) {
        const ev = evaluate(pos);
        if (depth <= 3 && ev - 110 * depth >= beta) return ev;
        if (allowNull && depth >= 3 && ev >= beta && this.hasPieces(pos, us)) {
          const R = depth > 6 ? 3 : 2;
          pos.makeNull();
          const s = -this.negamax(pos, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
          pos.unmake();
          if (this.stop) return 0;
          if (s >= beta) return s > MATE_BOUND ? beta : s;
        }
      }

      const moves = pos.genMoves([], false);
      const scores = this.orderMoves(pos, moves, ttMove, ply);
      let best = -INF, bestMove = 0, legal = 0;
      const origAlpha = alpha;
      for (let i = 0; i < moves.length; i++) {
        let bi = i;
        for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[bi]) bi = j;
        const m = moves[bi]; moves[bi] = moves[i]; moves[i] = m;
        const sc = scores[bi]; scores[bi] = scores[i]; scores[i] = sc;
        if (isRoot && this.exclude && this.exclude.includes(m)) continue;
        pos.make(m);
        if (pos.attacked(pos.kingSq[us], us ^ 1)) { pos.unmake(); continue; }
        legal++;
        const quiet = !(mFlags(m) & F_CAP) && !mPromo(m);
        let s;
        if (legal === 1) {
          s = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
        } else {
          let r = 0;
          if (depth >= 3 && legal > 3 && quiet && !inChk && !pos.inCheck()) {
            r = 1 + (legal > 8 ? 1 : 0) + (depth > 6 ? 1 : 0);
            if (pvNode) r--;
          }
          s = -this.negamax(pos, depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && r > 0) s = -this.negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && s < beta) s = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
        }
        pos.unmake();
        if (this.stop) return 0;
        if (s > best) {
          best = s; bestMove = m;
          if (isRoot) { this.rootBest = m; this.rootScore = s; }
          if (s > alpha) {
            alpha = s;
            if (s >= beta) {
              if (quiet) {
                if (this.killers[ply * 2] !== m) {
                  this.killers[ply * 2 + 1] = this.killers[ply * 2];
                  this.killers[ply * 2] = m;
                }
                const hi = pos.board[mFrom(m)] * 128 + mTo(m);
                this.history[hi] += depth * depth;
                if (this.history[hi] > 700000) for (let k = 0; k < this.history.length; k++) this.history[k] >>= 1;
              }
              break;
            }
          }
        }
      }
      if (!legal) {
        if (isRoot && this.exclude && this.exclude.length) return -INF;
        return inChk ? -MATE + ply : 0;
      }
      this.ttStore(pos, depth, best, best >= beta ? LOWER : best > origAlpha ? EXACT : UPPER, bestMove, ply);
      return best;
    }

    hasPieces(pos, c) {
      const b = pos.board;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (p && (p >> 3) === c && (p & 7) !== PAWN && (p & 7) !== KING) return true;
      }
      return false;
    }

    extractPv(pos, first, maxLen) {
      const pv = [];
      const p = pos.clone();
      let m = first;
      const seen = new Set();
      while (m && pv.length < maxLen) {
        const legal = p.legalMoves();
        if (!legal.includes(m)) break;
        pv.push(m);
        p.make(m);
        if (seen.has(p.h1)) break;
        seen.add(p.h1);
        const i = p.h1 & this.ttMask;
        m = this.ttKey[i] === p.h2 ? this.ttMove[i] : 0;
      }
      return pv;
    }

    // Iterative Vertiefung. Liefert Score aus Sicht der Seite am Zug.
    search(pos, opts) {
      opts = opts || {};
      const maxDepth = opts.maxDepth || 64;
      this.deadline = Date.now() + (opts.timeMs || 1000);
      this.nodeLimit = opts.nodes || 0;
      this.exclude = opts.exclude || null;
      this.nodes = 0;
      this.stop = false;
      this.killers.fill(0);
      const legal = pos.legalMoves().filter(m => !this.exclude || !this.exclude.includes(m));
      if (!legal.length) return { move: 0, score: pos.inCheck() && !(this.exclude && this.exclude.length) ? -MATE : 0, depth: 0, pv: [], nodes: 0 };
      let result = { move: legal[0], score: 0, depth: 0, pv: [legal[0]], nodes: 0 };
      const p = pos.clone();
      let prevScore = 0;
      for (let d = 1; d <= maxDepth; d++) {
        this.rootBest = 0;
        let alpha = -INF, beta = INF, s;
        if (d >= 4 && Math.abs(prevScore) < MATE_BOUND) { alpha = prevScore - 40; beta = prevScore + 40; }
        for (;;) {
          s = this.negamax(p, d, alpha, beta, 0, false);
          if (this.stop) break;
          if (s <= alpha) { alpha = Math.max(-INF, alpha - 200); if (alpha < prevScore - 600) alpha = -INF; }
          else if (s >= beta) { beta = Math.min(INF, beta + 200); if (beta > prevScore + 600) beta = INF; }
          else break;
        }
        if (this.stop) {
          // halbfertige Iteration: nur übernehmen, wenn sie einen besseren Zug gefunden hat
          if (this.rootBest && this.rootBest !== result.move && this.rootScore > result.score + 30 && d > 1) {
            result = { move: this.rootBest, score: this.rootScore, depth: d - 1, pv: [this.rootBest], nodes: this.nodes };
          }
          break;
        }
        prevScore = s;
        const bm = this.rootBest || result.move;
        result = { move: bm, score: s, depth: d, pv: this.extractPv(p, bm, d + 6), nodes: this.nodes };
        if (opts.onInfo) opts.onInfo(result);
        if (Math.abs(s) > MATE_BOUND && d >= (MATE - Math.abs(s)) + 2) break;
        if (legal.length === 1 && d >= 4) break;
        if (Date.now() > this.deadline) break;
      }
      result.nodes = this.nodes;
      this.exclude = null;
      return result;
    }

    // Bewertet jeden legalen Zug einzeln (für schwache Bots mit Zufall)
    rootScores(pos, depth, timeMs) {
      this.deadline = Date.now() + (timeMs || 2000);
      this.nodeLimit = 0;
      this.stop = false;
      this.nodes = 0;
      const p = pos.clone();
      const res = [];
      for (const m of p.legalMoves()) {
        p.make(m);
        let s = depth <= 1 ? -this.quiesce(p, -INF, INF, 1) : -this.negamax(p, depth - 1, -INF, INF, 1, true);
        if (p.status && p.legalMoves().length === 0) s = p.inCheck() ? MATE - 1 : 0;
        p.unmake();
        if (this.stop) { s = res.length ? res[res.length - 1].score - 1 : 0; }
        res.push({ move: m, score: s });
      }
      return res;
    }
  }

  return {
    Position, Engine, evaluate, START_FEN, MATE, MATE_BOUND,
    WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    mFrom, mTo, mPromo, mFlags, sqName, parseSq, F_CAP, F_CASTLE, F_EP
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = chessEngineFactory();
