# imcheck

Desktop-App (macOS & Windows) zum Prüfen von Bildern und Videos: Metadaten anzeigen, Spuren von KI-Erzeugung und Bearbeitung (Photoshop u. a.) finden.

**Integrierte freie Werkzeuge:** ExifTool (Metadaten), FFprobe (Video), C2PA/Content Credentials (`@contentauth/c2pa-node`), Fehlerlevel-Analyse (ELA, eigene Implementierung), Heuristiken für Stable Diffusion/ComfyUI/Midjourney/DALL·E/Firefly/Gemini u. a.

## Nutzung
- Windows: `imcheck-<version>-windows-portable.exe` aus den [Releases](../../releases) starten – keine Installation.
- macOS: `.dmg` öffnen (unsigniert: Rechtsklick → Öffnen).

## Entwicklung
```
npm install
npm start
npm run dist:mac   # auf dem Mac
npm run dist:win   # auf Windows (oder via GitHub Actions)
```
Release: Tag `v1.0.0` pushen → GitHub Actions baut beide Plattformen und hängt sie ans Release.

Die Webseite liegt in `docs/` (GitHub Pages, Domain via `docs/CNAME`).
