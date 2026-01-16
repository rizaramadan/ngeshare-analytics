// Generic function to sync a single table with UPSERT logic

import { getLastSyncTimestamp, logSyncStart, logSyncComplete } from './syncLog.js';
import { ensureFkPlaceholders } from './fkPlaceholders.js';
import { logger } from '../utils/logger.js';

/**
 * Syncs a table from source to destination using UPSERT
 *
 * @param {Pool} sourcePool - Source database pool
 * @param {Pool} destPool - Destination database pool
 * @param {Object} tableConfig - Table configuration from tableConfigs.js
 * @returns {Promise<{rowsSynced: number, success: boolean}>}
 */
export async function syncTable(sourcePool, destPool, tableConfig) {
  const { name, timestampCol, columns, primaryKey, hasSoftDelete, fkColumns = [], sourceFilter } = tableConfig;

  logger.info(`Starting sync for table: ${name}`);

  // Get last sync timestamp for incremental sync
  const lastSync = await getLastSyncTimestamp(destPool, name);

  // Determine the new sync timestamp (current max updatedAt from source)
  const maxTimestampResult = await sourcePool.query(
    `SELECT MAX("${timestampCol}") as max_ts FROM "${name}"`
  );
  const newSyncTimestamp = maxTimestampResult.rows[0]?.max_ts || new Date();

  const logId = await logSyncStart(destPool, name, newSyncTimestamp);

  // Start transaction on destination
  const client = await destPool.connect();

  try {
    await client.query('BEGIN');

    // Ensure FK placeholders exist first
    if (fkColumns.length > 0) {
      await ensureFkPlaceholders(sourcePool, client, name, fkColumns);
    }

    // Build SELECT query for source (incremental if lastSync exists)
    let selectQuery = `SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${name}"`;
    const params = [];
    const whereClauses = [];

    if (lastSync) {
      params.push(lastSync);
      whereClauses.push(`"${timestampCol}" > $${params.length}`);
      logger.debug(`Incremental sync from ${lastSync.toISOString()}`);
    } else {
      logger.debug('Full sync (no previous sync found)');
    }

    // Apply source filter if specified
    if (sourceFilter) {
      whereClauses.push(`(${sourceFilter})`);
      logger.debug(`Applying source filter`);
    }

    if (whereClauses.length > 0) {
      selectQuery += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    selectQuery += ` ORDER BY "${timestampCol}" ASC`;

    // Fetch from source
    const sourceResult = await sourcePool.query(selectQuery, params);
    const rows = sourceResult.rows;

    if (rows.length === 0) {
      logger.info(`No new records to sync for ${name}`);
      await client.query('COMMIT');
      await logSyncComplete(destPool, logId, 0);
      return { rowsSynced: 0, success: true };
    }

    logger.info(`Found ${rows.length} records to sync for ${name}`);

    // Build UPSERT query
    const upsertQuery = buildUpsertQuery(name, columns, primaryKey);

    // Process in batches of 1000
    const BATCH_SIZE = 1000;
    let totalSynced = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      for (const row of batch) {
        const values = columns.map((col) => row[col]);
        await client.query(upsertQuery, values);
        totalSynced++;
      }

      logger.debug(`Synced ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} records`);
    }

    // Handle soft deletes for tables that support it
    if (hasSoftDelete) {
      const deletedCount = await syncSoftDeletes(sourcePool, client, name, primaryKey, lastSync);
      if (deletedCount > 0) {
        logger.info(`Updated ${deletedCount} soft-deleted records in ${name}`);
      }
    }

    await client.query('COMMIT');
    await logSyncComplete(destPool, logId, totalSynced);

    logger.info(`Successfully synced ${totalSynced} records to ${name}`);
    return { rowsSynced: totalSynced, success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    await logSyncComplete(destPool, logId, 0, 'failed', error.message);
    logger.error(`Failed to sync ${name}: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Builds an UPSERT (INSERT ... ON CONFLICT UPDATE) query
 */
function buildUpsertQuery(tableName, columns, primaryKey) {
  const quotedCols = columns.map((c) => `"${c}"`);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const updateSet = columns
    .filter((c) => c !== primaryKey)
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');

  return `
    INSERT INTO "${tableName}" (${quotedCols.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT ("${primaryKey}") DO UPDATE SET ${updateSet}
  `;
}

/**
 * Syncs soft-deleted records (propagates deletedAt from source to dest)
 */
async function syncSoftDeletes(sourcePool, destClient, tableName, primaryKey, lastSync) {
  // Find records that were soft-deleted since last sync
  let query = `
    SELECT "${primaryKey}", "deletedAt"
    FROM "${tableName}"
    WHERE "deletedAt" IS NOT NULL
  `;

  const params = [];
  if (lastSync) {
    query += ` AND "deletedAt" > $1`;
    params.push(lastSync);
  }

  const result = await sourcePool.query(query, params);

  if (result.rows.length === 0) return 0;

  // Update deletedAt in destination
  const updateQuery = `
    UPDATE "${tableName}"
    SET "deletedAt" = $1
    WHERE "${primaryKey}" = $2
  `;

  for (const row of result.rows) {
    await destClient.query(updateQuery, [row.deletedAt, row[primaryKey]]);
  }

  return result.rows.length;
}
