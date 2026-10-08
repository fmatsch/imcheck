'use strict';
// imcheck – Analyse-Engine: ExifTool (Metadaten), ffprobe (Video), C2PA (Content Credentials)
// plus Heuristiken für KI-Erzeugung und Bearbeitung.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.heic', '.heif', '.avif', '.jxl', '.psd', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.raf']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.mts', '.m2ts', '.3gp', '.mpg', '.mpeg']);

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif',
  '.jxl': 'image/jxl', '.dng': 'image/dng', '.psd': 'image/vnd.adobe.photoshop',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};

// ---------- Signaturlisten ----------
const AI_TOOLS = [
  ['Midjourney', /midjourney/i],
  ['OpenAI (DALL·E / ChatGPT / Sora)', /dall[-·\s]?e|openai|chatgpt|gpt-?image|\bsora\b/i],
  ['Stable Diffusion', /stable[\s_-]?diffusion|\bsdxl\b|automatic1111|\ba1111\b|comfyui|invokeai|fooocus|stability\.ai|dreamstudio/i],
  ['Adobe Firefly / Generative Fill', /firefly|generative\s+(fill|expand|remove|ai)|generatives?\s+f[uü]llen/i],
  ['Google (Imagen / Gemini / Veo)', /\bimagen\b|gemini|made with google ai|synthid|\bveo\b|nano banana/i],
  ['Microsoft Designer / Bing Image Creator', /bing image creator|microsoft designer/i],
  ['NovelAI', /novelai/i],
  ['Leonardo.ai', /leonardo\.ai/i],
  ['Ideogram', /ideogram/i],
  ['Flux (Black Forest Labs)', /black forest labs|flux\.1|\bflux[\s_-]?(dev|schnell|pro|kontext)\b/i],
  ['Runway / Pika / Kling / Luma (Video-KI)', /runway(ml)?\b|pika\s?labs|\bkling\b|luma\s?(ai|dream)/i],
  ['Meta AI', /imagined with ai|meta ai/i],
  ['xAI Grok / Aurora', /\bgrok\b|\baurora\b.*xai/i],
  ['Craiyon / NightCafe / DeepAI', /craiyon|nightcafe|deepai/i],
];
const AI_GENERIC = /\bai[-\s]?(generated|created|image|art)\b|generated\s+(by|with|using)\s+ai|made with ai|synthetic media|\bdeepfake\b|trained\s?algorithmic/i;

const EDIT_TOOLS = [
  ['Adobe Photoshop', /photoshop/i],
  ['Adobe Lightroom / Camera Raw', /lightroom|camera raw/i],
  ['Adobe Illustrator / InDesign', /illustrator|indesign/i],
  ['Adobe Premiere / After Effects / Media Encoder', /premiere|after effects|media encoder/i],
  ['Adobe Express', /adobe express/i],
  ['GIMP', /\bgimp\b/i],
  ['Affinity (Photo/Designer)', /affinity/i],
  ['Pixelmator', /pixelmator/i],
  ['Capture One', /capture one/i],
  ['Paint.NET / Paint / MS Photos', /paint\.net|microsoft photos|windows photo/i],
  ['Apple Fotos / Vorschau / Markup', /apple photos|preview\.app|\bsips\b|quartz pdfcontext/i],
  ['Canva', /canva/i],
  ['Snapseed / Picsart / FaceApp / Facetune / VSCO', /snapseed|picsart|faceapp|facetune|vsco|meitu|beautycam|remini/i],
  ['Luminar / ON1 / DxO / darktable / RawTherapee', /luminar|on1|dxo|darktable|rawtherapee/i],
  ['Krita / Inkscape / Blender', /krita|inkscape|blender/i],
  ['DaVinci Resolve / Final Cut / iMovie', /davinci|final cut|imovie/i],
  ['CapCut / Filmora / Camtasia / Premiere Rush', /capcut|filmora|camtasia|premiere rush|inshot|kinemaster/i],
  ['FFmpeg / HandBrake (Neukodierung)', /lavf|lavc|ffmpeg|handbrake|libx26[45]/i],
];

const DST = {
  trainedAlgorithmicMedia: ['ai', 'high', 'Vollständig durch KI erzeugt (trainedAlgorithmicMedia)'],
  compositeWithTrainedAlgorithmicMedia: ['ai', 'high', 'Teilweise mit KI erzeugt/bearbeitet (compositeWithTrainedAlgorithmicMedia)'],
  algorithmicMedia: ['ai', 'medium', 'Algorithmisch erzeugt, ohne KI-Training (algorithmicMedia)'],
  compositeSynthetic: ['ai', 'medium', 'Zusammensetzung mit synthetischen Elementen (compositeSynthetic)'],
  composite: ['edit', 'medium', 'Komposit aus mehreren Quellen (composite)'],
  minorHumanEdits: ['edit', 'low', 'Geringfügige menschliche Bearbeitung (minorHumanEdits)'],
  digitalCapture: ['info', 'info', 'Als Kameraaufnahme deklariert (digitalCapture)'],
};

// ---------- Hilfsfunktionen ----------
const str = (v) => (Array.isArray(v) ? v.map(str).join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
const short = (s, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s);

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function unpacked(p) {
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

function parseExifDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str(s)) || /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str(s));
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

// ---------- ExifTool ----------
let _et = null;
function exiftool() {
  if (!_et) {
    const { ExifTool } = require('exiftool-vendored');
    _et = new ExifTool({ taskTimeoutMillis: 120000 });
  }
  return _et;
}
async function shutdown() {
  if (_et) { try { await _et.end(); } catch { /* ignore */ } _et = null; }
}

async function readExif(file) {
  const raw = await exiftool().readRaw(file, ['-G1', '-a', '-u', '-s', '-api', 'largefilesupport=1', '-api', 'RequestAll=3']);
  const flat = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'SourceFile' || k === 'ExifTool:ExifToolVersion') continue;
    flat[k] = v;
  }
  return flat;
}

function groupMeta(flat) {
  const groups = {};
  for (const [k, v] of Object.entries(flat)) {
    const i = k.indexOf(':');
    const g = i > 0 ? k.slice(0, i) : 'Sonstige';
    const t = i > 0 ? k.slice(i + 1) : k;
    (groups[g] ||= []).push([t, short(str(v), 4000)]);
  }
  return groups;
}

// ---------- ffprobe ----------
function ffprobe(file) {
  const bin = unpacked(require('ffprobe-static').path);
  return new Promise((resolve) => {
    execFile(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file],
      { maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out)); } catch { resolve(null); }
      });
  });
}

// ---------- C2PA ----------
let _c2pa = undefined;
async function readC2pa(file, mimeType) {
  try {
    if (_c2pa === undefined) _c2pa = await import('@contentauth/c2pa-node').catch(() => null);
    if (!_c2pa) return { available: false };
    const reader = await _c2pa.Reader.fromAsset({ path: file, mimeType });
    if (!reader) return { available: true, present: false };
    const store = reader.json();
    const manifests = store.manifests || {};
    const active = store.active_manifest;
    const out = [];
    for (const [label, m] of Object.entries(manifests)) {
      const actions = [];
      const other = [];
      for (const a of m.assertions || []) {
        if (/^c2pa\.actions/.test(a.label)) {
          for (const act of a.data?.actions || []) {
            actions.push({
              action: act.action,
              digitalSourceType: act.digitalSourceType || act.parameters?.digitalSourceType || null,
              softwareAgent: typeof act.softwareAgent === 'object' ? act.softwareAgent?.name : act.softwareAgent || null,
              description: act.description || null,
            });
          }
        } else other.push(a.label);
      }
      out.push({
        label, active: label === active,
        generator: m.claim_generator_info?.map?.((g) => `${g.name} ${g.version || ''}`.trim()).join(', ') || m.claim_generator || null,
        title: m.title || null,
        issuer: m.signature_info?.issuer || null,
        time: m.signature_info?.time || null,
        alg: m.signature_info?.alg || null,
        actions, assertions: other,
        ingredients: (m.ingredients || []).map((i) => i.title || i.format || 'Ingredient'),
      });
    }
    return {
      available: true, present: true,
      state: store.validation_state || null,
      problems: (store.validation_status || []).filter((s) => /fail|mismatch|invalid|untrusted|expired/i.test(s.code)).map((s) => `${s.code}${s.explanation ? ': ' + s.explanation : ''}`),
      manifests: out,
    };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/no claim|not found|jumbf not found|no manifest/i.test(msg)) return { available: true, present: false };
    return { available: true, present: false, error: msg };
  }
}

// ---------- Auswertung ----------
function evaluate({ flat, kind, probe, c2pa, name }) {
  const F = [];
  const add = (cat, sev, title, detail, evidence) => F.push({ cat, sev, title, detail, evidence: evidence || null });
  const entries = Object.entries(flat).map(([k, v]) => [k, str(v)]);
  const get = (re) => entries.find(([k]) => re.test(k));
  const evid = (k, v) => `${k} = ${short(v)}`;

  // --- C2PA / Content Credentials ---
  if (c2pa?.present) {
    add('info', 'info', 'Content Credentials (C2PA) vorhanden',
      `Signierte Herkunftsinformationen gefunden${c2pa.state ? ` – Validierung: ${c2pa.state}` : ''}.`,
      c2pa.manifests.map((m) => `${m.active ? '★ ' : ''}${m.generator || m.label}${m.issuer ? ' · Signatur: ' + m.issuer : ''}`).join('\n'));
    if (c2pa.problems?.length) add('warn', 'high', 'C2PA-Signatur fehlerhaft oder nicht vertrauenswürdig', 'Die Herkunftsdaten passen nicht zum Dateiinhalt oder stammen von keinem bekannten Aussteller. Das kann auf nachträgliche Manipulation hindeuten.', c2pa.problems.join('\n'));
    for (const m of c2pa.manifests) {
      for (const a of m.actions) {
        const dst = a.digitalSourceType && Object.keys(DST).find((k) => a.digitalSourceType.includes(k));
        if (dst && DST[dst][0] !== 'info') add(DST[dst][0], DST[dst][1], `C2PA: ${DST[dst][2]}`, `Aktion „${a.action}“${a.softwareAgent ? ` durch ${a.softwareAgent}` : ''}.`, a.digitalSourceType);
        else if (/^c2pa\.(edited|filtered|color_adjustments|cropped|resized|drawing|transcoded|placed|opened|repackaged|converted)/.test(a.action || '')) {
          add('edit', 'low', `C2PA-Bearbeitungsschritt: ${a.action}`, a.softwareAgent ? `Software: ${a.softwareAgent}` : 'Im Herkunftsprotokoll vermerkt.', a.description);
        }
        const hay = `${a.softwareAgent || ''} ${m.generator || ''}`;
        for (const [n, re] of AI_TOOLS) if (re.test(hay)) add('ai', 'high', `C2PA nennt KI-Werkzeug: ${n}`, 'Der signierte Herkunftsnachweis verweist auf ein KI-Werkzeug.', hay.trim());
      }
    }
  } else if (c2pa && c2pa.available !== false && !c2pa.error) {
    add('info', 'info', 'Keine Content Credentials (C2PA)', 'Kein eingebetteter Herkunftsnachweis. Das ist normal – viele Plattformen entfernen ihn beim Hochladen.');
  }

  // --- IPTC/XMP DigitalSourceType ---
  for (const [k, v] of entries.filter(([k]) => /DigitalSourceType/i.test(k))) {
    const key = Object.keys(DST).find((d) => v.includes(d));
    if (key) add(DST[key][0], DST[key][1], `Metadaten: ${DST[key][2]}`, 'IPTC/XMP-Feld „Digital Source Type“.', evid(k, v));
  }

  // --- Schlüsselwortsuche in allen Metadaten ---
  const skipKeys = /^(File:|System:|ExifTool:|Composite:(ImageSize|Megapixels))/;
  const seenAi = new Set();
  const seenEdit = new Set();
  let genericHit = null;
  for (const [k, v] of entries) {
    if (skipKeys.test(k) || v.length > 60000) continue;
    for (const [n, re] of AI_TOOLS) if (re.test(v) && !seenAi.has(n)) { seenAi.add(n); add('ai', 'high', `KI-Werkzeug in Metadaten: ${n}`, 'Ein Schlüsselbegriff eines KI-Generators wurde in den Metadaten gefunden.', evid(k, v)); }
    if (AI_GENERIC.test(v) && !genericHit) genericHit = [k, v];
    // Software-/Tool-Felder auf Bearbeitung prüfen
    if (/(Software|CreatorTool|HistorySoftwareAgent|Encoder|EncodingSettings|WritingApplication|WritingLibrary|Application|Producer|HandlerName|Creator$|Tool)/i.test(k)) {
      for (const [n, re] of EDIT_TOOLS) if (re.test(v) && !seenEdit.has(n)) {
        seenEdit.add(n);
        const sev = /Photoshop|Lightroom|GIMP|Affinity|Pixelmator|Snapseed|Picsart|FaceApp|Facetune|Canva/i.test(n) ? 'high' : 'medium';
        add('edit', sev, `Bearbeitung/Software: ${n}`, kind === 'video' && /FFmpeg/.test(n) ? 'Das Video wurde (neu) kodiert – typisch für Schnitt, Konvertierung oder Plattform-Upload.' : 'Die Datei wurde mit dieser Software erzeugt, gespeichert oder verändert.', evid(k, v));
      }
    }
  }

  if (genericHit && !seenAi.size) add('ai', 'medium', 'Hinweis auf KI in Metadaten', 'Allgemeiner KI-Hinweis im Text.', evid(...genericHit));

  // --- Prompt-/Parameter-Chunks (PNG u. a.) ---
  for (const [k, v] of entries) {
    if (/Steps:\s*\d+,\s*Sampler:/i.test(v) || /Negative prompt:/i.test(v)) { add('ai', 'high', 'Stable-Diffusion-Parameter (AUTOMATIC1111/Forge) eingebettet', 'Prompt, Sampler und Seed sind in der Datei gespeichert.', evid(k, v)); break; }
  }
  for (const [k, v] of entries) {
    if (/"class_type"\s*:/.test(v) || /"nodes"\s*:\s*\[.*"widgets_values"/s.test(v)) { add('ai', 'high', 'ComfyUI-Workflow eingebettet', 'Ein node-basierter KI-Workflow ist in der Datei gespeichert.', evid(k, v)); break; }
  }
  for (const [k, v] of entries) {
    if (/"(sampler|seed)"\s*:/.test(v) && /"(steps|scale|cfg)"/.test(v) && /"(prompt|uc)"/.test(v)) { add('ai', 'high', 'Generierungsparameter (Prompt/Seed/Steps) eingebettet', 'JSON mit typischen KI-Parametern gefunden (z. B. NovelAI, InvokeAI).', evid(k, v)); break; }
  }

  // --- Photoshop / Adobe-Spuren ---
  const adobeKeys = entries.filter(([k]) => /^(Photoshop|XMP-photoshop|XMP-crs|XMP-xmpMM|IRB):/.test(k));
  const psIrb = entries.filter(([k]) => /^Photoshop:/.test(k));
  if (psIrb.length > 3) add('edit', 'medium', 'Photoshop-Ressourcen (8BIM) enthalten', `${psIrb.length} Photoshop-Datenblöcke – wird beim Speichern aus Photoshop/Lightroom geschrieben.`, psIrb.slice(0, 4).map(([k, v]) => evid(k, v)).join('\n'));
  const crs = entries.filter(([k]) => /^XMP-crs:/.test(k));
  if (crs.length) add('edit', 'medium', 'Camera-Raw-/Lightroom-Entwicklungseinstellungen', `${crs.length} Einstellungen (Belichtung, Tonwerte, Gradationskurven …) wurden angewandt.`, crs.slice(0, 5).map(([k, v]) => evid(k, v)).join('\n'));
  const hist = entries.filter(([k]) => /^XMP-xmpMM:History(Action|SoftwareAgent|Changed|When)/.test(k));
  if (hist.length) {
    const act = get(/XMP-xmpMM:HistoryAction/);
    const ag = get(/XMP-xmpMM:HistorySoftwareAgent/);
    add('edit', 'high', 'XMP-Bearbeitungsverlauf vorhanden', 'Adobe-Programme protokollieren hier jeden Speichervorgang.', [act && evid(...act), ag && evid(...ag)].filter(Boolean).join('\n'));
  }
  const docId = get(/XMP-xmpMM:DocumentID/), orig = get(/XMP-xmpMM:OriginalDocumentID/);
  if (docId && orig && docId[1] !== orig[1]) add('edit', 'medium', 'Dokument-ID ≠ ursprüngliche Dokument-ID', 'Die Datei wurde aus einem anderen Dokument abgeleitet/neu gespeichert.', `${docId[1]}\n${orig[1]}`);
  if (get(/XMP-xmpMM:DerivedFromDocumentID|XMP-xmpMM:DerivedFrom/)) add('edit', 'medium', 'Als Ableitung einer anderen Datei markiert', 'XMP „DerivedFrom“ verweist auf eine Ursprungsdatei.');
  if (kind === 'image' && /\.psd$/i.test(name)) add('edit', 'high', 'Photoshop-Dokument (PSD)', 'Das PSD-Format entsteht ausschließlich bei der Bildbearbeitung.');

  // --- Zeitstempel ---
  const dto = get(/^(ExifIFD|XMP-exif|QuickTime|Keys):(DateTimeOriginal|CreationDate|CreateDate)$/i) || get(/DateTimeOriginal/);
  const mod = get(/^(IFD0|XMP-xmp|XMP-photoshop):(ModifyDate|DateCreated)$/) || get(/^XMP-xmp:MetadataDate/) || get(/^(IFD0):ModifyDate/);
  const tO = dto && parseExifDate(dto[1]);
  const tM = mod && parseExifDate(mod[1]);
  if (tO && tM && Math.abs(tM - tO) > 120000) {
    add('edit', 'medium', 'Änderungszeitpunkt weicht von Aufnahmezeit ab', `Aufnahme: ${dto[1]} · Änderung: ${mod[1]} (Δ ${Math.round((tM - tO) / 60000)} min).`, `${dto[0]}\n${mod[0]}`);
  }

  // --- Kamera- und GPS-Daten ---
  const make = get(/^(IFD0|QuickTime|Keys|XMP-tiff):Make$/) || get(/:Make$/);
  const model = get(/:Model$/);
  const exposure = get(/ExposureTime|FNumber|ISO$/);
  const hasCam = !!(make || model);
  if (hasCam) add('info', 'info', 'Kamera-/Geräteangaben vorhanden', 'Hersteller/Modell sind eingetragen. Das spricht für eine echte Aufnahme, ist aber leicht zu fälschen.', [make && evid(...make), model && evid(...model)].filter(Boolean).join('\n'));
  if (kind === 'image' && !hasCam && !exposure && !seenAi.size) {
    add('ai', 'low', 'Keine Kamera-/Belichtungsdaten', 'Bild ohne Make/Model/Belichtung. Typisch für KI-Bilder, aber auch für Screenshots, Web-Downloads und bereinigte Dateien.');
  }
  if (get(/GPSLatitude|GPSPosition/)) add('info', 'info', 'GPS-Standort eingebettet', 'Die Datei enthält Standortdaten (Datenschutz beachten).', (get(/GPSPosition/) || get(/GPSLatitude/)).join(' = '));
  if (kind === 'image' && !entries.some(([k]) => /^(EXIF|IFD0|ExifIFD|XMP|IPTC|Photoshop|QuickTime)/i.test(k)) ) {
    add('info', 'info', 'Kaum/keine Metadaten', 'Metadaten wurden entfernt (Social Media, Messenger, Screenshot oder gezielte Bereinigung). Herkunft lässt sich so nicht belegen.');
  }

  // --- typische KI-Auflösungen ---
  if (kind === 'image' && !hasCam) {
    const w = +(get(/^(File|PNG|JFIF|VP8\w*|Composite):?ImageWidth$/) || get(/ImageWidth$/) || [0, 0])[1];
    const h = +(get(/ImageHeight$/) || [0, 0])[1];
    const aiSizes = ['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '832x1216', '1216x832', '1344x768', '768x1344', '2048x2048', '1456x816', '816x1456', '1360x768'];
    if (w && h && aiSizes.includes(`${w}x${h}`)) add('ai', 'low', `Typische KI-Bildgröße ${w}×${h}`, 'Diese Auflösung wird von vielen Bildgeneratoren standardmäßig ausgegeben. Schwacher Hinweis.');
  }

  // --- Video ---
  if (kind === 'video' && probe) {
    const v = probe.streams?.find((s) => s.codec_type === 'video');
    const tags = { ...(probe.format?.tags || {}), ...(v?.tags || {}) };
    const enc = tags.encoder || tags.ENCODER || '';
    const major = (probe.format?.tags?.major_brand || '').trim();
    if (!probe.format?.tags?.creation_time) add('info', 'low', 'Kein Aufnahmezeitpunkt im Video', 'Fehlende creation_time – häufig nach Neukodierung/Export.');
    if (/lavf/i.test(enc) && !/lavc/i.test(str(v?.tags?.encoder))) add('edit', 'low', 'Video durch FFmpeg/libavformat geschrieben', 'Das Container-Muxing erfolgte mit FFmpeg – Konvertierung oder Plattform-Verarbeitung.', evid('encoder', enc));
    if (v && v.avg_frame_rate && v.r_frame_rate && v.avg_frame_rate !== v.r_frame_rate && /\//.test(v.avg_frame_rate)) {
      const f = (s) => { const [a, b] = s.split('/').map(Number); return b ? a / b : a; };
      if (Math.abs(f(v.avg_frame_rate) - f(v.r_frame_rate)) > 0.5) add('edit', 'low', 'Variable Bildrate', `avg ${v.avg_frame_rate} ≠ r ${v.r_frame_rate}. Tritt bei Bildschirmaufnahmen, Schnitt oder Neukodierung auf.`);
    }
    if (v && ['1280x720', '1920x1080', '1080x1920', '720x1280', '1024x576', '576x1024', '1360x768'].includes(`${v.width}x${v.height}`) && !hasCam && !probe.format?.tags?.creation_time && !major.match(/qt|isom_x/)) {
      /* kein belastbarer Hinweis – nur Kontext */
    }
    if (v && v.tags?.handler_name && /sora|runway|kling|pika|luma|veo|hailuo|vidu|genmo|pixverse/i.test(v.tags.handler_name)) add('ai', 'high', 'KI-Video-Dienst im Handler-Namen', 'Der Stream wurde von einem KI-Videogenerator beschriftet.', evid('handler_name', v.tags.handler_name));
  }

  // Duplikate zusammenfassen / sortieren
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  F.sort((a, b) => order[a.sev] - order[b.sev]);
  return F;
}

function verdict(findings) {
  const level = (cat) => {
    const s = findings.filter((f) => f.cat === cat).map((f) => f.sev);
    return s.includes('high') ? 'high' : s.includes('medium') ? 'medium' : s.includes('low') ? 'low' : 'none';
  };
  const warn = findings.some((f) => f.cat === 'warn');
  return { ai: level('ai'), edit: level('edit'), tampered: warn };
}

// ---------- Hauptfunktion ----------
async function analyze(file) {
  const st = await fs.promises.stat(file);
  const ext = path.extname(file).toLowerCase();
  const kind = VIDEO_EXT.has(ext) ? 'video' : IMAGE_EXT.has(ext) ? 'image' : 'unknown';
  const mime = MIME[ext] || null;
  const [flat, hash, probe, c2pa] = await Promise.all([
    readExif(file).catch((e) => ({ 'ExifTool:Error': String(e.message || e) })),
    sha256(file),
    kind === 'video' ? ffprobe(file) : Promise.resolve(null),
    mime || kind !== 'unknown' ? readC2pa(file, mime || undefined) : Promise.resolve({ available: true, present: false }),
  ]);
  const name = path.basename(file);
  const findings = evaluate({ flat, kind, probe, c2pa, name });
  return {
    file: { path: file, name, size: st.size, ext, kind, mime, sha256: hash, modified: st.mtime.toISOString() },
    groups: groupMeta(flat),
    probe, c2pa, findings, verdict: verdict(findings),
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = { analyze, shutdown, IMAGE_EXT, VIDEO_EXT };
