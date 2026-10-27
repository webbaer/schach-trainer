// Prüft die Endspiel-Trainer-Stellungen: node tools/check-endgames.js
const C = require('../engine.js');
const { ENDGAMES } = require('../lessons.js');
const e = new C.Engine(22);
let bad = 0;
for (const g of ENDGAMES) {
  const p = new C.Position(g.step.fen);
  const r = e.search(p, { timeMs: 3000 });
  const white = p.side === 0 ? r.score : -r.score;
  const mine = g.step.user === 'b' ? -white : white;
  const ok = g.step.t === 'hold' ? mine > -200 : mine > 250;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'PRÜFEN'} ${g.id.padEnd(13)} ${g.step.t.padEnd(8)} Bewertung für Lernenden ${mine} (Tiefe ${r.depth}) bester Zug ${p.toSan(r.move)}`);
}
process.exit(bad ? 1 : 0);
