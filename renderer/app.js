'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const items = []; // {path,name,state,result,error}
let current = null, tab = 'overview';

const LEVEL = { high: 'Stark', medium: 'Mittel', low: 'Schwach', none: 'Keine' };
const CAT = { ai: 'KI', edit: 'Bearbeitung', info: 'Info', warn: 'Warnung' };
const fmtSize = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(1) + ' kB');

async function addFiles(paths) {
  for (const p of paths) {
    if (!p || items.some((i) => i.path === p)) continue;
    const it = { path: p, name: p.split(/[\\/]/).pop(), state: 'busy' };
    items.push(it); renderList();
    if (!current) select(it);
    const r = await window.imcheck.analyze(p);
    if (r.ok) { it.result = r.result; it.state = 'done'; } else { it.error = r.error; it.state = 'error'; }
    renderList();
    if (current === it) renderView();
  }
}

function dotClass(it) {
  if (it.state !== 'done') return '';
  const v = it.result.verdict;
  const worst = [v.ai, v.edit].includes('high') ? 'high' : [v.ai, v.edit].includes('medium') ? 'medium' : [v.ai, v.edit].includes('low') ? 'low' : 'ok';
  return v.tampered ? 'high' : worst;
}
function renderList() {
  $('#list').innerHTML = items.map((it, i) => `<li data-i="${i}" class="${it === current ? 'sel' : ''}"><span class="n" title="${esc(it.path)}">${esc(it.name)}</span><span class="dot ${dotClass(it)}"></span></li>`).join('');
  $('#list').querySelectorAll('li').forEach((li) => li.onclick = () => select(items[li.dataset.i]));
}
function select(it) { current = it; tab = 'overview'; renderList(); renderView(); }

function renderView() {
  const it = current;
  $('#empty').hidden = !!it; $('#view').hidden = !it;
  if (!it) return;
  $('#fname').textContent = it.name;
  if (it.state === 'busy') { $('#fmeta').textContent = 'Analysiere …'; $('#tabs').innerHTML = ''; $('#pane').innerHTML = ''; return; }
  if (it.state === 'error') { $('#fmeta').textContent = ''; $('#tabs').innerHTML = ''; $('#pane').innerHTML = `<div class="card">Fehler: ${esc(it.error)}</div>`; return; }
  const r = it.result, f = r.file;
  $('#fmeta').textContent = `${f.kind === 'video' ? 'Video' : f.kind === 'image' ? 'Bild' : 'Datei'} · ${fmtSize(f.size)} · SHA-256 ${f.sha256.slice(0, 16)}…`;
  const tabs = [['overview', 'Übersicht'], ['preview', 'Vorschau'], ['meta', 'Metadaten']];
  if (r.c2pa?.present) tabs.push(['c2pa', 'Content Credentials']);
  if (r.probe) tabs.push(['video', 'Videodetails']);
  if (f.kind === 'image') tabs.push(['ela', 'Fehlerlevel (ELA)']);
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderView(); });
  ({ overview, preview, meta, c2pa, video, ela }[tab])(r);
}

// ---------- Tabs ----------
function overview(r) {
  const v = r.verdict;
  const tamper = v.tampered ? `<div class="card"><h3>Integrität</h3><div class="big high">Auffällig</div><div class="muted">Signatur ungültig / manipuliert</div></div>` : '';
  const txt = {
    ai: { high: 'Eindeutige Spuren von KI-Erzeugung gefunden.', medium: 'Mehrere Hinweise auf KI-Erzeugung.', low: 'Nur schwache, indirekte Hinweise.', none: 'Keine KI-Kennzeichnung gefunden.' },
    edit: { high: 'Bearbeitung mit Software nachweisbar.', medium: 'Hinweise auf Bearbeitung oder Neukodierung.', low: 'Schwache Hinweise auf Bearbeitung.', none: 'Keine Bearbeitungsspuren gefunden.' },
  };
  const list = r.findings.map((x) => `<div class="finding ${x.sev}"><span class="tag">${CAT[x.cat]}</span><span class="t">${esc(x.title)}</span><div>${esc(x.detail)}</div>${x.evidence ? `<pre>${esc(x.evidence)}</pre>` : ''}</div>`).join('') || '<p class="muted">Keine Auffälligkeiten.</p>';
  $('#pane').innerHTML = `<div class="verdicts">
    <div class="card"><h3>KI-Erzeugung</h3><div class="big ${v.ai}">${LEVEL[v.ai]}</div><div class="muted">${txt.ai[v.ai]}</div></div>
    <div class="card"><h3>Bearbeitung</h3><div class="big ${v.edit}">${LEVEL[v.edit]}</div><div class="muted">${txt.edit[v.edit]}</div></div>${tamper}</div>
    ${list}
    <p class="disc">Hinweis: Metadaten lassen sich entfernen oder fälschen. „Keine Spuren“ beweist nicht, dass ein Medium echt oder unbearbeitet ist; unsichtbare Wasserzeichen (z. B. SynthID) kann imcheck nicht auslesen. Die Fehlerlevel-Analyse (ELA) ist ein Hilfsmittel und kein Beweis.</p>`;
}

async function preview(r) {
  const f = r.file; $('#pane').innerHTML = '<p class="muted">Lade …</p>';
  if (f.kind === 'video') {
    const url = 'file://' + (f.path.startsWith('/') ? '' : '/') + encodeURI(f.path.replace(/\\/g, '/')).replace(/#/g, '%23');
    $('#pane').innerHTML = `<video class="media" controls src="${url}"></video>`; return;
  }
  const img = await loadImage(f);
  $('#pane').innerHTML = img ? '' : '<p class="muted">Vorschau für dieses Format nicht möglich.</p>';
  if (img) { img.className = 'media'; $('#pane').appendChild(img); }
}
const imgCache = new Map();
async function loadImage(f) {
  if (imgCache.has(f.path)) return imgCache.get(f.path).cloneNode();
  const buf = await window.imcheck.readFile(f.path);
  if (!buf) return null;
  const url = URL.createObjectURL(new Blob([buf], { type: f.mime || 'image/*' }));
  const img = new Image();
  const ok = await new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = url; });
  if (!ok) return null;
  imgCache.set(f.path, img);
  return img.cloneNode();
}

function meta(r) {
  const groups = Object.entries(r.groups);
  $('#pane').innerHTML = `<input type="search" id="q" placeholder="Metadaten durchsuchen …"><div id="grp"></div>`;
  const draw = (q) => {
    q = q.toLowerCase();
    $('#grp').innerHTML = groups.map(([g, rows]) => {
      const m = rows.filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q));
      if (!m.length) return '';
      return `<details ${q || /EXIF|IFD0|XMP|IPTC|Photoshop|QuickTime|C2PA|JUMBF|PNG$/i.test(g) ? 'open' : ''}><summary>${esc(g)} <span class="muted">(${m.length})</span></summary><table>${m.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>`;
    }).join('') || '<p class="muted">Keine Treffer.</p>';
  };
  draw(''); $('#q').oninput = (e) => draw(e.target.value);
}

function c2pa(r) {
  const c = r.c2pa;
  $('#pane').innerHTML = `<div class="card"><h3>Validierung</h3><div class="big">${esc(c.state || 'unbekannt')}</div>${c.problems?.length ? `<pre>${esc(c.problems.join('\n'))}</pre>` : ''}</div><br>` +
    c.manifests.map((m) => `<details open><summary>${m.active ? '★ ' : ''}${esc(m.generator || m.label)}</summary><table>
      ${[['Titel', m.title], ['Aussteller (Signatur)', m.issuer], ['Zeitpunkt', m.time], ['Algorithmus', m.alg], ['Quellen', m.ingredients.join(', ')], ['Weitere Assertions', m.assertions.join(', ')]].filter((x) => x[1]).map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}
      ${m.actions.map((a) => `<tr><td>Aktion</td><td>${esc(a.action)}${a.softwareAgent ? ' · ' + esc(a.softwareAgent) : ''}${a.digitalSourceType ? '<br><span class="muted">' + esc(a.digitalSourceType) + '</span>' : ''}</td></tr>`).join('')}
    </table></details>`).join('');
}

function video(r) {
  const p = r.probe, fm = p.format || {};
  const rows = [['Container', fm.format_long_name], ['Dauer', fm.duration && (+fm.duration).toFixed(2) + ' s'], ['Bitrate', fm.bit_rate && Math.round(fm.bit_rate / 1000) + ' kbit/s'], ...Object.entries(fm.tags || {}).map(([k, v]) => ['Tag: ' + k, v])];
  const streams = (p.streams || []).map((s) => `<details open><summary>Stream #${s.index} – ${esc(s.codec_type)} (${esc(s.codec_long_name || s.codec_name)})</summary><table>${Object.entries({ ...s, ...Object.fromEntries(Object.entries(s.tags || {}).map(([k, v]) => ['tag:' + k, v])) }).filter(([k, v]) => typeof v !== 'object' && v !== '' && !['index', 'tags'].includes(k)).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>`).join('');
  $('#pane').innerHTML = `<details open><summary>Format</summary><table>${rows.filter((x) => x[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>${streams}`;
}

async function ela(r) {
  $('#pane').innerHTML = `<div class="ela-ctl"><label>JPEG-Qualität <input type="range" id="q" min="60" max="98" value="90"> <span id="qv">90</span></label><label>Verstärkung <input type="range" id="g" min="5" max="60" value="25"> <span id="gv">25</span></label></div>
  <p class="muted">Bereiche, die heller aufleuchten als ihre Umgebung, wurden evtl. anders komprimiert (Retusche, eingefügte Elemente, KI-Inpainting). Neu gespeicherte oder skalierte Bilder zeigen gleichmäßiges Rauschen – nur relative Unterschiede sind aussagekräftig.</p>
  <div class="pair"><div><div class="muted">Original</div><div id="o"></div></div><div><div class="muted">ELA</div><canvas id="c"></canvas></div></div>`;
  const img = await loadImage(r.file);
  if (!img) { $('#pane').innerHTML = '<p class="muted">ELA für dieses Format nicht möglich (Browser kann es nicht dekodieren).</p>'; return; }
  $('#o').appendChild(img);
  const w = img.naturalWidth, h = img.naturalHeight, scale = Math.min(1, 2400 / Math.max(w, h));
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const bx = base.getContext('2d', { willReadFrequently: true }); bx.drawImage(img, 0, 0, W, H);
  const orig = bx.getImageData(0, 0, W, H);
  const c = $('#c'); c.width = W; c.height = H;
  let token = 0;
  async function run() {
    const t = ++token, q = +$('#q').value / 100, gain = +$('#g').value;
    $('#qv').textContent = $('#q').value; $('#gv').textContent = gain;
    const blob = await new Promise((res) => base.toBlob(res, 'image/jpeg', q));
    const bmp = await createImageBitmap(blob);
    if (t !== token) return;
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    const tx = tmp.getContext('2d', { willReadFrequently: true }); tx.drawImage(bmp, 0, 0);
    const re = tx.getImageData(0, 0, W, H), out = new ImageData(W, H);
    for (let i = 0; i < orig.data.length; i += 4) {
      for (let k = 0; k < 3; k++) out.data[i + k] = Math.min(255, Math.abs(orig.data[i + k] - re.data[i + k]) * gain);
      out.data[i + 3] = 255;
    }
    c.getContext('2d').putImageData(out, 0, 0);
  }
  $('#q').oninput = run; $('#g').oninput = run; run();
}

// ---------- Aktionen ----------
$('#add').onclick = $('#add2').onclick = async () => addFiles(await window.imcheck.pick());
$('#reveal').onclick = () => current && window.imcheck.reveal(current.path);
$('#export').onclick = () => current?.result && window.imcheck.saveReport(current.name + '.imcheck.json', JSON.stringify(current.result, null, 2));

let depth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#dropover').hidden = false; });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#dropover').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); depth = 0; $('#dropover').hidden = true;
  addFiles([...e.dataTransfer.files].map((f) => window.imcheck.pathOf(f)));
});
