const C = require('../engine.js');
function perft(p, d){ if(!d) return 1; let n=0; for(const m of p.legalMoves()){ p.make(m); n+=perft(p,d-1); p.unmake(); } return n; }
const tests = [
 ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
 ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
 ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
 ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 4, 422333],
 ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
];
for (const [f,d,exp] of tests){ const p=new C.Position(f); const h=p.h1; const t=Date.now(); const n=perft(p,d); console.log(n===exp?'OK ':'FAIL', n, exp, Date.now()-t+'ms', p.fen()===new C.Position(f).fen() && p.h1===h ? '' : 'STATE CORRUPT'); }
// hash consistency
const p=new C.Position(tests[1][0]); for(const m of p.legalMoves()){p.make(m); const h=p.h1; p.computeHash(); if(h!==p.h1) console.log('hash mismatch', p.toUci(m)); p.unmake();}
// search sanity
const e=new C.Engine();
for (const f of ['6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1','r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1', C.START_FEN]){
 const pos=new C.Position(f); const r=e.search(pos,{timeMs:1500}); console.log(f, pos.toSan(r.move), r.score, 'd'+r.depth, r.nodes, r.pv.map(m=>pos.toUci(m)).join(' '));
}
