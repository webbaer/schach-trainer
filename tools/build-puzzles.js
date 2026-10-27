// Fügt die erzeugten Rätsel zusammen und schreibt ../puzzles.js
const fs = require('fs');
const C = require('../engine.js');
let all = [];
for (const f of fs.readdirSync(__dirname).filter(f => /^part\d+\.json$/.test(f))) {
  try { all = all.concat(JSON.parse(fs.readFileSync(__dirname + '/' + f, 'utf8'))); } catch (e) {}
}
const seen = new Set();
all = all.filter(p => { const k = p.fen + p.last; if (seen.has(k)) return false; seen.add(k); return true; });
// Validierung: alle Züge müssen legal sein
all = all.filter(p => {
  const pos = new C.Position(p.fen);
  for (const u of [p.last, ...p.sol]) { const m = pos.fromUci(u); if (!m) return false; pos.make(m); }
  return true;
});
// Schwierigkeit nach Rang auf 400–2300 verteilen (Reihenfolge der Rohwertung bleibt erhalten)
all.sort((a, b) => a.rating - b.rating);
const n = all.length;
all.forEach((p, i) => { p.rating = Math.round((400 + (n > 1 ? i / (n - 1) : 0) * 1900) / 5) * 5; });
const out = all.map((p, i) => ({ id: i, fen: p.fen, last: p.last, sol: p.sol, rating: p.rating, themes: p.themes }));
fs.writeFileSync(__dirname + '/../puzzles.js', '// Automatisch erzeugt (tools/build-puzzles.js)\nwindow.PUZZLES = ' + JSON.stringify(out) + ';\n');
const themes = {};
out.forEach(p => p.themes.forEach(t => themes[t] = (themes[t] || 0) + 1));
console.log(n, 'Rätsel', themes);
