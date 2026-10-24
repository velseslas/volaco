// MISSION — 4 générations réelles (Mistral) + preuves structurelles + captures
// Usage: node scripts/mission-generations.cjs
// Sortie: missions-artifacts/<slug>/{meta.json,index.html,desktop.png,mobile.png}
import('node:fs').then(async (fs) => {
  const { mkdirSync, writeFileSync, existsSync, readFileSync } = fs;
  // Charger .env (le serveur ne le fait pas lui-même)
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  }
  process.env.VOLACO_EXECUTION_TIMELINE = 'off';
  process.env.PORT = '3901';
  const OUT = 'missions-artifacts';
  mkdirSync(OUT, { recursive: true });

  const PRODUCTS = [
    { slug: 'rencontres', prompt: "Crée un site de rencontres premium « Élégance » : présentation immersive de l'esprit du service, découverte de profils avec critères de recherche (âge, ville, centres d'intérêt), parcours d'inscription en 3 étapes et abonnements. Cible : célibataires exigeants 30-50 ans." },
    { slug: 'mode', prompt: "Crée une boutique de mode haut de gamme « Maison Vernet » : direction artistique éditoriale, collections capsule, grille de pièces avec prix et fiches produit détaillées, lookbook, parcours d'achat avec panier. Cible : clientes fashion parisiennes." },
    { slug: 'saas-financier', prompt: "Crée une application SaaS financière « Pilotis » : tableau de bord avec indicateurs clés (revenus, marge, trésorerie), graphiques d'évolution, table de transactions avec filtres par catégorie et période, paramètres de compte. Cible : dirigeants de PME." },
    { slug: 'laboratoire', prompt: "Crée le site professionnel d'un laboratoire de matériaux « LEMAT » : essais mécaniques et analyses présentés par famille, équipements (machines, capacités), compétences et accréditations, services techniques sur mesure et demande de devis détaillée. Cible : industriels et bureaux d'études." }
  ];

  const { createApiServer } = await import('../dist/apps/api/src/server.js');
  const server = createApiServer({ port: 3901 }).server;
  await new Promise((r) => server.listen(3901, r));
  const base = 'http://127.0.0.1:3901';
  const H = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': 'tenant_mission', 'x-user-role': 'ENGINEER' };

  const results = [];
  for (const p of PRODUCTS) {
    const dir = `${OUT}/${p.slug}`;
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    const pres = await fetch(`${base}/api/v1/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Mission ' + p.slug }) });
    const pid = (await pres.json()).project.id;
    const sess = await fetch(`${base}/api/v1/projects/${pid}/conversation/sessions`, { method: 'POST', headers: H });
    const sid = (await sess.json()).session.id;
    const res = await fetch(`${base}/api/v1/projects/${pid}/conversation/sessions/${sid}/stream`, { method: 'POST', headers: H, body: JSON.stringify({ message: p.prompt, isModification: false }) });
    const sse = await res.text();
    const durS = Math.round((Date.now() - t0) / 100) / 10;

    const events = sse.split('\n').filter((l) => l.startsWith('data: ')).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    const sections = events.filter((e) => e.type === 'section_end').map((e) => e.name);
    const err = events.find((e) => e.type === 'error');
    const fileRes = await fetch(`${base}/api/v1/projects/${pid}/files/content?path=index.html`, { headers: H });
    const html = fileRes.ok ? ((await fileRes.json()).file?.content || '') : '';
    writeFileSync(`${dir}/index.html`, html);

    const dna = (html.match(/family=([^:&]+)/) || [])[1] || '?';
    const bg = (html.match(/background-color: ([^;]+)/) || [])[1] || '?';
    const buttons = (html.match(/<button/g) || []).length;
    const inputs = (html.match(/<input|<select|<textarea/g) || []).length;
    const onclick = (html.match(/onclick/g) || []).length;

    // Captures desktop + mobile via la route render (Chromium réel)
    const shots = {};
    for (const [label, vw, vh] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      try {
        const r = await fetch(`${base}/api/v1/projects/${pid}/render`, { method: 'POST', headers: H, body: JSON.stringify({ viewport: { width: vw, height: vh } }) });
        const j = await r.json();
        if (j.screenshotBase64) { writeFileSync(`${dir}/${label}.png`, Buffer.from(j.screenshotBase64, 'base64')); shots[label] = 'ok'; }
        else shots[label] = 'no-screenshot';
      } catch (e) { shots[label] = 'err:' + String(e).slice(0, 40); }
    }

    const meta = { slug: p.slug, projectId: pid, durationS: durS, status: err ? 'error: ' + err.error : 'ok', sections, sectionsCount: sections.length, dnaFont: dna, dnaBg: bg, buttons, formControls: inputs, interactiveHandlers: onclick, screenshots: shots, htmlBytes: html.length };
    writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
    results.push(meta);
    console.log(`[${p.slug}] ${durS}s sections=${sections.length} [${sections.join(',')}] font=${dna} bg=${bg} btn=${buttons} forms=${inputs} onclick=${onclick} shots=${JSON.stringify(shots)} ${err ? 'ERREUR=' + err.error : ''}`);
  }
  writeFileSync(`${OUT}/comparison.json`, JSON.stringify(results, null, 2));
  // Diversité structurelle : noms de sections + DNA tous distincts ?
  const allSections = results.map((r) => r.sections.join('|'));
  const uniqueStructures = new Set(allSections).size;
  const uniqueDna = new Set(results.map((r) => r.dnaFont + r.dnaBg)).size;
  console.log(`[DIVERSITÉ] structures uniques: ${uniqueStructures}/4 | identités uniques: ${uniqueDna}/4`);
  server.close();
}).catch((e) => { console.error(e); process.exit(1); });
