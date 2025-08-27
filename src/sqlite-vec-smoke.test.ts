import sqlite3 from 'sqlite3';

function assert(condition: any, message: string) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  }
}

function fakeEmbed(text: string, dim = 128): number[] {
  const vec = new Array<number>(dim).fill(0);
  const normText = (text || '').toLowerCase();
  for (let i = 0; i < normText.length; i++) {
    const code = normText.charCodeAt(i);
    const idx = (code + i * 13) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }
  let sum = 0;
  for (const v of vec) sum += v * v;
  const denom = Math.sqrt(sum) || 1;
  return vec.map((v) => v / denom);
}

async function run() {
  const db = new sqlite3.Database(':memory:');
  try {
    // Load sqlite-vec extension via npm module
    const vec = await import('sqlite-vec');
    if (!vec || typeof (vec as any).load !== 'function') {
      throw new Error('sqlite-vec module not available');
    }
    await (vec as any).load(db);

    // Create vector and meta tables
    await new Promise<void>((resolve, reject) => {
      db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS item_embeddings USING vec0(embedding float[128])`, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS item_embedding_meta (rowid INTEGER PRIMARY KEY, id TEXT NOT NULL, type TEXT NOT NULL)`, (err) => (err ? reject(err) : resolve()));
    });

    // Insert one sample item embedding
    const id = 'Bug #001';
    const type = 'bug';
    const text = 'Login fails with 500 error on submit';
    const emb = fakeEmbed(text);
    const blob = Buffer.from(new Float32Array(emb).buffer);
    const rowid = await new Promise<number>((resolve, reject) => {
      db.run('INSERT INTO item_embeddings(embedding) VALUES (vector_to_blob(?))', [blob], function (err) {
        if (err) return reject(err);
        resolve((this as any).lastID as number);
      });
    });
    await new Promise<void>((resolve, reject) => {
      db.run('INSERT INTO item_embedding_meta(rowid, id, type) VALUES (?,?,?)', [rowid, id, type], (err) => (err ? reject(err) : resolve()));
    });

    // Query using vector similarity
    const q = fakeEmbed('login');
    const rows: any[] = await new Promise((resolve, reject) => {
      db.all(
        `SELECT m.id, m.type, distance FROM item_embeddings e
         JOIN item_embedding_meta m ON m.rowid = e.rowid
         WHERE e.embedding MATCH vector_to_blob(?)
         ORDER BY distance ASC LIMIT 5`,
        [Buffer.from(new Float32Array(q).buffer)],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    assert(rows.length > 0, 'vector search returns at least one result');
    assert(rows[0].id === id, 'nearest neighbor is the inserted bug');
    console.log('\n✓ sqlite-vec smoke test passed');
  } catch (e) {
    console.error('sqlite-vec smoke test error:', e);
    process.exit(1);
  }
}

run();

