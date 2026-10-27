# Schach-Trainer ♞

Schach lernen, komplett offline und kostenlos: Bots, Rätsel und Partieanalyse.

## Am Mac
`index.html` doppelklicken.

## Aufs iPhone
1. Auf dem iPhone in **Safari** die GitHub-Pages-Adresse öffnen.
2. Unten auf **Teilen** (Quadrat mit Pfeil) tippen und **„Zum Home-Bildschirm“** wählen.
3. Die App einmal öffnen, solange du Internet hast. Danach läuft sie auch offline.

Fortschritt (Rätsel-Wertung, Partien) wird auf dem jeweiligen Gerät gespeichert.

## Funktionen
- **Übersicht**: Statistiken, Tage-Serie, Bot-Leiter, letzte Partien
- **Lernen**: Lernpfad im Duolingo-Stil mit 12 Kapiteln und 39 Lektionen, vom Brett bis zur Strategie.
  Wiederholungen nach jedem Kapitel, Übungs-Mix, adaptiver Einstufungstest und „Springen“ zu späteren Kapiteln
- **Eröffnungen**: 15 Eröffnungen mit 34 Linien, nach Elo-Bereich empfohlen. Ansehen oder Zug für Zug üben,
  mit Wiederholungen in wachsenden Abständen (1, 3, 7, 14 und 30 Tage)
- **Spielen**: 10 Bots von ca. 400 bis 2300 Elo oder zu zweit an einem Gerät. Mit Live-Zugbewertung
  (Brillant … Patzer), Tipp, Zurücknehmen und einstellbarem Bot-Tempo
- **Rätsel**: 315 Rätsel, die sich deiner Wertung anpassen
- **Analyse**: Genauigkeit, geschätzte Elo, Bewertungsgraph, bessere Züge, PGN-Import
- **Figuren**: 10 Figurensätze zur Auswahl (🎨)

## Prüf-Skripte (Node.js)
```
node tools/check-lessons.js    # prüft alle Lernpfad-Übungen mit der Engine
node tools/check-openings.js   # prüft alle Eröffnungslinien
```

## Lizenzen
Die Figurensätze stammen aus dem lichess.org-Projekt und stehen unter freien Lizenzen
(GPLv2+, MIT, Apache 2.0, CC BY 4.0, CC0). Details stehen in `pieces/LIZENZEN.md`.

## App aktualisieren
Nach Änderungen in `sw.js` die `VERSION` erhöhen und danach:
```
git add -A && git commit -m "Update" && git push
```

## Mehr Rätsel erzeugen (Node.js)
```
cd tools
node genpuzzles.js 50 part8.json
node build-puzzles.js
```
