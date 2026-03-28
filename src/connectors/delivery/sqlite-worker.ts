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

function normalizeConnectorTarget(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function createConnectorCondition() {
  return '(connector_type = ? AND ((connector_target IS NULL AND ? IS NULL) OR connector_target = ?))';
}

function updateConnectorDeliveryStatus(item, success) {
  const connectorTarget = normalizeConnectorTarget(item.connectorTarget);
  const select = adapter.prepare(
    db,
    'SELECT rowid FROM connector_delivery_status WHERE ' + createConnectorCondition() + ' LIMIT 1'
  );
  const existing = adapter.all(select, [item.connectorType, connectorTarget, connectorTarget])[0];

  if (existing) {
    const update = adapter.prepare(
      db,
      success
        ? 'UPDATE connector_delivery_status SET last_success_at = ?, last_error = NULL, updated_at = ? WHERE rowid = ?'
        : 'UPDATE connector_delivery_status SET last_failure_at = ?, last_error = ?, updated_at = ? WHERE rowid = ?'
    );

    adapter.run(
      update,
      success
        ? [item.timestamp, item.timestamp, existing.rowid]
        : [item.timestamp, item.lastError ?? null, item.timestamp, existing.rowid]
    );
    return;
  }

  const insert = adapter.prepare(
    db,
    'INSERT INTO connector_delivery_status (connector_type, connector_target, last_success_at, last_failure_at, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  adapter.run(insert, [
    item.connectorType,
    connectorTarget,
    success ? item.timestamp : null,
    success ? null : item.timestamp,
    success ? null : item.lastError ?? null,
    item.timestamp,
  ]);
}

function initializeSchema() {
  ensureReady();
  adapter.exec(db, [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA busy_timeout = 5000;',
    'CREATE TABLE IF NOT EXISTS connector_queue_meta (schema_version INTEGER NOT NULL);',
    'DELETE FROM connector_queue_meta;',
    'INSERT INTO connector_queue_meta (schema_version) VALUES (2);',
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
    'CREATE TABLE IF NOT EXISTS connector_dead_letters (',
    '  id TEXT PRIMARY KEY,',
    '  connector_type TEXT NOT NULL,',
    '  connector_target TEXT NULL,',
    '  operation TEXT NOT NULL,',
    '  payload_json TEXT NOT NULL,',
    '  attempt_count INTEGER NOT NULL,',
    '  max_attempts INTEGER NOT NULL,',
    '  last_error TEXT NULL,',
    '  first_enqueued_at INTEGER NOT NULL,',
    '  dead_lettered_at INTEGER NOT NULL,',
    '  last_attempt_at INTEGER NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS connector_delivery_status (',
    '  connector_type TEXT NOT NULL,',
    '  connector_target TEXT NULL,',
    '  last_success_at INTEGER NULL,',
    '  last_failure_at INTEGER NULL,',
    '  last_error TEXT NULL,',
    '  updated_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_connector_jobs_state_due ON connector_jobs(state, next_attempt_at);',
    'CREATE INDEX IF NOT EXISTS idx_connector_jobs_connector_state_due ON connector_jobs(connector_type, connector_target, state, next_attempt_at);',
    'CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_connector_dead_lettered ON connector_dead_letters(connector_type, connector_target, dead_lettered_at);',
    'CREATE INDEX IF NOT EXISTS idx_connector_delivery_status_connector ON connector_delivery_status(connector_type, connector_target);'
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
        normalizeConnectorTarget(job.connectorTarget),
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

function deadLetter(items) {
  ensureReady();
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  adapter.exec(db, 'BEGIN');
  try {
    const insert = adapter.prepare(
      db,
      'INSERT OR REPLACE INTO connector_dead_letters (id, connector_type, connector_target, operation, payload_json, attempt_count, max_attempts, last_error, first_enqueued_at, dead_lettered_at, last_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const remove = adapter.prepare(db, 'DELETE FROM connector_jobs WHERE id = ?');

    for (const item of items) {
      adapter.run(insert, [
        item.id,
        item.connectorType,
        normalizeConnectorTarget(item.connectorTarget),
        item.operation,
        item.payloadJson,
        item.attemptCount,
        item.maxAttempts,
        item.lastError ?? null,
        item.firstEnqueuedAt,
        item.deadLetteredAt,
        item.lastAttemptAt,
      ]);
      adapter.run(remove, [item.id]);
    }

    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function markSuccess(items) {
  ensureReady();
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  adapter.exec(db, 'BEGIN');
  try {
    for (const item of items) {
      updateConnectorDeliveryStatus(item, true);
    }
    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function markFailure(items) {
  ensureReady();
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  adapter.exec(db, 'BEGIN');
  try {
    for (const item of items) {
      updateConnectorDeliveryStatus(item, false);
    }
    adapter.exec(db, 'COMMIT');
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function getStatusSummary() {
  ensureReady();
  const rows = [];
  const byKey = new Map();

  const statusRows = adapter.all(
    adapter.prepare(
      db,
      'SELECT connector_type, connector_target, last_success_at, last_failure_at, last_error, updated_at FROM connector_delivery_status'
    ),
    []
  );

  for (const row of statusRows) {
    const key = row.connector_type + ':' + (row.connector_target ?? '');
    const item = {
      connectorType: row.connector_type,
      connectorTarget: row.connector_target ?? undefined,
      pendingCount: 0,
      deadLetterCount: 0,
      lastSuccessAt: row.last_success_at ?? undefined,
      lastFailureAt: row.last_failure_at ?? undefined,
      lastError: row.last_error ?? undefined,
      updatedAt: row.updated_at ?? undefined,
    };
    byKey.set(key, item);
    rows.push(item);
  }

  const pendingRows = adapter.all(
    adapter.prepare(
      db,
      'SELECT connector_type, connector_target, COUNT(*) AS count FROM connector_jobs WHERE state = ? GROUP BY connector_type, connector_target'
    ),
    ['pending']
  );

  for (const row of pendingRows) {
    const key = row.connector_type + ':' + (row.connector_target ?? '');
    const item = byKey.get(key) ?? {
      connectorType: row.connector_type,
      connectorTarget: row.connector_target ?? undefined,
      pendingCount: 0,
      deadLetterCount: 0,
    };
    item.pendingCount = Number(row.count ?? 0);
    if (!byKey.has(key)) {
      byKey.set(key, item);
      rows.push(item);
    }
  }

  const deadLetterRows = adapter.all(
    adapter.prepare(
      db,
      'SELECT connector_type, connector_target, COUNT(*) AS count FROM connector_dead_letters GROUP BY connector_type, connector_target'
    ),
    []
  );

  for (const row of deadLetterRows) {
    const key = row.connector_type + ':' + (row.connector_target ?? '');
    const item = byKey.get(key) ?? {
      connectorType: row.connector_type,
      connectorTarget: row.connector_target ?? undefined,
      pendingCount: 0,
      deadLetterCount: 0,
    };
    item.deadLetterCount = Number(row.count ?? 0);
    if (!byKey.has(key)) {
      byKey.set(key, item);
      rows.push(item);
    }
  }

  return rows.sort((left, right) => {
    const leftKey = left.connectorType + ':' + (left.connectorTarget ?? '');
    const rightKey = right.connectorType + ':' + (right.connectorTarget ?? '');
    return leftKey.localeCompare(rightKey);
  });
}

function listDeadLetters(limit, offset, connectorType, connectorTarget) {
  ensureReady();
  const clauses = [];
  const params = [];

  if (typeof connectorType === 'string' && connectorType.length > 0) {
    clauses.push('connector_type = ?');
    params.push(connectorType);
  }

  if (connectorTarget !== undefined) {
    if (connectorTarget === null || connectorTarget === '') {
      clauses.push('connector_target IS NULL');
    } else {
      clauses.push('connector_target = ?');
      params.push(connectorTarget);
    }
  }

  const whereSql = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';
  const countRow = adapter.all(
    adapter.prepare(db, 'SELECT COUNT(*) AS count FROM connector_dead_letters' + whereSql),
    params
  )[0];
  const rows = adapter.all(
    adapter.prepare(
      db,
      'SELECT * FROM connector_dead_letters' + whereSql + ' ORDER BY dead_lettered_at DESC LIMIT ? OFFSET ?'
    ),
    [...params, limit, offset]
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      connectorType: row.connector_type,
      connectorTarget: row.connector_target ?? undefined,
      operation: row.operation,
      payloadJson: row.payload_json,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      lastError: row.last_error ?? undefined,
      firstEnqueuedAt: row.first_enqueued_at,
      deadLetteredAt: row.dead_lettered_at,
      lastAttemptAt: row.last_attempt_at,
    })),
    total: Number(countRow?.count ?? 0),
  };
}

function retryDeadLetters(ids, now) {
  ensureReady();
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }

  adapter.exec(db, 'BEGIN');
  try {
    const select = adapter.prepare(db, 'SELECT * FROM connector_dead_letters WHERE id = ?');
    const insert = adapter.prepare(
      db,
      'INSERT OR REPLACE INTO connector_jobs (id, connector_type, connector_target, operation, payload_json, attempt_count, max_attempts, next_attempt_at, state, last_error, created_at, updated_at, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const remove = adapter.prepare(db, 'DELETE FROM connector_dead_letters WHERE id = ?');
    let count = 0;

    for (const id of ids) {
      const row = adapter.all(select, [id])[0];
      if (!row) {
        continue;
      }

      adapter.run(insert, [
        row.id,
        row.connector_type,
        row.connector_target ?? null,
        row.operation,
        row.payload_json,
        0,
        row.max_attempts,
        now,
        'pending',
        null,
        row.first_enqueued_at,
        now,
        null,
      ]);
      adapter.run(remove, [id]);
      count += 1;
    }

    adapter.exec(db, 'COMMIT');
    return count;
  } catch (error) {
    adapter.exec(db, 'ROLLBACK');
    throw error;
  }
}

function clearDeadLetters(ids) {
  ensureReady();
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }

  adapter.exec(db, 'BEGIN');
  try {
    const select = adapter.prepare(db, 'SELECT id FROM connector_dead_letters WHERE id = ?');
    const remove = adapter.prepare(db, 'DELETE FROM connector_dead_letters WHERE id = ?');
    let count = 0;
    for (const id of ids) {
      const row = adapter.all(select, [id])[0];
      if (!row) {
        continue;
      }
      adapter.run(remove, [id]);
      count += 1;
    }
    adapter.exec(db, 'COMMIT');
    return count;
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
        parentPort.postMessage({ id, ok: true, result: claimDue(payload.limit, payload.now) });
        return;
      case 'ack':
        ack(payload.ids);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'reschedule':
        reschedule(payload.items, payload.now);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'deadLetter':
        deadLetter(payload.items);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'markSuccess':
        markSuccess(payload.items);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'markFailure':
        markFailure(payload.items);
        parentPort.postMessage({ id, ok: true, result: true });
        return;
      case 'getStatusSummary':
        parentPort.postMessage({ id, ok: true, result: getStatusSummary() });
        return;
      case 'listDeadLetters':
        parentPort.postMessage({
          id,
          ok: true,
          result: listDeadLetters(
            payload.limit,
            payload.offset,
            payload.connectorType,
            payload.connectorTarget
          ),
        });
        return;
      case 'retryDeadLetters':
        parentPort.postMessage({ id, ok: true, result: retryDeadLetters(payload.ids, payload.now) });
        return;
      case 'clearDeadLetters':
        parentPort.postMessage({ id, ok: true, result: clearDeadLetters(payload.ids) });
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
