// Eröffnungs-Repertoire. Züge in internationaler Notation (N/B/R/Q/K), Kommentare in {geschweiften Klammern}
// beziehen sich auf den Zug davor. "side" = Farbe, die du lernst. Elo-Gruppen sind Trainer-Empfehlungen
// (wie viel Theorie, wie klar die Pläne), keine Gewinnstatistiken.
// Zerlegt "1.e4 {Kommentar} e5 2.Nf3 …" in [{ san, comment }]
function parseOpeningLine(str) {
  const out = [];
  const re = /\{([^}]*)\}|([^\s{}]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] != null) { if (out.length) out[out.length - 1].comment = m[1].trim(); continue; }
    const tok = m[2].replace(/^\d+\.+/, '');
    if (tok) out.push({ san: tok, comment: '' });
  }
  return out;
}

const OPENING_GROUPS = [
  { id: 'g1', name: 'Einsteiger', range: 'bis ca. 1000 Elo', min: 0, max: 1000, icon: 'sprout', why: 'Natürliche Entwicklung, klare Ziele, wenig Theorie. Hier zählt: Figuren raus, König sicher, Fallen kennen.' },
  { id: 'g2', name: 'Aufsteiger', range: 'ca. 1000–1400 Elo', min: 1000, max: 1400, icon: 'leaf', why: 'Solide Klassiker mit langfristigen Plänen. Du lernst Bauernstrukturen und typische Manöver kennen.' },
  { id: 'g3', name: 'Fortgeschritten', range: 'ca. 1400–1800 Elo', min: 1400, max: 1800, icon: 'tree-pine', why: 'Unausgeglichene, dynamische Stellungen mit Gewinnchancen – brauchen mehr Theorie und taktisches Gespür.' },
  { id: 'g4', name: 'Experte', range: 'ab ca. 1800 Elo', min: 1800, max: 9999, icon: 'mountain-snow', why: 'Hochtheoretische Systeme der Weltspitze. Lohnen sich, wenn die Grundlagen sitzen.' }
];

const OPENINGS = [
  {
    id: 'italienisch', name: 'Italienische Partie', eco: 'C50–C54', side: 'w', group: 'g1',
    why: 'Der Läufer zielt sofort auf f7 – den schwächsten Punkt. Schnelle Entwicklung, frühe Rochade, viele Fallen für den Gegner.',
    idea: 'Entwickeln, rochieren, mit c3 und d4 (oder d3) das Zentrum aufbauen.',
    lines: [
      { id: 'it1', name: 'Giuoco Pianissimo', moves: '1.e4 e5 2.Nf3 {Greift e5 an und entwickelt.} Nc6 3.Bc4 {Der italienische Läufer – Ziel f7.} Bc5 4.c3 {Bereitet d4 vor.} Nf6 5.d3 d6 6.O-O {König in Sicherheit.} O-O 7.Re1 a6 8.Bb3 {Der Läufer zieht sich vorsorglich zurück.}' },
      { id: 'it2', name: 'Gegen das Zweispringerspiel', moves: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 {Schwarz greift e4 an.} 4.d3 {Ruhig gedeckt – kein Risiko.} Be7 5.O-O O-O 6.Re1 d6 7.c3 {Ein Bauernzentrum entsteht.}' },
      { id: 'it3', name: 'Mit d4 ins Zentrum', moves: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 {Der direkte Angriff aufs Zentrum.} exd4 6.cxd4 Bb4+ 7.Bd2 Bxd2+ 8.Nbxd2 d5 {Schwarz befreit sich.} 9.exd5 Nxd5 10.Qb3 {Druck auf d5 und b7.}' }
    ]
  },
  {
    id: 'london', name: 'London-System', eco: 'D02', side: 'w', group: 'g1',
    why: 'Fast immer der gleiche Aufbau – egal was Schwarz spielt. Perfekt, um ohne viel Theorie solide Stellungen zu bekommen.',
    idea: 'd4, Lf4, e3, Sf3, c3, Sbd2, Ld3 – dann rochieren und am Königsflügel angreifen.',
    lines: [
      { id: 'lo1', name: 'Gegen 1…d5', moves: '1.d4 d5 2.Bf4 {Der London-Läufer kommt vor e3 raus.} Nf6 3.e3 e6 4.Nf3 c5 5.c3 {Die typische Pyramide c3–d4–e3.} Nc6 6.Nbd2 Bd6 7.Bg3 {Abtausch vermeiden, Struktur behalten.} O-O 8.Bd3' },
      { id: 'lo2', name: 'Gegen Königsindisch', moves: '1.d4 Nf6 2.Bf4 g6 3.e3 Bg7 4.Nf3 O-O 5.Be2 d6 6.h3 {Schützt den Läufer vor Sh5/Sg4-Ideen.} c5 7.c3 {Gleicher Aufbau – das ist das London-System.}' }
    ]
  },
  {
    id: 'e5schwarz', name: 'Offene Spiele (1…e5)', eco: 'C44–C55', side: 'b', group: 'g1',
    why: 'Die klassische Antwort auf 1.e4: symmetrisch, logisch, und du lernst die wichtigsten Grundideen des Schachs.',
    idea: 'e5 halten, Figuren entwickeln, rochieren – und den Gegner nicht auf f7 losgehen lassen.',
    lines: [
      { id: 'e51', name: 'Gegen Italienisch', moves: '1.e4 e5 2.Nf3 Nc6 {Deckt e5.} 3.Bc4 Bc5 {Der Läufer spiegelt Weiß.} 4.c3 Nf6 5.d3 d6 6.O-O O-O 7.Re1 a6 {Platz für den Läuferrückzug nach a7.}' },
      { id: 'e52', name: 'Gegen Schottisch', moves: '1.e4 e5 2.Nf3 Nc6 3.d4 exd4 4.Nxd4 Nf6 {Greift e4 an.} 5.Nxc6 bxc6 {Zum Zentrum hin zurückschlagen.} 6.e5 Qe7 7.Qe2 Nd5 {Der Springer steht stark im Zentrum.}' },
      { id: 'e53', name: 'Schäferzug abwehren', moves: '1.e4 e5 2.Bc4 Nc6 3.Qh5 {Droht Dxf7 matt!} g6 {Wichtig: Die Dame wird abgewiesen.} 4.Qf3 Nf6 {Deckt f7 nochmal und entwickelt.} 5.Ne2 Bg7' }
    ]
  },
  {
    id: 'skandinavisch', name: 'Skandinavisch', eco: 'B01', side: 'b', group: 'g1',
    why: 'Sofortiger Kampf ums Zentrum ab Zug 1 – Weiß kann kaum eigene Theorie aufziehen. Klare, ruhige Stellungen.',
    idea: '1…d5, nach exd5 sofort zurückschlagen, Läufer nach f5 oder g4, solide mit e6 und c6.',
    lines: [
      { id: 'sk1', name: 'Hauptvariante 3…Da5', moves: '1.e4 d5 2.exd5 Qxd5 3.Nc3 Qa5 {Die Dame steht sicher und fesselt c3.} 4.d4 Nf6 5.Nf3 c6 {Gibt der Dame ein Rückzugsfeld.} 6.Bc4 Bf5 {Der Läufer kommt vor e6 raus.} 7.Bd2 e6' },
      { id: 'sk2', name: 'Modern mit 2…Sf6', moves: '1.e4 d5 2.exd5 Nf6 {Erst entwickeln, dann zurückschlagen.} 3.d4 Nxd5 4.Nf3 g6 5.Be2 Bg7 6.O-O O-O' }
    ]
  },
  {
    id: 'spanisch', name: 'Spanische Partie', eco: 'C60–C99', side: 'w', group: 'g2',
    why: 'Die „Königin der Eröffnungen“: langfristiger Druck auf e5 ohne Risiko. Lehrt Geduld und Pläne.',
    idea: 'Mit Lb5 den Verteidiger von e5 angreifen, rochieren, mit c3 und d4 das Zentrum aufbauen.',
    lines: [
      { id: 'sp1', name: 'Geschlossen', moves: '1.e4 e5 2.Nf3 Nc6 3.Bb5 {Greift den Verteidiger von e5 an.} a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 {Vorbereitung von d4.} O-O 9.h3 {Verhindert Lg4.}' },
      { id: 'sp2', name: 'Abtauschvariante', moves: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 {Weiß gibt das Läuferpaar für eine bessere Bauernstruktur.} dxc6 5.O-O f6 6.d4 exd4 7.Nxd4 c5 8.Nb3 Qxd1 9.Rxd1 {Ein Endspiel mit Bauernmehrheit am Königsflügel.}' },
      { id: 'sp3', name: 'Berliner Mauer', moves: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4 {Schwarz nimmt den Bauern …} 5.Re1 Nd6 6.Nxe5 {… und Weiß holt ihn zurück.} Be7 7.Bf1 Nxe5 8.Rxe5 O-O' }
    ]
  },
  {
    id: 'damengambit', name: 'Damengambit', eco: 'D06–D69', side: 'w', group: 'g2',
    why: 'Solider Druck im Zentrum mit c4. Kein echtes Opfer – der Bauer kann fast immer zurückgewonnen werden.',
    idea: 'd4 und c4, Figuren nach c3, f3, g5 – dann Minoritätsangriff oder Zentrumsvorstoß e4.',
    lines: [
      { id: 'dg1', name: 'Abgelehnt', moves: '1.d4 d5 2.c4 {Greift d5 an.} e6 3.Nc3 Nf6 4.Bg5 {Fesselung des Springers.} Be7 5.e3 O-O 6.Nf3 Nbd7 7.Rc1 c6 8.Bd3' },
      { id: 'dg2', name: 'Angenommen', moves: '1.d4 d5 2.c4 dxc4 {Schwarz nimmt – kann den Bauern aber nicht halten.} 3.Nf3 Nf6 4.e3 e6 5.Bxc4 {Bauer zurück, Läufer aktiv.} c5 6.O-O a6 7.a4 Nc6 8.Qe2' }
    ]
  },
  {
    id: 'carokann', name: 'Caro-Kann', eco: 'B12–B19', side: 'b', group: 'g2',
    why: 'Sehr solide gegen 1.e4: wenig Schwächen, der „schlechte“ Läufer kommt vor e6 heraus. Ideal, um sichere Stellungen zu bekommen.',
    idea: 'c6 und d5, Läufer nach f5, dann e6 und c5 – eine feste Struktur ohne Fallen.',
    lines: [
      { id: 'ck1', name: 'Klassisch', moves: '1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Bf5 {Der Läufer kommt vor e6 raus.} 5.Ng3 Bg6 6.h4 h6 7.Nf3 Nd7 8.h5 Bh7 9.Bd3 Bxd3 10.Qxd3 e6' },
      { id: 'ck2', name: 'Vorstoß', moves: '1.e4 c6 2.d4 d5 3.e5 Bf5 {Erst der Läufer, dann e6.} 4.Nf3 e6 5.Be2 c5 {Angriff auf die Bauernkette.} 6.Be3 Nd7 7.O-O Ne7' },
      { id: 'ck3', name: 'Abtausch', moves: '1.e4 c6 2.d4 d5 3.exd5 cxd5 4.Bd3 Nc6 5.c3 Nf6 6.Bf4 Bg4 {Aktive Läuferentwicklung.} 7.Qb3 Na5 8.Qa4+ Bd7 9.Qc2' }
    ]
  },
  {
    id: 'franzoesisch', name: 'Französisch', eco: 'C00–C19', side: 'b', group: 'g2',
    why: 'Solide mit klarem Gegenangriff: Schwarz greift die weiße Bauernkette mit c5 und f6 an. Klare Pläne, gute Struktur-Schule.',
    idea: 'e6 und d5, dann mit c5 die Basis der weißen Kette angreifen.',
    lines: [
      { id: 'fr1', name: 'Vorstoß', moves: '1.e4 e6 2.d4 d5 3.e5 c5 {Angriff auf die Basis d4.} 4.c3 Nc6 5.Nf3 Qb6 {Noch mehr Druck auf d4.} 6.a3 c4 7.Nbd2 Na5' },
      { id: 'fr2', name: 'Abtausch', moves: '1.e4 e6 2.d4 d5 3.exd5 exd5 4.Nf3 Nf6 5.Bd3 Bd6 6.O-O O-O 7.Bg5 Bg4 {Symmetrisch und ruhig.}' },
      { id: 'fr3', name: 'Winawer', moves: '1.e4 e6 2.d4 d5 3.Nc3 Bb4 {Fesselung des Springers.} 4.e5 c5 5.a3 Bxc3+ 6.bxc3 Ne7 7.Nf3 Nbc6 8.a4 Qa5 9.Qd2 Bd7' }
    ]
  },
  {
    id: 'sizilianisch', name: 'Sizilianisch', eco: 'B20–B99', side: 'b', group: 'g3',
    why: 'Die kämpferischste Antwort auf 1.e4: unausgeglichene Stellungen mit echten Gewinnchancen für Schwarz – aber viel Theorie.',
    idea: 'c5 kämpft um d4, ohne die Stellung zu spiegeln. Gegenspiel am Damenflügel.',
    lines: [
      { id: 'si1', name: 'Najdorf', moves: '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 {Der berühmte Najdorf-Zug.} 6.Be3 e5 7.Nb3 Be6 8.f3 Be7 9.Qd2 O-O' },
      { id: 'si2', name: 'Gegen Alapin (2.c3)', moves: '1.e4 c5 2.c3 Nf6 {Greift e4 sofort an.} 3.e5 Nd5 4.d4 cxd4 5.Nf3 Nc6 6.cxd4 d6 7.Bc4 Nb6 8.Bb5 dxe5 9.Nxe5 Bd7' },
      { id: 'si3', name: 'Gegen Grand Prix', moves: '1.e4 c5 2.Nc3 Nc6 3.f4 g6 4.Nf3 Bg7 5.Bc4 e6 {Neutralisiert den Läufer c4.} 6.O-O Nge7 7.d3 d5 8.Bb3 O-O' }
    ]
  },
  {
    id: 'englisch', name: 'Englische Eröffnung', eco: 'A10–A39', side: 'w', group: 'g3',
    why: 'Flexibel und positionell: Weiß kontrolliert d5 von der Seite und kann in viele Systeme überleiten.',
    idea: 'c4, Sc3, g3, Lg2 – der Läufer auf der langen Diagonale ist die Hauptfigur.',
    lines: [
      { id: 'en1', name: 'Umgekehrter Sizilianer', moves: '1.c4 e5 2.Nc3 Nf6 3.g3 d5 4.cxd5 Nxd5 5.Bg2 {Der Läufer drückt auf d5 und b7.} Nb6 6.Nf3 Nc6 7.O-O Be7 8.d3 O-O' },
      { id: 'en2', name: 'Gegen 1…Sf6', moves: '1.c4 Nf6 2.Nc3 e6 3.Nf3 d5 4.d4 Be7 5.Bg5 O-O 6.e3 {Überleitung ins Damengambit.}' }
    ]
  },
  {
    id: 'koenigsindisch', name: 'Königsindisch', eco: 'E60–E99', side: 'b', group: 'g3',
    why: 'Schwarz überlässt Weiß das Zentrum und greift es später an – oft mit gefährlichem Königsangriff. Dynamisch und scharf.',
    idea: 'Sf6, g6, Lg7, d6, Rochade – dann e5 und Angriff mit f5 am Königsflügel.',
    lines: [
      { id: 'ki1', name: 'Klassisch', moves: '1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 O-O 6.Be2 e5 {Der typische Gegenstoß.} 7.O-O Nc6 8.d5 Ne7 9.Ne1 Nd7 {Vorbereitung von f5.}' },
      { id: 'ki2', name: 'Sämisch', moves: '1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.f3 O-O 6.Be3 c5 {Gegenangriff auf d4.} 7.Nge2 Nc6 8.d5 Ne5' }
    ]
  },
  {
    id: 'slawisch', name: 'Slawisch', eco: 'D10–D19', side: 'b', group: 'g3',
    why: 'Sehr solide gegen das Damengambit: d5 wird mit c6 gedeckt und der Läufer c8 bleibt frei.',
    idea: 'd5 und c6, Läufer nach f5 oder g4, dann e6 – eine stabile Struktur.',
    lines: [
      { id: 'sl1', name: 'Hauptvariante', moves: '1.d4 d5 2.c4 c6 {Deckt d5, ohne den Läufer einzusperren.} 3.Nf3 Nf6 4.Nc3 dxc4 5.a4 Bf5 6.e3 e6 7.Bxc4 Bb4 8.O-O O-O 9.Qe2 Nbd7' },
      { id: 'sl2', name: 'Abtauschvariante', moves: '1.d4 d5 2.c4 c6 3.cxd5 cxd5 4.Nc3 Nf6 5.Bf4 Nc6 6.e3 Bf5 7.Nf3 e6 8.Qb3 Bb4' }
    ]
  },
  {
    id: 'nimzo', name: 'Nimzo-Indisch', eco: 'E20–E59', side: 'b', group: 'g4',
    why: 'Eine der angesehensten Verteidigungen: Lb4 fesselt den Springer und kämpft um e4. Reich an strategischen Ideen.',
    idea: 'Sf6, e6, Lb4 – oft gibt Schwarz das Läuferpaar, um Weiß Doppelbauern zu verpassen.',
    lines: [
      { id: 'ni1', name: 'Rubinstein (4.e3)', moves: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 {Die Nimzo-Fesselung.} 4.e3 O-O 5.Bd3 d5 6.Nf3 c5 7.O-O Nc6 8.a3 Bxc3 9.bxc3 dxc4 10.Bxc4 Qc7' },
      { id: 'ni2', name: 'Klassisch (4.Dc2)', moves: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.Qc2 {Vermeidet Doppelbauern.} O-O 5.a3 Bxc3+ 6.Qxc3 d5 7.Nf3 dxc4 8.Qxc4 b6 9.Bg5 Ba6 {Der Läufer jagt die Dame.} 10.Qa4 c5' }
    ]
  },
  {
    id: 'gruenfeld', name: 'Grünfeld-Indisch', eco: 'D70–D99', side: 'b', group: 'g4',
    why: 'Schwarz lässt Weiß ein großes Zentrum bauen – und zerstört es dann mit Figurendruck. Sehr theoretisch und dynamisch.',
    idea: 'Sf6, g6, d5 – nach dem Abtausch auf c3 greifen Lg7 und c5 das weiße Zentrum an.',
    lines: [
      { id: 'gr1', name: 'Abtauschvariante', moves: '1.d4 Nf6 2.c4 g6 3.Nc3 d5 {Der Grünfeld-Zug.} 4.cxd5 Nxd5 5.e4 Nxc3 6.bxc3 Bg7 {Druck auf d4 und c3.} 7.Nf3 c5 8.Be3 Qa5 9.Qd2 Nc6 10.Rc1 cxd4 11.cxd4 Qxd2+ 12.Kxd2 O-O' }
    ]
  },
  {
    id: 'katalanisch', name: 'Katalanisch', eco: 'E01–E09', side: 'w', group: 'g4',
    why: 'Die Weltmeister-Eröffnung: Damengambit plus Fianchetto. Langfristiger Druck auf den Damenflügel, sehr positionell.',
    idea: 'd4, c4, g3, Lg2 – der Läufer auf der langen Diagonale ist die Waffe. Den Bauern c4 holt man meist zurück.',
    lines: [
      { id: 'ka1', name: 'Offen', moves: '1.d4 Nf6 2.c4 e6 3.g3 d5 4.Bg2 {Der katalanische Läufer.} Be7 5.Nf3 O-O 6.O-O dxc4 7.Qc2 a6 8.Qxc4 b5 9.Qc2 Bb7 10.Bd2' }
    ]
  }
];

if (typeof module !== 'undefined' && module.exports) module.exports = { OPENINGS, OPENING_GROUPS, parseOpeningLine };
