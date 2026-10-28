# Chesster

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
- **Lernen**: Lernpfad mit 12 Kapiteln und 36 Lektionen, Wiederholungen, Übungs-Mix, Springen.
  Einstufungspartie gegen einen adaptiven Bot. **Endspiel-Trainer** mit 7 Techniken gegen die Engine
  (Dame, Turm, zwei Türme, Bauernendspiele, Remis halten, Lucena)
- **Eröffnungen**: 15 Eröffnungen mit 34 Linien nach Elo-Bereich, ansehen und üben mit Wiederholungen
- **Spielen**: 10 Bots (ca. 400–2300 Elo) und 5 **Persönlichkeiten** mit eigenem Stil und Lieblingseröffnungen,
  **Schachuhr** (Bullet, Blitz, Rapid), Live-Zugbewertung, Tipp, Zurücknehmen, Bot-Tempo
- **Rätsel**: 315 Rätsel mit Wertung, **Themenfilter**, **Rush** (3 Min., 5 Min., Survival) und
  **Fehler-Training** mit Fehlern und Patzern aus deinen eigenen Partien
- **Analyse**: Genauigkeit, Elo-Schätzung, Graph, PGN-Import. „Ab hier spielen“,
  **Analysebrett** mit den 3 besten Engine-Zügen, **Stellungs-Editor**
- **Figuren**: 10 Figurensätze zur Auswahl

## Prüf-Skripte (Node.js)
```
node tools/check-lessons.js    # prüft alle Lernpfad-Übungen mit der Engine
node tools/check-openings.js   # prüft alle Eröffnungslinien
node tools/check-endgames.js   # prüft die Endspiel-Trainer-Stellungen
```

## Lizenzen
Die Figurensätze stammen aus dem lichess.org-Projekt und stehen unter freien Lizenzen
(GPLv2+, MIT, Apache 2.0, CC BY 4.0, CC0). Details stehen in `pieces/LIZENZEN.md`.
Die Icons sind von [Lucide](https://lucide.dev) (ISC-Lizenz, siehe `ICONS-LIZENZ.txt`).

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
