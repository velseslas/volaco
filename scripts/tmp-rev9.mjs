import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('.volaco-data/volaco.db', { readOnly: true });
try {
  const row = db.prepare("SELECT content FROM documents WHERE key = 'revisions'").get();
  const j = JSON.parse(String(row.content));
  const groups = Array.isArray(j) ? j : Object.values(j);
  const flat = [];
  for (const g of groups) {
    const arr = Array.isArray(g) ? g : [g];
    for (const r of arr) { if (r && r.createdAt) flat.push(r); }
  }
  flat.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const r = flat[0];
  const html = String((r.files || {})['index.html'] || '');
  console.log('t=' + r.createdAt + ' len=' + html.length);
  for (const pat of ['<img', 'background-image', 'unsplash', 'picsum', 'loremflickr', '<picture', '<video', 'DATA-SECTION', 'data-section']) {
    console.log(pat + '=' + (html.split(pat).length - 1));
  }
} catch (e) { console.log('ERR:' + e.message); } finally { db.close(); }
