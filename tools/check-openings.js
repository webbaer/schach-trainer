// Prüft alle Eröffnungslinien: node tools/check-openings.js
const C = require('../engine.js');
const { OPENINGS, parseOpeningLine } = require('../openings.js');
const e = new C.Engine(20);
let errors = 0, lines = 0;
const ids = new Set();
for (const o of OPENINGS) for (const l of o.lines) {
  lines++;
  if (ids.has(l.id)) { errors++; console.log('doppelte id', l.id); }
  ids.add(l.id);
  const p = new C.Position();
  const mv = parseOpeningLine(l.moves);
  let ok = true;
  for (const [i, x] of mv.entries()) {
    const m = p.fromSan(x.san);
    if (!m) { console.log('FEHLER', o.id, l.id, 'Zug', i + 1, x.san, p.fen()); errors++; ok = false; break; }
    p.make(m);
  }
  if (!ok) continue;
  const r = e.search(p, { timeMs: 700 });
  const white = p.side === 0 ? r.score : -r.score;
  const mine = o.side === 'w' ? white : -white;
  const flag = mine < -120 ? '  <-- schlecht für Lernenden' : '';
  if (flag) errors++;
  console.log(`${o.side} ${l.id.padEnd(4)} ${String(mv.length).padStart(2)} Halbzüge  Bewertung für dich: ${mine}${flag}`);
}
console.log(OPENINGS.length, 'Eröffnungen,', lines, 'Linien,', errors, 'Probleme');
process.exit(errors ? 1 : 0);
