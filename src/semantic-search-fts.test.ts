import sqlite3 from 'sqlite3';
import { SearchManager } from './search.js';

function assert(condition: any, message: string) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  }
}

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function setupSchema(db: sqlite3.Database) {
  await run(db, `CREATE TABLE IF NOT EXISTS bugs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    dateReported TEXT NOT NULL,
    component TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    expectedBehavior TEXT NOT NULL,
    actualBehavior TEXT NOT NULL,
    potentialRootCause TEXT,
    filesLikelyInvolved TEXT,
    stepsToReproduce TEXT,
    verification TEXT,
    humanVerified INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS feature_requests (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    dateRequested TEXT NOT NULL,
    category TEXT NOT NULL,
    requestedBy TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    userStory TEXT NOT NULL,
    currentBehavior TEXT NOT NULL,
    expectedBehavior TEXT NOT NULL,
    acceptanceCriteria TEXT,
    potentialImplementation TEXT,
    dependencies TEXT,
    effortEstimate TEXT
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS improvements (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    dateRequested TEXT NOT NULL,
    dateCompleted TEXT,
    category TEXT NOT NULL,
    requestedBy TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    currentState TEXT NOT NULL,
    desiredState TEXT NOT NULL,
    acceptanceCriteria TEXT,
    implementationDetails TEXT,
    potentialImplementation TEXT,
    filesLikelyInvolved TEXT,
    dependencies TEXT,
    effortEstimate TEXT,
    benefits TEXT
  )`);
}

async function seed(db: sqlite3.Database) {
  await run(db, `INSERT INTO bugs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    'Bug #010', 'Open', 'High', '2025-06-01', 'Auth', 'Authentication bug', 'Login fails with special chars', 'should login', 'does not', null,
    JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), 0
  ]);
  await run(db, `INSERT INTO feature_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    'FR-010', 'Proposed', 'Medium', '2025-06-02', 'UI', 'alice', 'Dark mode feature', 'Add dark theme', 'As a user...', 'current', 'expected', JSON.stringify([]), null, JSON.stringify([]), 'Small'
  ]);
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  const search = new SearchManager();
  try {
    await setupSchema(db);
    await seed(db);
    let ftsAvailable = true;
    try {
      await search.rebuildIndex(db);
    } catch (e: any) {
      if (String(e.message || e).includes('FTS5 is not available')) {
        ftsAvailable = false;
        console.log('⚠ Skipping FTS test: FTS5 not available');
      } else {
        throw e;
      }
    }

    if (ftsAvailable) {
      const out = await search.performSemanticSearch(db, { query: 'authentication', limit: 5 });
      assert(typeof out === 'string', 'semantic search returns string');
      assert(out.includes('Bug #010'), 'FTS semantic search returns relevant bug');
      console.log('✓ FTS-backed semantic search');
    }

    if (process.exitCode === 1) {
      console.error('\nSome FTS tests failed');
      process.exit(1);
    } else {
      console.log('\nFTS tests completed');
    }
  } catch (e) {
    console.error('FTS test error:', e);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();

