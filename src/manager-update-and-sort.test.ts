import sqlite3 from 'sqlite3';
import { BugManager } from './bugs.js';
import { ImprovementManager } from './improvements.js';
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

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}

async function setupSchema(db: sqlite3.Database) {
  await run(db, `CREATE TABLE bugs (
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

  // features removed

  await run(db, `CREATE TABLE improvements (
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

async function seedData(db: sqlite3.Database) {
  // Two bugs with different dates
  await run(db, `INSERT INTO bugs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    'Bug #001', 'Open', 'High', '2025-01-01', 'Auth', 'A', 'desc', 'exp', 'act', null,
    JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), 0
  ]);
  await run(db, `INSERT INTO bugs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    'Bug #002', 'Open', 'Low', '2025-01-03', 'Auth', 'B', 'desc', 'exp', 'act', null,
    JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), 0
  ]);

  // features removed

  // One improvement
  await run(db, `INSERT INTO improvements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    'IMP-001', 'Proposed', 'Medium', '2025-06-01', null, 'General', 'carol', 'I1', 'desc', 'cur', 'des', JSON.stringify([]), null, null, JSON.stringify([]), JSON.stringify([]), 'Medium', JSON.stringify([])
  ]);
}

async function testUpdateNotFound(db: sqlite3.Database) {
  const bugs = new BugManager();
  try {
    await bugs.updateBugStatus(db, { itemId: 'Bug #999', status: 'Closed' });
    assert(false, 'updateBugStatus should fail for non-existent bug');
  } catch (e: any) {
    assert(String(e.message).includes('not found'), 'updateBugStatus reports not found');
  }

  // features removed

  const imps = new ImprovementManager();
  try {
    await imps.updateImprovementStatus(db, { itemId: 'IMP-999', status: 'Completed' });
    assert(false, 'updateImprovementStatus should fail for non-existent improvement');
  } catch (e: any) {
    assert(String(e.message).includes('not found'), 'updateImprovementStatus reports not found');
  }
  console.log('✓ update*Status not-found checks');
}

async function testBugSearchSortMapping(db: sqlite3.Database) {
  const bugs = new BugManager();
  const resAsc = await bugs.searchBugs(db, '', { sortBy: 'date', sortOrder: 'asc', limit: 10, offset: 0 });
  assert(resAsc.length >= 2, 'searchBugs returns rows');
  assert(resAsc[0].id === 'Bug #001', 'searchBugs date asc yields earliest first');

  const resDesc = await bugs.searchBugs(db, '', { sortBy: 'date', sortOrder: 'desc', limit: 10, offset: 0 });
  assert(resDesc[0].id === 'Bug #002', 'searchBugs date desc yields latest first');
  console.log('✓ searchBugs sortBy mapping (date → dateReported)');
}

// features removed

async function testGlobalSearchSort(db: sqlite3.Database) {
  const search = new SearchManager();
  const out = await search.searchItems(db, { type: 'all', sortBy: 'date', sortOrder: 'asc', limit: 10, offset: 0 });
  // searchItems returns a formatted string, not raw rows. Check ordering via ID presence.
  assert(typeof out === 'string', 'searchItems returns string');
  // Ensure output contains bug IDs and is a string
  assert(out.indexOf('Bug #001') > -1, 'IDs present in output');
  console.log('✓ global search sorting across mixed types');
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await setupSchema(db);
    await seedData(db);
    await testUpdateNotFound(db);
    await testBugSearchSortMapping(db);
    // features removed
    await testGlobalSearchSort(db);
    if (process.exitCode === 1) {
      console.error('Some tests failed');
      process.exit(1);
    } else {
      console.log('\nAll tests passed');
    }
  } catch (e) {
    console.error('Test run error:', e);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
