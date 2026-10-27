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
- **Übersicht**: Statistiken, Bot-Leiter, letzte Partien
- **Spielen**: 10 Bots von ca. 400 bis 2300 Elo oder zu zweit an einem Gerät. Mit Live-Zugbewertung
  (Brillant, Großartig, Bester Zug, Exzellent, Guter Zug, Leichter Fehler, Fehler, Verpasst, Patzer), Tipp und Zurücknehmen
- **Rätsel**: passen sich deiner Wertung an und werden schwieriger, je besser du wirst
- **Analyse**: Genauigkeit, geschätzte Elo, Bewertungsgraph, bessere Züge, PGN-Import

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
