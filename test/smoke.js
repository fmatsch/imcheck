const { analyze, shutdown } = require('../src/analyze');
(async () => {
  for (const f of process.argv.slice(2)) {
    const r = await analyze(f);
    console.log(r.file.name, r.file.kind, JSON.stringify(r.verdict), 'c2pa:', JSON.stringify({p:r.c2pa.present,e:r.c2pa.error}), 'groups:', Object.keys(r.groups).join(','));
    for (const x of r.findings) console.log(' -', x.cat, x.sev, x.title);
  }
  await shutdown();
})();
