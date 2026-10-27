// Lernpfad: von null auf Schach.
// Brett-Kurzschreibweise "pos": Figur + Feld, Großbuchstaben = Weiß, Kleinbuchstaben = Schwarz
// (K König, Q Dame, R Turm, B Läufer, N Springer, P Bauer), z. B. "Ke1 Ra1 ke8".
// Schritt-Typen:
//   info     – Erklärung (optional mit Brett, marks/arrows)
//   quiz     – Frage mit Antwortmöglichkeiten (opts, a = Index der richtigen Antwort, why = Erklärung)
//   collect  – alle Sterne (stars) und schwarzen Figuren mit den weißen Figuren einsammeln
//   move     – einen der Züge aus "ok" finden (UCI, z. B. "e2e4")
//   check    – irgendein Schach geben
//   mate     – Matt in einem Zug setzen
//   any      – irgendein legaler Zug (z. B. aus dem Schach ziehen)
//   line     – Zugfolge "sol" (deine Züge und feste Antworten des Gegners abwechselnd)
//   playmate – gegen die Engine in höchstens "max" Zügen Matt setzen
//   promote  – gegen die Engine in höchstens "max" Zügen einen Bauern umwandeln
// "last" = Zug des Gegners, der vor der Übung animiert wird.

function lessonFen(s) {
  if (s.fen) return s.fen;
  if (s.pos == null) return null;
  const b = Array(64).fill('');
  for (const t of s.pos.trim().split(/\s+/).filter(Boolean)) {
    const f = 'abcdefgh'.indexOf(t[1]), r = +t[2] - 1;
    b[(7 - r) * 8 + f] = t[0];
  }
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '', e = 0;
    for (let f = 0; f < 8; f++) {
      const p = b[r * 8 + f];
      if (!p) { e++; continue; }
      if (e) { row += e; e = 0; }
      row += p;
    }
    if (e) row += e;
    rows.push(row);
  }
  return rows.join('/') + ' ' + (s.side || 'w') + ' ' + (s.castle || '-') + ' - 0 1';
}

const LESSONS = [
  {
    id: 'u1', title: 'Das Schachbrett', icon: 'flag', desc: 'Felder, Linien, Reihen und die Grundaufstellung',
    lessons: [
      {
        id: 'brett', title: 'Das Brett', icon: 'grid-3x3', steps: [
          { t: 'info', pos: '', marks: ['h1'], text: 'Schach spielt man auf einem Brett mit **64 Feldern** – 8 mal 8, immer abwechselnd hell und dunkel. Merke dir: **unten rechts ist ein helles Feld**.' },
          { t: 'info', pos: '', marks: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'], text: 'Die senkrechten Spalten heißen **Linien** und haben Buchstaben von **a bis h**. Markiert ist die **e-Linie**.' },
          { t: 'info', pos: '', marks: ['a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4'], text: 'Die waagrechten Zeilen heißen **Reihen** und haben Zahlen von **1 bis 8**. Markiert ist die **4. Reihe**.' },
          { t: 'info', pos: '', marks: ['e4'], text: 'Jedes Feld hat einen Namen: **Buchstabe + Zahl**. Das markierte Feld liegt auf der e-Linie und der 4. Reihe – es heißt **e4**.' },
          { t: 'quiz', pos: '', marks: ['d5'], q: 'Wie heißt das markierte Feld?', opts: ['d5', 'e4', 'c6', 'd4'], a: 0, why: 'd-Linie, 5. Reihe → d5.' },
          { t: 'quiz', pos: '', marks: ['g7'], q: 'Und dieses Feld?', opts: ['g2', 'g7', 'b7', 'f7'], a: 1, why: 'g-Linie, 7. Reihe → g7.' },
          { t: 'quiz', q: 'Wie viele Felder hat ein Schachbrett?', opts: ['32', '64', '81', '100'], a: 1, why: '8 Linien × 8 Reihen = 64 Felder.' }
        ]
      },
      {
        id: 'aufstellung', title: 'Die Aufstellung', icon: 'piece:K', steps: [
          { t: 'info', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', text: 'So beginnt jede Partie. **Weiß** steht unten, **Schwarz** oben. Jeder hat 16 Figuren.' },
          { t: 'info', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', marks: ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2'], text: 'In der zweiten Reihe stehen die **8 Bauern**. Dahinter von außen nach innen: **Turm, Springer, Läufer** – und in der Mitte **Dame und König**.' },
          { t: 'info', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', marks: ['d1', 'd8'], text: 'Merksatz: **Die Dame steht auf ihrer Farbe.** Die weiße Dame auf dem hellen Feld d1, die schwarze auf dem dunklen Feld d8.' },
          { t: 'quiz', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', q: 'Auf welchem Feld steht der weiße König?', opts: ['d1', 'e1', 'f1', 'e2'], a: 1, why: 'Der König steht neben der Dame auf e1.' },
          { t: 'quiz', q: 'Wer macht den ersten Zug?', opts: ['Weiß', 'Schwarz', 'Wer möchte'], a: 0, why: 'Weiß beginnt immer, danach wird abwechselnd gezogen.' }
        ]
      }
    ]
  },
  {
    id: 'u2', title: 'Die Figuren', icon: 'piece:R', desc: 'Wie jede Figur zieht – mit Sterne-Sammeln',
    lessons: [
      {
        id: 'turm', title: 'Der Turm', icon: 'piece:R', steps: [
          { t: 'info', pos: 'Rd4', arrows: [['d4', 'd8'], ['d4', 'd1'], ['d4', 'a4'], ['d4', 'h4']], text: 'Der **Turm** zieht beliebig weit **geradeaus**: nach oben, unten, links oder rechts.' },
          { t: 'collect', pos: 'Ra1', stars: ['a6', 'e6'], text: 'Sammle alle Sterne ein! Tippe auf den Turm und dann auf das Zielfeld (oder ziehe ihn).' },
          { t: 'collect', pos: 'Rh1', stars: ['h8', 'a8', 'a3'], text: 'Super! Hol dir wieder alle Sterne.' },
          { t: 'collect', pos: 'Ra1 Pa4', stars: ['a8'], text: 'Eigene Figuren **blockieren** den Weg – der Turm kann nicht über sie springen. Finde einen Umweg!' },
          { t: 'collect', pos: 'Rd1 pd6 pg6', stars: [], text: 'Gegnerische Figuren kannst du **schlagen**: Ziehe auf ihr Feld. Schlage beide schwarzen Bauern!' },
          { t: 'quiz', q: 'Darf ein Turm schräg ziehen?', opts: ['Ja', 'Nein'], a: 1, why: 'Der Turm zieht nur gerade – schräg zieht der Läufer.' }
        ]
      },
      {
        id: 'laeufer', title: 'Der Läufer', icon: 'piece:B', steps: [
          { t: 'info', pos: 'Bd4', arrows: [['d4', 'h8'], ['d4', 'a7'], ['d4', 'a1'], ['d4', 'g1']], text: 'Der **Läufer** zieht beliebig weit **schräg** (diagonal).' },
          { t: 'collect', pos: 'Bc1', stars: ['f4', 'h6'], text: 'Sammle die Sterne mit dem Läufer!' },
          { t: 'collect', pos: 'Bf1', stars: ['b5', 'e8', 'h5'], text: 'Drei Sterne – los geht’s!' },
          { t: 'info', pos: 'Bc1 Bf1', marks: ['c1', 'f1'], text: 'Ein Läufer bleibt **immer auf seiner Feldfarbe**. Deshalb hat jeder Spieler einen hellfeldrigen und einen dunkelfeldrigen Läufer.' },
          { t: 'collect', pos: 'Bb2 pg7 pd4', stars: ['a3'], text: 'Schlage die Bauern und hol dir den Stern!' },
          { t: 'quiz', q: 'Ein Läufer steht auf einem hellen Feld. Kann er jemals ein dunkles Feld erreichen?', opts: ['Ja', 'Nein'], a: 1, why: 'Schräg ziehen heißt: Die Feldfarbe bleibt immer gleich.' }
        ]
      },
      {
        id: 'dame', title: 'Die Dame', icon: 'piece:Q', steps: [
          { t: 'info', pos: 'Qd4', arrows: [['d4', 'd8'], ['d4', 'd1'], ['d4', 'a4'], ['d4', 'h4'], ['d4', 'h8'], ['d4', 'a7'], ['d4', 'a1'], ['d4', 'g1']], text: 'Die **Dame** ist die stärkste Figur: Sie zieht wie **Turm und Läufer zusammen** – gerade und schräg, beliebig weit.' },
          { t: 'collect', pos: 'Qd1', stars: ['d5', 'h1', 'a4', 'e8'], text: 'Sammle alle Sterne mit der Dame!' },
          { t: 'collect', pos: 'Qa1 pc3 pf6 ph8', stars: ['a8'], text: 'Schlage alle Bauern und hol den Stern!' },
          { t: 'quiz', q: 'Welche Figur ist die stärkste?', opts: ['Turm', 'König', 'Dame', 'Springer'], a: 2, why: 'Die Dame kombiniert Turm und Läufer.' }
        ]
      },
      {
        id: 'koenig', title: 'Der König', icon: 'piece:K', steps: [
          { t: 'info', pos: 'Ke4', marks: ['d3', 'e3', 'f3', 'd4', 'f4', 'd5', 'e5', 'f5'], text: 'Der **König** ist die wichtigste Figur: Verlierst du ihn, verlierst du die Partie. Er zieht nur **ein Feld** weit – in jede Richtung.' },
          { t: 'collect', pos: 'Ke1', stars: ['e3', 'g3'], text: 'Bring den König zu den Sternen – Schritt für Schritt.' },
          { t: 'collect', pos: 'Kd4', stars: ['c5', 'e5', 'e3', 'c3'], text: 'Vier Sterne rund um den König!' },
          { t: 'quiz', q: 'Wie weit darf der König ziehen?', opts: ['Ein Feld', 'Zwei Felder', 'Beliebig weit'], a: 0, why: 'Immer nur ein Feld – dafür in alle Richtungen.' }
        ]
      },
      {
        id: 'springer', title: 'Der Springer', icon: 'piece:N', steps: [
          { t: 'info', pos: 'Nd4', marks: ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'], text: 'Der **Springer** zieht in **L-Form**: zwei Felder geradeaus und eins zur Seite. Er landet dabei immer auf der anderen Feldfarbe.' },
          { t: 'collect', pos: 'Nb1', stars: ['c3', 'd5'], text: 'Hüpf zu den Sternen!' },
          { t: 'collect', pos: 'Ng1', stars: ['f3', 'e5', 'f7'], text: 'Drei Sprünge, drei Sterne.' },
          { t: 'collect', pos: 'Nb1 Pa2 Pb2 Pc2 Pd2', stars: ['c3', 'b5'], text: 'Der Springer ist die **einzige Figur, die über andere springen darf**!' },
          { t: 'collect', pos: 'Na1 pc2 pd4 pf5', stars: [], text: 'Schlage alle schwarzen Bauern mit dem Springer.' },
          { t: 'quiz', pos: 'Ne4', q: 'Wie viele Felder kann dieser Springer erreichen?', opts: ['4', '6', '8'], a: 2, why: 'In der Mitte hat der Springer 8 Ziele – am Rand viel weniger. „Springer am Rand bringt Kummer und Schand!“' }
        ]
      },
      {
        id: 'bauer', title: 'Der Bauer', icon: 'piece:P', steps: [
          { t: 'info', pos: 'Pe2', arrows: [['e2', 'e4']], text: 'Der **Bauer** zieht **nur vorwärts**, ein Feld. Von seinem Startfeld darf er auch **zwei Felder** auf einmal ziehen.' },
          { t: 'collect', pos: 'Pe2', stars: ['e4', 'e6'], text: 'Bring den Bauern zu den Sternen.' },
          { t: 'info', pos: 'Pe4 pd5 pf5 pe5', arrows: [['e4', 'd5'], ['e4', 'f5']], text: 'Schlagen tut der Bauer anders: **schräg nach vorne**, ein Feld. Geradeaus blockiert ihn jede Figur.' },
          { t: 'collect', pos: 'Pb2 pc3 pd4 pe5', stars: [], text: 'Schlage alle schwarzen Bauern!' },
          { t: 'info', pos: 'Pe7', arrows: [['e7', 'e8']], text: 'Erreicht ein Bauer die **letzte Reihe**, verwandelt er sich in eine andere Figur – meistens in eine **Dame**! Das heißt **Umwandlung**.' },
          { t: 'collect', pos: 'Pg6', stars: ['g8'], text: 'Lauf zur letzten Reihe und wähle eine Dame!' },
          { t: 'quiz', q: 'Wie schlägt ein Bauer?', opts: ['Geradeaus', 'Schräg nach vorne', 'Schräg nach hinten'], a: 1, why: 'Bauern schlagen immer schräg nach vorne.' }
        ]
      },
      {
        id: 'figurenmix', title: 'Figuren-Mix', icon: 'target', steps: [
          { t: 'collect', pos: 'Rh1 Nb1', stars: ['c3', 'h7', 'd5'], text: 'Jetzt mit zwei Figuren: Sammle alle Sterne!' },
          { t: 'collect', pos: 'Bc1 Ng1 pe3 ph3', stars: ['f3'], text: 'Läufer und Springer im Team.' },
          { t: 'collect', pos: 'Qd1 Ke1 pd7 pa4 ph5', stars: [], text: 'Räume das Brett ab!' },
          { t: 'quiz', q: 'Welche Figur darf über andere springen?', opts: ['Läufer', 'Springer', 'Dame', 'Turm'], a: 1, why: 'Nur der Springer springt.' }
        ]
      }
    ]
  },
  {
    id: 'u3', title: 'Schlagen & Werte', icon: 'scale', desc: 'Was ist welche Figur wert – und wann lohnt sich ein Tausch?',
    lessons: [
      {
        id: 'werte', title: 'Figurenwerte', icon: 'coins', steps: [
          { t: 'info', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', text: 'Figuren haben unterschiedliche Werte: **Bauer 1**, **Springer 3**, **Läufer 3**, **Turm 5**, **Dame 9**. Der König ist unbezahlbar.' },
          { t: 'quiz', q: 'Wie viele Punkte ist eine Dame wert?', opts: ['5', '9', '3', '10'], a: 1, why: 'Dame = 9 Punkte.' },
          { t: 'quiz', q: 'Was ist mehr wert?', opts: ['Ein Turm', 'Ein Läufer'], a: 0, why: 'Turm 5 > Läufer 3.' },
          { t: 'quiz', q: 'Du gibst einen Springer (3) und bekommst dafür einen Turm (5). Gutes Geschäft?', opts: ['Ja, +2 für mich', 'Nein, −2 für mich'], a: 0, why: '5 − 3 = +2. Das nennt man „die Qualität gewinnen“.' },
          { t: 'move', pos: 'Kg1 Ra1 Nc3 Pg2 Ph2 kg8 qd5 pe4 rb5 pg7 ph7', text: 'Der Springer kann drei Figuren schlagen. **Nimm die wertvollste!**', ok: ['c3d5'], why: 'Die Dame (9) ist am meisten wert!', good: 'Die Dame geschlagen – 9 Punkte!' }
        ]
      },
      {
        id: 'haengend', title: 'Hängende Figuren', icon: 'gift', steps: [
          { t: 'info', pos: 'Kg1 Nf3 kg8 nd4 bg5 ph6', arrows: [['f3', 'd4'], ['f3', 'g5']], marks: ['d4'], text: 'Eine Figur **hängt**, wenn sie angegriffen und **nicht gedeckt** ist. Hängende Figuren kannst du **gratis** schlagen.' },
          { t: 'move', pos: 'Kg1 Nf3 Pf2 Pg2 Ph2 kg8 nd4 bg5 ph6 pf7 pg7', text: 'Welche Figur kannst du **gratis** schlagen?', ok: ['f3d4'], why: 'Der Läufer auf g5 ist vom Bauern h6 gedeckt – nach Sxg5 hxg5 hättest du nur getauscht.', good: 'Genau! Der Springer auf d4 war ungedeckt.' },
          { t: 'quiz', pos: 'kg8 ne5 pd6', marks: ['e5'], q: 'Ist der schwarze Springer auf e5 gedeckt?', opts: ['Ja', 'Nein'], a: 0, why: 'Der Bauer d6 deckt e5 (er schlägt schräg nach vorne – für Schwarz nach unten).' },
          { t: 'move', pos: 'Kg1 Bc4 Pg2 Ph2 kh8 rf7 qd8 pg7 ph7', text: 'Ein schwarzer Turm hängt. Schlag ihn!', ok: ['c4f7'], why: 'Schau, welche Figur der Läufer schlagen kann und ob sie gedeckt ist.', good: 'Ein ganzer Turm gratis!' }
        ]
      },
      {
        id: 'tauschen', title: 'Tauschen', icon: 'refresh-cw', steps: [
          { t: 'info', text: 'Schlagen und Zurückschlagen nennt man **Abtausch**. Faustregel: Tausche nur, wenn du **gleich viel oder mehr** bekommst als du hergibst.' },
          { t: 'quiz', q: 'Dein Turm (5) schlägt einen gedeckten Läufer (3), danach wird dein Turm geschlagen. Ergebnis?', opts: ['+2 für mich', '−2 für mich', 'Ausgeglichen'], a: 1, why: 'Du bekommst 3 und verlierst 5.' },
          { t: 'quiz', q: 'Springer gegen Läufer tauschen ist …', opts: ['ausgeglichen', 'ein Gewinn', 'ein Verlust'], a: 0, why: 'Beide sind etwa 3 Punkte wert.' },
          { t: 'quiz', pos: 'Kg1 Qd1 Pg2 Ph2 kg8 nd5 pc6 pg7 ph7', arrows: [['d1', 'd5']], q: 'Der Springer auf d5 ist vom Bauern c6 gedeckt. Solltest du ihn mit der Dame schlagen?', opts: ['Ja, ein Springer ist gratis', 'Nein, ich verliere die Dame'], a: 1, why: 'Dxd5 cxd5 – du gibst 9 Punkte für 3. Ein schlechtes Geschäft!' }
        ]
      }
    ]
  },
  {
    id: 'u4', title: 'Schach & Matt', icon: 'crown', desc: 'Den König angreifen und die Partie gewinnen',
    lessons: [
      {
        id: 'schach', title: 'Schach geben', icon: 'zap', steps: [
          { t: 'info', pos: 'Kg1 Re1 ke8', side: 'b', arrows: [['e1', 'e8']], text: 'Wird der König angegriffen, steht er **im Schach**. Der Gegner muss sofort reagieren!' },
          { t: 'check', pos: 'Kg1 Ra1 ke8 pe7', text: 'Gib Schach mit dem Turm!' },
          { t: 'check', pos: 'Kg1 Nd5 ke8', text: 'Gib Schach mit dem Springer!' },
          { t: 'check', pos: 'Kg1 Bf1 kh7', text: 'Gib Schach mit dem Läufer!' },
          { t: 'check', pos: 'Kg1 Qd1 ka8', text: 'Und jetzt mit der Dame!' }
        ]
      },
      {
        id: 'ausdemschach', title: 'Raus aus dem Schach', icon: 'shield', steps: [
          { t: 'info', text: 'Es gibt **drei Wege** aus dem Schach:\n1. Den **König wegziehen**\n2. Eine Figur **dazwischenstellen**\n3. Den **Angreifer schlagen**' },
          { t: 'any', pos: 'Ke1 kg8 re8', text: 'Dein König steht im Schach! **Zieh ihn weg.**' },
          { t: 'move', pos: 'Kg1 Bc1 Pf2 Ph2 kg8 qg5', text: '**Schlage** die Figur, die Schach gibt!', ok: ['c1g5'], why: 'Mit dem Läufer kannst du die Dame schlagen – das ist viel besser!', good: 'Dame geschlagen – stark!' },
          { t: 'move', pos: 'Kg1 Pf2 Pg2 Ph2 Bd3 kg8 ra1', text: 'Der König kann nicht weg. **Stelle eine Figur dazwischen!**', ok: ['d3f1', 'd3b1'], why: 'Der Läufer kann sich auf die erste Reihe stellen.', good: 'Gerettet!' },
          { t: 'quiz', q: 'Darfst du einen Zug machen, nach dem dein König im Schach steht?', opts: ['Ja', 'Nein, niemals'], a: 1, why: 'Den eigenen König ins Schach zu stellen ist nicht erlaubt.' }
        ]
      },
      {
        id: 'matt', title: 'Schachmatt', icon: 'trophy', steps: [
          { t: 'info', pos: 'Ra8 Kg1 kg8 pf7 pg7 ph7', side: 'b', arrows: [['a8', 'g8']], text: '**Schachmatt**: Der König steht im Schach und kann sich auf keine Weise retten. Damit ist die Partie **gewonnen**!' },
          { t: 'quiz', pos: 'Ra8 Kg1 kg8 pf7 pg7 ph6', side: 'b', q: 'Schwarz steht im Schach. Ist das Matt?', opts: ['Ja, Matt', 'Nein, kein Matt'], a: 1, why: 'Der König kann nach h7 flüchten – dort ist ein Fluchtfeld frei.' },
          { t: 'mate', pos: 'Kg1 Ra1 Pf2 Pg2 Ph2 kg8 pf7 pg7 ph7', text: 'Setze Matt in einem Zug!' },
          { t: 'mate', pos: 'Kg6 Qe1 kh8', text: 'Dame und König arbeiten zusammen: Setze Matt!' },
          { t: 'mate', pos: 'Kb6 Qc5 ka8', text: 'Noch ein Matt mit der Dame!' }
        ]
      },
      {
        id: 'patt', title: 'Patt', icon: 'handshake', steps: [
          { t: 'info', pos: 'Kb6 Qc7 ka8', side: 'b', text: '**Patt**: Der Spieler am Zug hat **keinen legalen Zug**, steht aber **nicht im Schach**. Dann endet die Partie **unentschieden (Remis)**!' },
          { t: 'quiz', pos: 'Kb6 Qc7 ka8', side: 'b', q: 'Schwarz ist am Zug. Was liegt vor?', opts: ['Schachmatt', 'Patt – Remis', 'Schach'], a: 1, why: 'Der schwarze König steht nicht im Schach, kann aber nicht ziehen.' },
          { t: 'quiz', q: 'Wer gewinnt bei einem Patt?', opts: ['Der, der Patt setzt', 'Niemand – Remis'], a: 1, why: 'Patt ist ein Unentschieden. Ärgerlich, wenn man eigentlich gewonnen hätte!' },
          { t: 'mate', pos: 'Kb6 Qd7 ka8', text: 'Setze Matt – aber **Vorsicht vor Patt**!' }
        ]
      }
    ]
  },
  {
    id: 'u5', title: 'Spezialregeln', icon: 'sparkles', desc: 'Rochade, en passant und Umwandlung',
    lessons: [
      {
        id: 'rochade', title: 'Die Rochade', icon: 'castle', steps: [
          { t: 'info', pos: 'Ke1 Ra1 Rh1 ke8', castle: 'KQ', arrows: [['e1', 'g1'], ['h1', 'f1']], text: 'Einmal pro Partie darf der König **rochieren**: Er zieht **zwei Felder** Richtung Turm, und der Turm springt über ihn. So bringst du den König in Sicherheit.' },
          { t: 'move', pos: 'Ke1 Ra1 Rh1 Pa2 Pb2 Pc2 Pf2 Pg2 Ph2 ke8', castle: 'KQ', text: 'Mach die **kurze Rochade**: Ziehe den König zwei Felder nach rechts.', ok: ['e1g1'], why: 'Ziehe den König von e1 nach g1.', good: 'Der König ist sicher!' },
          { t: 'move', pos: 'Ke1 Ra1 Rh1 Pa2 Pb2 Pc2 Pf2 Pg2 Ph2 ke8', castle: 'KQ', text: 'Und jetzt die **lange Rochade**: Der König zieht zwei Felder nach links.', ok: ['e1c1'], why: 'Ziehe den König von e1 nach c1.', good: 'Perfekt!' },
          { t: 'info', text: 'Rochieren darfst du nur, wenn:\n• König und Turm **noch nicht gezogen** haben\n• **nichts dazwischen** steht\n• der König **nicht im Schach** steht und **über kein angegriffenes Feld** zieht' },
          { t: 'quiz', pos: 'Ke1 Rh1 ke8 bc4', castle: 'K', arrows: [['c4', 'f1']], q: 'Darf Weiß kurz rochieren?', opts: ['Ja', 'Nein'], a: 1, why: 'Der Läufer greift f1 an – der König darf nicht über ein angegriffenes Feld ziehen.' }
        ]
      },
      {
        id: 'enpassant', title: 'En passant', icon: 'ghost', steps: [
          { t: 'info', fen: '6k1/8/8/3pP3/8/8/8/6K1 w - d6 0 1', arrows: [['e5', 'd6']], marks: ['d5'], text: 'Zieht ein gegnerischer Bauer **zwei Felder** und landet **direkt neben** deinem Bauern, darfst du ihn im nächsten Zug **„im Vorbeigehen“** schlagen – als wäre er nur ein Feld gezogen.' },
          { t: 'move', fen: '6k1/3p4/8/4P3/8/8/8/6K1 b - - 0 1', last: 'd7d5', text: 'Schwarz hat gerade d7–d5 gezogen. Schlage **en passant**!', ok: ['e5d6'], why: 'Dein Bauer auf e5 schlägt schräg nach d6 – der schwarze Bauer verschwindet.', good: 'En passant geschlagen – eine Regel, die viele nicht kennen!' },
          { t: 'quiz', q: 'Wann darf man en passant schlagen?', opts: ['Jederzeit', 'Nur direkt im nächsten Zug', 'Nur mit dem König'], a: 1, why: 'Die Chance gibt es nur sofort – im nächsten Zug ist sie weg.' }
        ]
      },
      {
        id: 'umwandlung', title: 'Umwandlung', icon: 'sparkles', steps: [
          { t: 'move', pos: 'Kg1 Pc7 kg8', text: 'Verwandle den Bauern in eine **Dame**!', ok: ['c7c8q'], why: 'Wähle beim Umwandeln die Dame – sie ist am stärksten.', good: 'Eine neue Dame!' },
          { t: 'mate', pos: 'Kg6 Pe7 kh8', text: 'Wandle um und setze dabei Matt!' },
          { t: 'quiz', q: 'Kann man eine zweite Dame bekommen?', opts: ['Ja, durch Umwandlung', 'Nein, nie'], a: 0, why: 'Du kannst so viele Damen haben, wie du Bauern umwandelst!' }
        ]
      }
    ]
  },
  {
    id: 'u6', title: 'Taktik-Grundlagen', icon: 'swords', desc: 'Gabel, Fesselung, Spieß und Grundreihenmatt',
    lessons: [
      {
        id: 'gabel', title: 'Die Gabel', icon: 'utensils', steps: [
          { t: 'info', pos: 'Kg1 Nc7 ke8 ra8', side: 'b', arrows: [['c7', 'e8'], ['c7', 'a8']], text: 'Eine **Gabel** greift **zwei Figuren gleichzeitig** an. Der Gegner kann nur eine retten!' },
          { t: 'line', fen: 'r3k3/8/8/1N6/8/8/8/6K1 w - - 0 1', sol: ['b5c7', 'e8d7', 'c7a8'], text: 'Finde die Springergabel gegen König und Turm – und hol dir dann den Turm!' },
          { t: 'move', fen: '6k1/8/2n1b3/8/3P4/8/8/3Q2K1 w - - 0 1', text: 'Auch Bauern können gabeln! Greife **zwei Figuren** mit einem Bauernzug an.', ok: ['d4d5'], why: 'Ein Bauer auf d5 greift c6 und e6 gleichzeitig an.', good: 'Bauerngabel – eine Figur ist verloren!' },
          { t: 'quiz', q: 'Welche Figur ist besonders gut für Gabeln?', opts: ['Springer', 'Turm', 'König'], a: 0, why: 'Der Springer greift oft überraschend zwei Figuren an.' }
        ]
      },
      {
        id: 'fesselung', title: 'Die Fesselung', icon: 'pin', steps: [
          { t: 'info', pos: 'Kg1 Bb5 ke8 nc6', arrows: [['b5', 'e8']], text: 'Eine **gefesselte** Figur darf nicht ziehen, weil dahinter eine wertvollere Figur steht. Hier kann der Springer nicht weg – sonst stünde sein König im Schach.' },
          { t: 'move', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', text: '**Fessle** den schwarzen Springer an den König!', ok: ['f1b5'], why: 'Der Läufer nach b5 – dann steht der Springer c6 vor dem König.', good: 'Die „Spanische Partie“ – eine der bekanntesten Eröffnungen!' },
          { t: 'move', pos: 'Kh1 Rd1 Pc3 Pg2 Ph2 kg8 nd5 qd8 pg7 ph7', text: 'Der Springer d5 ist an die Dame **gefesselt**: Zieht er weg, schlägt dein Turm die Dame. **Greife ihn mit einem Bauern an!**', ok: ['c3c4'], why: 'Der Bauer c3 kann nach c4 ziehen und greift dann d5 an.', good: 'Der Springer kann nicht fliehen – er geht verloren!' },
          { t: 'quiz', q: 'Eine Figur ist an den König gefesselt. Darf sie ziehen?', opts: ['Ja', 'Nein – der König stünde im Schach'], a: 1, why: 'Das wäre ein illegaler Zug.' }
        ]
      },
      {
        id: 'spiess', title: 'Der Spieß', icon: 'sword', steps: [
          { t: 'info', text: 'Beim **Spieß** greifst du eine wertvolle Figur an. Weicht sie aus, schlägst du die Figur **dahinter**. Wie eine Fesselung – nur andersherum.' },
          { t: 'line', fen: '1q6/8/8/4k3/8/8/8/K5B1 w - - 0 1', sol: ['g1h2', 'e5d5', 'h2b8'], text: 'König und Dame stehen auf einer Diagonale. **Spieß** sie auf!' },
          { t: 'line', pos: 'Kb2 Ra1 kd5 rh5', sol: ['a1a5', 'd5e6', 'a5h5'], text: 'Jetzt mit dem Turm: Gib Schach so, dass danach der schwarze Turm fällt!' }
        ]
      },
      {
        id: 'grundreihe', title: 'Grundreihenmatt', icon: 'door-open', steps: [
          { t: 'info', pos: 'Kg1 Re8 kg8 pf7 pg7 ph7', side: 'b', text: 'Der häufigste Matt-Trick: Der König ist von **eigenen Bauern eingesperrt**, und ein Turm oder die Dame setzt auf der **Grundreihe** Matt.' },
          { t: 'mate', fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', text: 'Setze Grundreihenmatt!' },
          { t: 'mate', fen: '6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1', text: 'Diesmal mit der Dame!' },
          { t: 'mate', fen: '2r3k1/5ppp/8/8/8/8/5PPP/2R1R1K1 w - - 0 1', text: 'Schwarz deckt die Grundreihe mit einem Turm. Trotzdem Matt?' },
          { t: 'quiz', q: 'Wie schützt man sich gegen Grundreihenmatt?', opts: ['Ein „Luftloch“ machen, z. B. h3', 'Den König in die Mitte stellen', 'Gar nicht'], a: 0, why: 'Ein Bauernzug wie h3 gibt dem König ein Fluchtfeld.' }
        ]
      }
    ]
  },
  {
    id: 'u7', title: 'Die Eröffnung', icon: 'rocket', desc: 'Gut ins Spiel starten – und Fallen vermeiden',
    lessons: [
      {
        id: 'prinzipien', title: 'Goldene Regeln', icon: 'scroll', steps: [
          { t: 'info', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', marks: ['d4', 'e4', 'd5', 'e5'], text: 'Drei goldene Regeln für den Start:\n1. **Kämpfe ums Zentrum** (e4, d4, e5, d5)\n2. **Entwickle** Springer und Läufer\n3. **Rochiere** früh' },
          { t: 'move', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', text: 'Erster Zug: **Besetze das Zentrum** mit einem Bauern!', ok: ['e2e4', 'd2d4'], why: 'Am besten e2–e4 oder d2–d4 – zwei Felder in die Mitte.', good: 'Ein klassischer Start!' },
          { t: 'move', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', text: '**Entwickle einen Springer** Richtung Zentrum!', ok: ['g1f3', 'b1c3'], why: 'Springer nach f3 oder c3 – Richtung Mitte.', good: 'Gut entwickelt!' },
          { t: 'move', fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', text: 'Alles entwickelt – bring deinen König in Sicherheit!', ok: ['e1g1'], why: 'Die kurze Rochade: König von e1 nach g1.', good: 'Sicher rochiert!' },
          { t: 'quiz', q: 'Solltest du früh mit der Dame angreifen?', opts: ['Ja, sie ist am stärksten', 'Nein, sie wird leicht gejagt'], a: 1, why: 'Gegnerische Figuren können die Dame mit Tempo angreifen.' }
        ]
      },
      {
        id: 'schaefer', title: 'Der Schäferzug', icon: 'triangle-alert', steps: [
          { t: 'info', fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', arrows: [['h5', 'f7'], ['c4', 'f7']], marks: ['f7'], text: 'Ein bekannter Anfängertrick: **Dame und Läufer** greifen **f7** an. Wer ihn kennt, fällt nie darauf herein!' },
          { t: 'move', fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', text: 'Du spielst Schwarz: **Verteidige f7!**', ok: ['d8e7', 'd8f6', 'g7g6'], why: 'Decke f7 mit der Dame (De7/Df6) oder blockiere mit g6.', good: 'Falle entschärft!' },
          { t: 'mate', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', text: 'Und jetzt als Weiß – Schwarz hat nicht aufgepasst. Setze **Schäfermatt**!' }
        ]
      }
    ]
  },
  {
    id: 'u8', title: 'Matt setzen', icon: 'trophy', desc: 'Gewonnene Endspiele auch wirklich gewinnen',
    lessons: [
      {
        id: 'damenmatt', title: 'Damenmatt', icon: 'piece:Q', steps: [
          { t: 'info', text: 'Mit **Dame und König** gewinnst du immer:\n1. Drücke den König mit der Dame **an den Rand**\n2. Hol deinen **König heran**\n3. Setze Matt – und **pass auf, kein Patt** zu machen!' },
          { t: 'mate', pos: 'Kb6 Qh2 ka8', text: 'Die Vorbereitung ist geschafft. Setze Matt!' },
          { t: 'playmate', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', max: 25, text: 'Jetzt im echten Spiel gegen den Computer: **Setze Matt** in höchstens 25 Zügen!' }
        ]
      },
      {
        id: 'turmmatt', title: 'Turmmatt', icon: 'piece:R', steps: [
          { t: 'info', text: 'Auch mit **Turm und König** kann man Matt setzen. Der Turm sperrt dem König Reihen ab, dein König hilft – Stück für Stück an den Rand.' },
          { t: 'mate', pos: 'Kg6 Ra1 kg8', text: 'Setze Matt mit dem Turm!' },
          { t: 'playmate', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', max: 40, text: 'Die Meisterprüfung: **Setze Matt** mit Turm und König in höchstens 40 Zügen!' }
        ]
      }
    ]
  },
  {
    id: 'u9', title: 'Taktik II', icon: 'target', desc: 'Abzugsangriff, Doppelangriff und Doppelschach',
    lessons: [
      {
        id: 'abzug', title: 'Abzugsangriff', icon: 'bomb', steps: [
          { t: 'info', pos: 'Kg1 Rd1 Bd3 kg8 qd8', arrows: [['d1', 'd8']], marks: ['d3'], text: 'Beim **Abzugsangriff** zieht eine Figur weg und gibt dadurch den Weg für eine andere frei. Hier versperrt der Läufer d3 die Linie des Turms zur Dame.' },
          { t: 'line', pos: 'Kg1 Rd1 Bd3 Pf2 Pg2 Ph2 kg8 qd8 nb8 pf7 pg7 ph7', sol: ['d3h7', 'g8h7', 'd1d8'], text: 'Zieh den Läufer **mit Schach** weg – dann ist die Dame nicht mehr zu retten!' },
          { t: 'info', text: 'Ein **Doppelschach** ist ein Abzugsangriff, bei dem **beide** Figuren Schach geben. Dagegen hilft nur eins: **Der König muss ziehen.**' },
          { t: 'quiz', q: 'Bei einem Doppelschach muss der König …', opts: ['ziehen', 'eine Figur dazwischenstellen', 'einen Angreifer schlagen lassen'], a: 0, why: 'Zwei Angreifer kann man nicht gleichzeitig blocken oder schlagen.' }
        ]
      },
      {
        id: 'doppelangriff', title: 'Doppelangriff', icon: 'split', steps: [
          { t: 'info', text: 'Die **Dame** ist die beste Figur für **Doppelangriffe**: Sie greift in acht Richtungen gleichzeitig an. Besonders stark: Schach **und** Angriff auf eine ungedeckte Figur.' },
          { t: 'move', pos: 'Kg1 Qd1 Pf2 Pg2 Ph2 kg8 ra5 pf6 pg7 ph7', text: 'Gib Schach und greife gleichzeitig den Turm an!', ok: ['d1d8'], why: 'Von d8 aus greift die Dame den König **und** über die Diagonale den Turm a5 an. (Vorsicht: Auf d5 könnte der Turm die Dame schlagen!)', good: 'Doppelangriff – der Turm fällt!' },
          { t: 'line', pos: 'Kg1 Nb5 Pf2 Pg2 Ph2 ke8 qc8 pa7 pb7 pf7 pg7 ph7', sol: ['b5d6', 'e8e7', 'd6c8'], text: 'Gib mit dem Springer **Schach** und greife dabei die Dame an – dann schlag sie!' },
          { t: 'quiz', q: 'Was macht einen Doppelangriff so stark?', opts: ['Der Gegner kann nur eine Drohung abwehren', 'Er ist immer Matt', 'Er gewinnt immer die Dame'], a: 0, why: 'Zwei Drohungen – aber nur ein Zug zum Verteidigen.' }
        ]
      }
    ]
  },
  {
    id: 'u10', title: 'Mattbilder', icon: 'skull', desc: 'Typische Mattmuster, die man kennen muss',
    lessons: [
      {
        id: 'ersticktes', title: 'Ersticktes Matt', icon: 'skull', steps: [
          { t: 'info', pos: 'Kg1 Nf7 kh8 rg8 pg7 ph7', side: 'b', arrows: [['f7', 'h8']], text: 'Beim **erstickten Matt** ist der König von **eigenen Figuren** umzingelt – und ein Springer setzt Matt.' },
          { t: 'mate', pos: 'Kg1 Ne5 Pg2 Ph2 kh8 rg8 pg7 ph7', text: 'Setze ersticktes Matt!' },
          { t: 'line', pos: 'Kg1 Qd5 Nh6 Pf2 Pg2 Ph2 kh8 rf8 pg7 ph7', sol: ['d5g8', 'f8g8', 'h6f7'], text: 'Das berühmte **Damenopfer**: Opfere die Dame und setze danach ersticktes Matt!' }
        ]
      },
      {
        id: 'damenmuster', title: 'Dame + Helfer', icon: 'crosshair', steps: [
          { t: 'info', text: 'Die Dame setzt oft Matt, wenn eine **andere Figur sie deckt** – der König kann sie dann nicht schlagen. Das nennt man auch den „Kuss des Todes“.' },
          { t: 'mate', pos: 'Kg1 Qh6 Pf6 Pg2 Ph2 kg8 rf8 ph7 pa7', text: 'Der Bauer f6 hilft der Dame. Setze Matt!' },
          { t: 'mate', pos: 'Kg1 Qh5 Bd3 Pg2 Ph2 kg8 rf8 pf7 pg7', text: 'Dame und Läufer zielen auf h7. Setze Matt!' }
        ]
      },
      {
        id: 'treppe', title: 'Treppenmatt', icon: 'route', steps: [
          { t: 'info', text: 'Mit **zwei Türmen** geht Matt ganz ohne König: Ein Turm sperrt eine Reihe ab, der andere gibt Schach – abwechselnd, wie eine **Treppe**.' },
          { t: 'mate', pos: 'Kg1 Ra7 Rb1 kh8', text: 'Ein Turm sperrt die 7. Reihe. Setze Matt mit dem anderen!' },
          { t: 'playmate', fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1', max: 15, text: 'Setze mit den zwei Türmen Matt – in höchstens 15 Zügen!' }
        ]
      }
    ]
  },
  {
    id: 'u11', title: 'Endspiel', icon: 'piece:K', desc: 'Bauern umwandeln und Könige aktiv nutzen',
    lessons: [
      {
        id: 'quadrat', title: 'Quadratregel', icon: 'square-check', steps: [
          { t: 'info', pos: 'Kh1 Pa4 ke5', marks: ['a4', 'b4', 'c4', 'd4', 'e4', 'a8', 'e8', 'a5', 'a6', 'a7', 'b8', 'c8', 'd8', 'e5', 'e6', 'e7'], text: 'Holt der König einen Bauern noch ein? Zeichne ein **Quadrat** vom Bauern bis zur letzten Reihe. Kann der König in dieses Quadrat ziehen, holt er den Bauern ein.' },
          { t: 'quiz', pos: 'Kh1 Pa4 kf5', side: 'b', q: 'Schwarz ist am Zug. Holt der König den Bauern ein?', opts: ['Ja', 'Nein'], a: 0, why: 'Mit Ke5 (oder Ke4) betritt der König das Quadrat a4–e8.' },
          { t: 'quiz', pos: 'Kh1 Pa4 kg5', side: 'b', q: 'Und jetzt? Holt der König den Bauern ein?', opts: ['Ja', 'Nein'], a: 1, why: 'Von g5 erreicht der König das Quadrat (Linie e oder näher) nicht mehr rechtzeitig.' }
        ]
      },
      {
        id: 'umwandeln', title: 'Bauer durchbringen', icon: 'crown', steps: [
          { t: 'info', text: 'Im Endspiel wird der **König zur Kampffigur**. Regel: Mit dem König **vor** dem eigenen Bauern gewinnt man meistens. Stehen sich die Könige mit einem Feld Abstand gegenüber, nennt man das **Opposition**.' },
          { t: 'quiz', q: 'Wohin gehört der König im Bauernendspiel?', opts: ['Vor den eigenen Bauern', 'Hinter den eigenen Bauern', 'In die Ecke'], a: 0, why: 'Vor dem Bauern bahnt der König ihm den Weg.' },
          { t: 'promote', fen: '4k3/8/4K3/8/4P3/8/8/8 w - - 0 1', max: 20, text: 'Führe den Bauern zur **Dame** – gegen den Computer! (höchstens 20 Züge)' }
        ]
      }
    ]
  },
  {
    id: 'u12', title: 'Strategie', icon: 'brain', desc: 'Gute Felder, offene Linien und Pläne',
    lessons: [
      {
        id: 'linien', title: 'Offene Linien', icon: 'signpost', steps: [
          { t: 'info', text: 'Eine **offene Linie** hat keine Bauern. **Türme** gehören auf offene Linien – dort sind sie am stärksten.' },
          { t: 'move', pos: 'Kg1 Rf1 Pa2 Pb2 Pc2 Pf2 Pg2 Ph2 kg8 rf8 pa7 pb7 pc7 pf7 pg7 ph7', text: 'Stelle deinen Turm auf eine **offene Linie**!', ok: ['f1d1', 'f1e1'], why: 'Die d- und e-Linie sind frei von Bauern.', good: 'Der Turm kontrolliert jetzt die ganze Linie.' },
          { t: 'quiz', q: 'Was ist eine offene Linie?', opts: ['Eine Linie ohne Bauern', 'Eine Linie ohne Türme', 'Die a- und h-Linie'], a: 0, why: 'Ohne Bauern können Türme die Linie ungehindert nutzen.' }
        ]
      },
      {
        id: 'vorposten', title: 'Vorposten', icon: 'castle', steps: [
          { t: 'info', text: 'Ein **Vorposten** ist ein starkes Feld, das von einem eigenen Bauern gedeckt ist und **von keinem gegnerischen Bauern angegriffen** werden kann. Springer lieben Vorposten!' },
          { t: 'move', pos: 'Kg1 Nc3 Pe4 Pa2 Pb2 Pf2 Pg2 Ph2 kg8 bc8 pd6 pe5 pa6 pb7 pg7 ph7', text: 'Stelle den Springer auf einen **Vorposten**!', ok: ['c3d5'], why: 'Auf d5 ist der Springer vom Bauern e4 gedeckt – und kein schwarzer Bauer kann ihn vertreiben.', good: 'Ein Springer auf d5 ist ein Monster!' },
          { t: 'quiz', q: 'Deine Bauern stehen alle auf hellen Feldern. Welcher Läufer ist „schlecht“?', opts: ['Der hellfeldrige', 'Der dunkelfeldrige'], a: 0, why: 'Er wird von den eigenen Bauern blockiert. Ein guter Läufer hat freie Bahn.' },
          { t: 'quiz', q: 'Was ist ein „Isolani“?', opts: ['Ein Bauer ohne Nachbarbauern', 'Ein König ohne Schutz', 'Eine Figur am Rand'], a: 0, why: 'Ein isolierter Bauer kann nicht von anderen Bauern gedeckt werden.' }
        ]
      }
    ]
  }
];

// Endspiel-Trainer: Technik-Übungen gegen die Engine
//   playmate – Matt setzen, promote – Bauern umwandeln, hold – Remis halten (user = Farbe des Lernenden)
const ENDGAMES = [
  { id: 'eg-dame', title: 'Dame gegen König', icon: 'piece:Q', level: 'Leicht',
    info: 'Dränge den König mit der Dame zurück (Springer-Abstand halten!), hol deinen König heran und setze am Rand Matt. **Vorsicht vor Patt.**',
    step: { t: 'playmate', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', max: 25, text: 'Setze Matt in höchstens 25 Zügen!' } },
  { id: 'eg-zweitürme', title: 'Zwei Türme (Treppe)', icon: 'route', level: 'Leicht',
    info: 'Die Türme wechseln sich ab: Einer sperrt eine Reihe, der andere gibt Schach. Halte die Türme weit weg vom König, damit er sie nicht angreifen kann.',
    step: { t: 'playmate', fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1', max: 15, text: 'Setze mit den Türmen Matt in höchstens 15 Zügen!' } },
  { id: 'eg-turm', title: 'Turm gegen König', icon: 'piece:R', level: 'Mittel',
    info: 'Der Turm schneidet den König ab, dein König geht in **Opposition**. Dann Schach geben – Reihe für Reihe, bis der König am Rand steht.',
    step: { t: 'playmate', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', max: 35, text: 'Setze Matt in höchstens 35 Zügen!' } },
  { id: 'eg-bauer1', title: 'Bauer mit König davor', icon: 'piece:P', level: 'Leicht',
    info: 'Steht dein König **vor** dem Bauern, gewinnst du: Erst Platz schaffen, dann den Bauern nachziehen. Achte darauf, nicht Patt zu setzen.',
    step: { t: 'promote', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', max: 15, text: 'Bring den Bauern zur Dame!' } },
  { id: 'eg-bauer2', title: 'Bauer: König zwei Felder vorn', icon: 'crown', level: 'Mittel',
    info: 'Ist dein König zwei Reihen vor dem Bauern, gewinnst du immer – egal wer am Zug ist. Halte die **Opposition** und lass dich nicht verdrängen.',
    step: { t: 'promote', fen: '8/8/4k3/8/4K3/8/4P3/8 w - - 0 1', max: 25, text: 'Bring den Bauern zur Dame!' } },
  { id: 'eg-halten', title: 'Remis halten', icon: 'shield', level: 'Mittel',
    info: 'Du verteidigst mit Schwarz. Bleib mit dem König **vor** dem Bauern und halte die **Opposition**: Zieht der weiße König, stell dich ihm direkt gegenüber.',
    step: { t: 'hold', fen: '8/4k3/8/4K3/4P3/8/8/8 w - - 0 1', user: 'b', max: 15, text: 'Halte 15 Züge lang das Remis – lass den Bauern nicht durch!' } },
  { id: 'eg-lucena', title: 'Lucena-Stellung', icon: 'milestone', level: 'Schwer',
    info: 'Die wichtigste Turmendspiel-Technik: Bau mit deinem Turm eine **Brücke** (z. B. Turm auf die 4. Reihe), damit dein König aus den Schachs entkommt und der Bauer durchläuft.',
    step: { t: 'promote', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', max: 30, text: 'Bring den Bauern durch – baue die Brücke!' } }
];

if (typeof module !== 'undefined' && module.exports) module.exports = { LESSONS, lessonFen, ENDGAMES };
