// Erzeugt Rätsel per Engine-Selbstspiel: node genpuzzles.js <anzahl> <ausgabe.json>
const C = require('../engine.js');
const { Position, Engine, MATE, MATE_BOUND } = C;

const target = parseInt(process.argv[2] || '50', 10);
const outFile = process.argv[3] || 'puzzles-part.json';
const fs = require('fs');
const e = new Engine(22);
const puzzles = [];
const seen = new Set();

const isMate = s => s > MATE_BOUND;
const mateLen = s => Math.ceil((MATE - s) / 2);

function bestTwo(pos, timeMs) {
  const depths = [];
  const best = e.search(pos, { timeMs, onInfo: r => depths.push(r.move) });
  const second = e.search(pos, { timeMs: timeMs / 2, exclude: [best.move] });
  let findDepth = depths.length;
  for (let i = depths.length - 1; i >= 0; i--) { if (depths[i] === best.move) findDepth = i + 1; else break; }
  return { best, second, findDepth };
}

function unique(b, s) {
  if (isMate(b.score)) return !(isMate(s.score) && mateLen(s.score) <= mateLen(b.score));
  return b.score - s.score >= 250 || (s.score < 60 && b.score - s.score >= 170);
}

function isForcing(pos, m) {
  if (C.mFlags(m) & C.F_CAP || C.mPromo(m)) return true;
  pos.make(m); const chk = pos.inCheck(); pos.unmake();
  return chk;
}

function isFork(pos, m) {
  const p = pos.clone();
  p.make(m);
  const sq = C.mTo(m);
  const mover = p.board[sq] & 7;
  p.makeNull();
  const VAL = [0, 1, 3, 3, 5, 9, 100];
  let n = 0;
  for (const c of p.genMoves([], true)) {
    if (C.mFrom(c) !== sq) continue;
    const t = p.board[C.mTo(c)] & 7;
    if (t >= 2 && (VAL[t] > VAL[mover] || t === 6)) n++;
  }
  return n >= 2;
}

function tryPuzzle(start, lastMove) {
  const pos = start.clone();
  pos.make(lastMove);
  const key = pos.fen().split(' ').slice(0, 4).join(' ');
  if (seen.has(key)) return null;
  seen.add(key);
  const first = bestTwo(pos, 1500);
  if (first.best.score < 250 || !unique(first.best, first.second)) return null;
  const mate = isMate(first.best.score);
  if (mate && mateLen(first.best.score) > 5) return null;
  const sol = [first.best.move];
  const p = pos.clone();
  p.make(first.best.move);
  let userMoves = 1, hardest = first.findDepth;
  const maxUser = mate ? mateLen(first.best.score) : 3;
  while (userMoves < maxUser) {
    if (!p.legalMoves().length) break;
    const reply = e.search(p, { timeMs: 700 });
    p.make(reply.move);
    const nx = bestTwo(p, 1000);
    const lastMateMove = mate && isMate(nx.best.score) && mateLen(nx.best.score) === 1;
    const ok = mate ? (isMate(nx.best.score) && (lastMateMove || unique(nx.best, nx.second)))
      : (unique(nx.best, nx.second) && isForcing(p, nx.best.move));
    if (!ok) { p.unmake(); break; }
    sol.push(reply.move, nx.best.move);
    p.make(nx.best.move);
    hardest = Math.max(hardest, nx.findDepth);
    userMoves++;
  }
  if (mate && p.legalMoves().length) return null; // Mattlinie unvollständig
  if (!mate) {
    const end = e.search(p, { timeMs: 700 });
    if (-end.score < 200) return null;
    // triviale Rückschläge (sofortiges Zurückschlagen) aussortieren, wenn nichts weiter folgt
    if (sol.length === 1 && (C.mFlags(lastMove) & C.F_CAP) && C.mTo(lastMove) === C.mTo(sol[0])) return null;
  }
  const themes = [];
  if (mate) themes.push('Matt in ' + mateLen(first.best.score));
  else {
    if (isFork(pos, sol[0])) themes.push('Gabel');
    if (C.mFlags(sol[0]) & C.F_CAP) themes.push('Material gewinnen');
    else if (isForcing(pos, sol[0])) themes.push('Angriff');
    else themes.push('Stiller Zug');
    if (sol.some(m => C.mPromo(m))) themes.push('Umwandlung');
  }
  let pieces = 0;
  for (let sq = 0; sq < 128; sq++) if (!(sq & 0x88) && pos.board[sq] && (pos.board[sq] & 7) !== 1) pieces++;
  if (pieces <= 6) themes.push('Endspiel');
  let rating = 300 + hardest * 120 + (userMoves - 1) * 170 + (mate ? 0 : 60);
  if (!isForcing(pos, sol[0])) rating += 150;
  rating += Math.round((Math.random() - 0.5) * 120);
  rating = Math.max(400, Math.min(2800, rating));
  return {
    fen: start.fen(),
    last: start.toUci(lastMove),
    sol: sol.map((m, i) => { const q = pos.clone(); for (let k = 0; k < i; k++) q.make(sol[k]); return q.toUci(m); }),
    rating, themes
  };
}

function pickMove(pos, ply) {
  if (ply < 6) {
    const legal = pos.legalMoves();
    const sc = e.rootScores(pos, 1, 500).sort((a, b) => b.score - a.score).slice(0, 8);
    return sc[Math.floor(Math.random() * sc.length)].move || legal[0];
  }
  // menschenähnliche Fehler: manchmal nur flach rechnen
  const r = Math.random();
  if (r < 0.25) {
    const sc = e.rootScores(pos, 1, 500).map(x => ({ m: x.move, s: x.score + Math.random() * 120 }));
    sc.sort((a, b) => b.s - a.s);
    return sc[0].m;
  }
  if (r < 0.5) {
    const sc = e.rootScores(pos, 2, 800).map(x => ({ m: x.move, s: x.score + Math.random() * 60 }));
    sc.sort((a, b) => b.s - a.s);
    return sc[0].m;
  }
  return e.search(pos, { timeMs: 60 }).move;
}

const t0 = Date.now();
let games = 0;
while (puzzles.length < target) {
  games++;
  const pos = new Position();
  let prevScore = null;
  for (let ply = 0; ply < 140; ply++) {
    if (pos.status()) break;
    const quick = e.search(pos, { timeMs: 80 });
    if (prevScore !== null && ply >= 8 && prevScore > -120 && quick.score >= 250 && pos.undo.length) {
      const m = pos.undo[pos.undo.length - 7];
      pos.unmake();
      const before = pos.clone();
      pos.make(m);
      const pz = tryPuzzle(before, m);
      if (pz) {
        puzzles.push(pz);
        fs.writeFileSync(outFile, JSON.stringify(puzzles));
        console.log(puzzles.length, pz.rating, pz.themes.join(','), pz.sol.join(' '), Math.round((Date.now() - t0) / 1000) + 's');
        if (puzzles.length >= target) break;
      }
    }
    if (Math.abs(quick.score) > 1500 && ply > 30) break; // entschieden
    prevScore = quick.score;
    pos.make(pickMove(pos, ply));
  }
}
console.log('fertig', games, 'Partien');
