import { BUN_SQLITE_MODULE } from './sqlite-adapter-bun';
import { NODE_SQLITE_MODULE } from './sqlite-adapter-node';

export function buildSQLiteWorkerSource(): string {
  return `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

const NODE_SQLITE_MODULE = ${JSON.stringify(NODE_SQLITE_MODULE)};
const BUN_SQLITE_MODULE = ${JSON.stringify(BUN_SQLITE_MODULE)};
const CLAIM_LEASE_MS = 30000;

let db;
let runtime = 'unsupported';

async function loadDatabase() {
  try {
    const mod = await import(BUN_SQLITE_MODULE);
    const Database = mod.default;
    runtime = 'bun';
    return {
      create(filePath) {
        return new Database(filePath);
      },
      exec(instance, sql) {
        instance.exec(sql);
      },
      prepare(instance, sql) {
        return instance.prepare(sql);
      },
      close(instance) {
        instance.close();
      },
      run(statement, params) {
        statement.run(...params);
      },
      all(statement, params) {
        return statement.all(...params);
      },
    };
  } catch {}

  try {
    const mod = await import(NODE_SQLITE_MODULE);
    runtime = 'node';
    return {
      create(filePath) {
        return new mod.DatabaseSync(filePath);
      },
      exec(instance, sql) {
        instance.exec(sql);
      },
      prepare(instance, sql) {
        return instance.prepare(sql);
      },
      close(instance) {
        instance.close();
      },
      run(statement, params) {
        statement.run(...params);
      },
      all(statement, params) {
        return statement.all(...params);
      },
    };
  } catch {}

  throw new Error('No built-in SQLite runtime is available in this worker.');
}

let adapter;

function ensureReady() {
  if (!db || !adapter) {
    throw new Error('SQLite durable queue is not initialized.');
  }
}

function initializeSchema() {
  ensureReady();
  adapter.exec(db, [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA busy_timeout = 5000;',
    'CREATE TABLE IF NOT EXISTS connector_queue_meta (schema_version INTEGER NOT NULL);',
    'INSERT INTO connector_queue_meta (schema_version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM connector_queue_meta);',
    'CREATE TABLE IF NOT EXISTS connector_jobs (',
    '  id TEXT PRIMARY KEY,',
    '  connector_type TEXT NOT NULL,',
    '  connector_target TEXT NULL,',
    '  operation TEXT NOT NULL,',
    '  payload_json TEXT NOT NULL,',
    '  attempt_count INTEGER NOT NULL,',
    '  max_attempts INTEGER NOT NULL,',
    '  next_attempt_at INTEGER NOT NULL,',
    '  state TEXT NOT NULL,',
    '  last_error TEXT NULL,',
    '  created_at INTEGER NOT NULL,',
    '  updated_at INTEGER NOT NULL,',
    '  claimed_at INTEGER NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_connector_jobs_state_due ON connector_jobs(state, next_attempt_at);',
    'CREATE INDEX IF NOT EXISTS idx_connector_jobs_connector_state_due ON connector_jobs(connector_type, state, next_attempt_at);'
  ].join('\\n'));
}

function reclaimExpired(now) {
  ensureReady();
  const statement = adapter.prepare(
    db,
    'UPDATE connector_jobs SET state = ?, claimed_at = NULL, updated_at = ? WHERE state = ? AND claimed_at IS NOT NULL AND claimed_at <= ?'
  );
  adapter.run(statement, ['pending', now, 'claimed', now - CLAIM_LEASE_MS]);
}

function insertJobs(jobs) {
  ensureReady();
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return;
  }

  adapter.exec(db, 'BEGIN');
  try {
    const statement = adapter.prepare(
      db,
      'INSERT OR REPLACE INTO connector_jobs (id, connector_type, connector_target, operation, payload_json, attempt_count, max_attempts, next_attempt_at, state, last_error, created_at, updated_at, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    for (const job of jobs) {
      adapter.run(statement, [
        job.id,
        job.connectorType,
        job.connectorTarget ?? null,
        job.operation,
        job.payloadJson,
        job.attemptCount,
        job.maxAttempts,
        job.nextAttemptAt,
        job.state,
        job.lastError ?? null,
        job.createdAt,
        job.updatedAt,
        job.claimedAt ?? null,
      ]);
    }

    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function claimDue(limit, now) {
  ensureReady();
  reclaimExpired(now);

  const select = adapter.prepare(
    db,
    'SELECT * FROM connector_jobs WHERE state = ? AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?'
  );
  const rows = adapter.all(select, ['pending', now, limit]);

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  adapter.exec(db, 'BEGIN');
  try {
    const update = adapter.prepare(
      db,
      'UPDATE connector_jobs SET state = ?, claimed_at = ?, updated_at = ? WHERE id = ?'
    );
    for (const row of rows) {
      adapter.run(update, ['claimed', now, now, row.id]);
      row.state = 'claimed';
      row.claimed_at = now;
      row.updated_at = now;
    }
    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }

  return rows.map((row) => ({
    id: row.id,
    connectorType: row.connector_type,
    connectorTarget: row.connector_target ?? undefined,
    operation: row.operation,
    payloadJson: row.payload_json,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    state: row.state,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at ?? undefined,
  }));
}

function ack(ids) {
  ensureReady();
  if (!Array.isArray(ids) || ids.length === 0) {
    return;
  }
  adapter.exec(db, 'BEGIN');
  try {
    const statement = adapter.prepare(db, 'DELETE FROM connector_jobs WHERE id = ?');
    for (const id of ids) {
      adapter.run(statement, [id]);
    }
    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function reschedule(items, now) {
  ensureReady();
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }
  adapter.exec(db, 'BEGIN');
  try {
    const statement = adapter.prepare(
      db,
      'UPDATE connector_jobs SET state = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, claimed_at = NULL, updated_at = ? WHERE id = ?'
    );
    for (const item of items) {
      adapter.run(statement, [
        'pending',
        item.attemptCount,
        item.nextAttemptAt,
        item.lastError ?? null,
        now,
        item.id,
      ]);
    }
    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function count() {
  ensureReady();
  const statement = adapter.prepare(db, 'SELECT COUNT(*) as count FROM connector_jobs');
  const rows = adapter.all(statement, []);
  return Number(rows[0]?.count ?? 0);
}

parentPort.on('message', async (message) => {
  const { id, type, payload } = message;
  try {
    switch (type) {
      case 'init': {
        adapter = await loadDatabase();
        const filePath = payload.path;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        db = adapter.create(filePath);
        initializeSchema();
        reclaimExpired(Date.now());
        parentPort.postMessage({ id, ok: true, result: { runtime } });
        return;
      }
      case 'insert':
        insertJobs(payload.jobs);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'claimDue':
        parentPort.postMessage({
          id,
          ok: true,
          result: claimDue(payload.limit, payload.now),
        });
        return;
      case 'ack':
        ack(payload.ids);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'reschedule':
        reschedule(payload.items, payload.now);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'count':
        parentPort.postMessage({ id, ok: true, result: count() });
        return;
      case 'shutdown':
        if (db && adapter) {
          adapter.close(db);
          db = undefined;
        }
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      default:
        throw new Error('Unknown SQLite worker command: ' + type);
    }
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
`;
}
