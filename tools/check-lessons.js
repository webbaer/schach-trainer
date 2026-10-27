// Prüft alle Lernpfad-Übungen mit der Engine: node tools/check-lessons.js
const C = require('../engine.js');
const { LESSONS, lessonFen } = require('../lessons.js');
const e = new C.Engine(18);
let errors = 0, n = 0;
const err = (id, i, msg) => { errors++; console.log('FEHLER', id, '#' + i, msg); };
for (const u of LESSONS) for (const l of u.lessons) l.steps.forEach((st, i) => {
  n++;
  const fen = lessonFen(st);
  if (st.t === 'quiz' && !(st.a >= 0 && st.a < st.opts.length)) err(l.id, i, 'quiz a');
  if (!fen) { if (!['info', 'quiz'].includes(st.t)) err(l.id, i, 'kein Brett'); return; }
  let pos;
  try { pos = new C.Position(fen); } catch (x) { err(l.id, i, 'FEN ' + fen); return; }
  for (const sq of [...(st.marks || []), ...(st.stars || []), ...(st.arrows || []).flat()]) if (!/^[a-h][1-8]$/.test(sq)) err(l.id, i, 'Feld ' + sq);
  if (st.last) { const m = pos.fromUci(st.last); if (!m) { err(l.id, i, 'last illegal'); return; } pos.make(m); }
  const legal = pos.legalMoves();
  const has = test => legal.some(m => { pos.make(m); const r = test(); pos.unmake(); return r; });
  switch (st.t) {
    case 'collect': if (!(st.stars.length || /[a-z]/.test(st.pos.replace(/[a-h][1-8]/g, '')))) err(l.id, i, 'nichts zu sammeln'); break;
    case 'move': {
      for (const u of st.ok) if (!pos.fromUci(u)) err(l.id, i, 'ok illegal ' + u);
      const best = e.search(pos, { timeMs: 400 });
      console.log(`  ${l.id}#${i} ok=${st.ok.join(',')} engine=${pos.toUci(best.move)} (${best.score})`);
      break;
    }
    case 'check': if (!has(() => pos.inCheck())) err(l.id, i, 'kein Schach möglich'); break;
    case 'mate': { const ms = legal.filter(m => { pos.make(m); const r = pos.status() === 'checkmate'; pos.unmake(); return r; }); if (!ms.length) err(l.id, i, 'kein Matt'); else console.log(`  ${l.id}#${i} Matt: ${ms.map(m => pos.toSan(m)).join(' ')}`); break; }
    case 'any': if (!legal.length) err(l.id, i, 'keine Züge'); if (!pos.inCheck()) console.log('  Hinweis: any ohne Schach', l.id); break;
    case 'line': {
      const p = pos.clone();
      for (const u of st.sol) { const m = p.fromUci(u); if (!m) { err(l.id, i, 'line illegal ' + u); break; } p.make(m); }
      const best = e.search(pos, { timeMs: 400 });
      console.log(`  ${l.id}#${i} line=${st.sol.join(' ')} engine=${pos.toUci(best.move)} (${best.score})`);
      break;
    }
    case 'playmate': if (!legal.length) err(l.id, i, 'keine Züge'); break;
  }
});
console.log(n, 'Schritte geprüft,', errors, 'Fehler');
process.exit(errors ? 1 : 0);
