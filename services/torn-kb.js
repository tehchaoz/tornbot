const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.KB_EMBED_MODEL || 'nomic-embed-text';
const KB_DIR = process.env.KB_DIR || path.join(process.env.HOME || '/home/morefine', 'MoreFineVault', 'wiki', 'knowledge', 'torn-city');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'tornbot.db');
const MAX_CHARS = 1800;
const TOP_K = 3;

let db = null;
let ready = false;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_meta (
      source TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      chunk TEXT NOT NULL,
      emb BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks(source);
  `);
  ready = true;
}

async function embed(texts) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.embeddings)) throw new Error('no embeddings in response');
  return data.embeddings;
}

function stripFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : content;
}

function chunkText(content) {
  const sections = [];
  const lines = content.split(/\r?\n/);
  let current = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current.length) sections.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current.join('\n').trim());

  const chunks = [];
  for (const sec of sections) {
    if (!sec) continue;
    if (sec.length <= MAX_CHARS) {
      chunks.push(sec);
      continue;
    }
    let buf = '';
    for (const para of sec.split(/\n\n+/)) {
      if ((buf + '\n\n' + para).length > MAX_CHARS && buf) {
        chunks.push(buf.trim());
        buf = para;
      } else {
        buf = buf ? buf + '\n\n' + para : para;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks;
}

function loadDocs() {
  const out = [];
  if (!fs.existsSync(KB_DIR)) return out;
  for (const name of fs.readdirSync(KB_DIR).sort()) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(KB_DIR, name);
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
    const title = name.replace(/\.md$/, '');
    const body = stripFrontmatter(raw);
    out.push({ source: file, title, chunks: chunkText(body) });
  }
  return out;
}

async function refresh() {
  if (!db) init();
  const docs = loadDocs();
  let embedded = 0;
  for (const doc of docs) {
    const hash = crypto.createHash('sha1').update(JSON.stringify(doc.chunks)).digest('hex');
    const meta = db.prepare('SELECT hash FROM kb_meta WHERE source = ?').get(doc.source);
    if (meta && meta.hash === hash) continue;

    const embeddings = await embed(doc.chunks);
    const del = db.prepare('DELETE FROM kb_chunks WHERE source = ?');
    const ins = db.prepare('INSERT INTO kb_chunks (source, title, chunk, emb) VALUES (?, ?, ?, ?)');
    const upsert = db.prepare(`
      INSERT INTO kb_meta (source, hash, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      del.run(doc.source);
      doc.chunks.forEach((chunk, i) => {
        const vec = embeddings[i];
        ins.run(doc.source, doc.title, chunk, Buffer.from(new Float32Array(vec).buffer));
      });
      upsert.run(doc.source, hash, Math.floor(Date.now() / 1000));
    });
    tx();
    embedded += doc.chunks.length;
    console.log(`[torn-kb] embedded ${doc.source} (${doc.chunks.length} chunks)`);
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get().n;
  console.log(`[torn-kb] refresh done: ${embedded} new chunks, ${total} total`);
  return { embedded, total };
}

function toFloat32(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function search(query, k = TOP_K) {
  if (!db) init();
  if (!ready) return [];
  const [qemb] = await embed([query]);
  const rows = db.prepare('SELECT title, chunk, emb FROM kb_chunks').all();
  const scored = rows.map((row) => ({
    title: row.title,
    text: row.chunk,
    score: cosine(new Float32Array(qemb), toFloat32(row.emb)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => ({
    title: s.title,
    text: s.text,
    score: Number(s.score.toFixed(4)),
  }));
}

function chunksCount() {
  if (!db) return 0;
  return db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get().n;
}

module.exports = { init, refresh, search, chunksCount };