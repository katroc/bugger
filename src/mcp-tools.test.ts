import sqlite3 from 'sqlite3';
import { BugManager } from './bugs.js';
import { ImprovementManager } from './improvements.js';
import { SearchManager } from './search.js';
import { WorkflowManager } from './workflows.js';
import { ContextManager } from './context.js';

function assert(condition: any, message: string) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  }
}

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
}

async function setupSchema(db: sqlite3.Database) {
  // Core tables (mirror src/index.ts)
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

  await run(db, `CREATE TABLE item_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromItem TEXT NOT NULL,
    toItem TEXT NOT NULL,
    relationshipType TEXT NOT NULL,
    dateCreated TEXT NOT NULL,
    UNIQUE(fromItem, toItem, relationshipType)
  )`);

  await run(db, `CREATE TABLE code_contexts (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL,
    taskType TEXT NOT NULL,
    contextType TEXT NOT NULL,
    source TEXT NOT NULL,
    filePath TEXT NOT NULL,
    startLine INTEGER,
    endLine INTEGER,
    content TEXT,
    description TEXT NOT NULL,
    relevanceScore REAL NOT NULL,
    keywords TEXT,
    dateCollected TEXT NOT NULL,
    dateLastChecked TEXT,
    isStale INTEGER DEFAULT 0
  )`);
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  const bugs = new BugManager();
  // features removed
  const imps = new ImprovementManager();
  const search = new SearchManager();
  const flows = new WorkflowManager();
  const ctx = new ContextManager();

  try {
    await setupSchema(db);

    // create_item (bug)
    const bugCreateOut = await bugs.createBug(db, {
      title: 'Login fails',
      description: 'Error on login',
      priority: 'High',
      component: 'Auth',
      expectedBehavior: 'Login succeeds',
      actualBehavior: '500 error',
      stepsToReproduce: ['Open app', 'Enter creds', 'Submit']
    });
    assert(/Bug #\d+/.test(bugCreateOut), 'create_bug returns created Bug ID');

    // features removed

    // create_item (improvement) using aliases to ensure no NOT NULL issues
    const impCreateOut = await imps.createImprovement(db, {
      title: 'Refactor auth module',
      description: 'Improve structure and tests',
      priority: 'Medium',
      category: 'Architecture',
      requestedBy: 'bob',
      currentBehavior: 'Tightly coupled components', // alias for currentState
      expectedBehavior: 'Modularized with DI',       // alias for desiredState
      acceptanceCriteria: ['Increased coverage', 'Lower complexity']
    });
    assert(/IMP-\d+/.test(impCreateOut), 'create_improvement returns created IMP ID (aliases honored)');

    // list_items
    const listBugs = await bugs.listBugs(db, {});
    assert(listBugs.includes('Bug #'), 'list_bugs returns content');
    // features removed
    const listImps = await imps.listImprovements(db, {});
    assert(listImps.includes('IMP-'), 'list_improvements returns content');

    // update_item_status
    const bugId = (listBugs.match(/Bug #\d+/) || [''])[0];
    const impId = (listImps.match(/IMP-\d+/) || [''])[0];
    assert(bugId && impId, 'extracted IDs for status updates');

    const bugUpd = await bugs.updateBugStatus(db, { itemId: bugId, status: 'Fixed', humanVerified: true });
    assert(bugUpd.includes('updated to Fixed'), 'bug status updated');
    // features removed
    const impUpd = await imps.updateImprovementStatus(db, { itemId: impId, status: 'Approved', dateCompleted: '2025-06-10' });
    assert(impUpd.includes('updated to Approved'), 'improvement status updated');

    // search_items (global) and get_statistics
    const searchOut = await search.searchItems(db, { type: 'all', sortBy: 'date', sortOrder: 'asc', limit: 10, offset: 0 });
    assert(typeof searchOut === 'string' && searchOut.includes('Bug #'), 'search_items returns formatted string');
    const statsOut = await search.getStatistics(db, { type: 'all' });
    assert(statsOut.includes('Bugs (') && statsOut.includes('Improvements ('), 'get_statistics returns counts');

    // link_items and get_related_items
    const linkOut = await flows.linkItems(db, { fromItem: bugId, toItem: impId, relationshipType: 'relates_to' });
    assert(linkOut.includes('Relationship created'), 'link_items creates relationship');
    const relatedOut = await flows.getRelatedItems(db, { itemId: bugId });
    assert(relatedOut.includes(impId), 'get_related_items lists linked item');

    // bulk_update_items (exercise underlying bulk methods per type)
    const bulkBugs = await bugs.bulkUpdateBugStatus(db, { updates: [{ itemId: bugId, status: 'Closed', humanVerified: true }] });
    assert(bulkBugs.includes('bugs updated successfully') && bulkBugs.includes('Closed'), 'bulk update bugs works');
    // features removed
    const bulkImps = await imps.bulkUpdateImprovementStatus(db, { updates: [{ itemId: impId, status: 'In Development' }] });
    assert(bulkImps.includes('improvements updated successfully') && bulkImps.includes('In Development'), 'bulk update improvements works');

    // manage_contexts: add/get/update/remove/check_freshness (manual contexts only for determinism)
    const addCtx = await ctx.manageContexts(db, {
      operation: 'add',
      taskId: bugId,
      taskType: 'bug',
      contextType: 'snippet',
      filePath: 'README.md',
      content: 'Example snippet',
      description: 'Manual context for test',
      relevanceScore: 0.9,
    });
    const addedId = (addCtx.match(/Manual context added successfully: (.+)/) || [])[1]?.split('\n')[0].trim();
    assert(!!addedId, 'manual context added and ID returned');

    const getCtx = await ctx.manageContexts(db, { operation: 'get', taskId: bugId });
    assert(getCtx.includes('Manual context for test'), 'get contexts returns added context');

    const updCtx = await ctx.manageContexts(db, { operation: 'update', contextId: addedId, updates: { description: 'Updated desc', isStale: true } });
    assert(updCtx.includes('updated successfully'), 'update context works');

    const freshCtx = await ctx.manageContexts(db, { operation: 'check_freshness', taskId: bugId });
    assert(typeof freshCtx === 'string', 'check_freshness returns summary');

    const remCtx = await ctx.manageContexts(db, { operation: 'remove', contextId: addedId });
    assert(remCtx.includes('removed successfully'), 'remove context works');

    // search_semantic and rebuild_search_index (best-effort; FTS may not exist but method should return a string)
    const rebuilt = await search.rebuildIndex(db);
    assert(typeof rebuilt === 'string', 'rebuild_search_index returns string');
    const sem = await search.performSemanticSearch(db, { query: 'login', limit: 5 });
    assert(typeof sem === 'string', 'search_semantic returns string');

    // execute_workflow: create_and_link (create an improvement via alias fields + link to bug)
    const wfOut = await flows.executeWorkflow(db, {
      workflow: 'create_and_link',
      items: [
        {
          type: 'improvement',
          data: {
            title: 'Improve logging',
            description: 'Add structured logs',
            priority: 'Low',
            category: 'DevEx',
            requestedBy: 'dev',
            currentBehavior: 'Sparse logs',
            expectedBehavior: 'Structured logs with context',
          },
          linkTo: bugId,
          relationshipType: 'relates_to',
        },
      ],
    });
    assert(wfOut.includes('Successful operations'), 'execute_workflow create_and_link runs');

    if (process.exitCode === 1) {
      console.error('Some MCP tool tests failed');
      process.exit(1);
    } else {
      console.log('\nAll MCP tool call tests passed');
    }
  } catch (e) {
    console.error('MCP tools test error:', e);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
