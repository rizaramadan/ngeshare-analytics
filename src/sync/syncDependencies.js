// Ensures FK dependencies exist before syncing main tables
// This handles cases where referenced records weren't caught by incremental sync

import { logger } from '../utils/logger.js';

/**
 * Maps table names to their FK dependencies
 * Key: table name, Value: array of { fkColumn, refTable, refColumns }
 */
const TABLE_DEPENDENCIES = {
  UserHangoutGroup: [
    {
      fkColumn: 'userId',
      refTable: 'User',
      refColumns: ['id', 'createdAt', 'updatedAt', 'email', 'lastLogin', 'lastActive', 'deletedAt'],
    },
    {
      fkColumn: 'hangoutGroupId',
      refTable: 'HangoutGroup',
      refColumns: [
        'id',
        'createdAt',
        'updatedAt',
        'name',
        'description',
        'status',
        'day',
        'time',
        'hangoutId',
        'imageId',
        'endDate',
        'startDate',
        'city',
        'province',
      ],
    },
  ],
  UserHangoutGroupAttendance: [
    {
      fkColumn: 'userId',
      refTable: 'User',
      refColumns: ['id', 'createdAt', 'updatedAt', 'email', 'lastLogin', 'lastActive', 'deletedAt'],
    },
    {
      fkColumn: 'hangoutGroupId',
      refTable: 'HangoutGroup',
      refColumns: [
        'id',
        'createdAt',
        'updatedAt',
        'name',
        'description',
        'status',
        'day',
        'time',
        'hangoutId',
        'imageId',
        'endDate',
        'startDate',
        'city',
        'province',
      ],
    },
    {
      fkColumn: 'hangoutEpisodeId',
      refTable: 'HangoutEpisode',
      refColumns: ['id', 'createdAt', 'updatedAt', 'name', 'description', 'hangoutId', 'order'],
    },
  ],
};

/**
 * Syncs missing FK dependencies before syncing the main table
 *
 * @param {Pool} sourcePool - Source database pool
 * @param {Pool} destPool - Destination database pool
 * @param {string} tableName - Main table being synced
 * @param {string} timestampCol - Timestamp column for incremental sync
 * @param {Date|null} lastSync - Last sync timestamp
 * @returns {Promise<{table: string, synced: number}[]>} Dependencies synced
 */
export async function syncMissingDependencies(sourcePool, destPool, tableName, timestampCol, lastSync) {
  const dependencies = TABLE_DEPENDENCIES[tableName];
  if (!dependencies) return [];

  const results = [];

  for (const dep of dependencies) {
    const { fkColumn, refTable, refColumns } = dep;

    // Step 1: Get FK IDs that will be referenced by records to sync
    let fkQuery = `
      SELECT DISTINCT "${fkColumn}" as fk_id
      FROM "${tableName}"
      WHERE "${fkColumn}" IS NOT NULL
    `;
    const params = [];

    if (lastSync) {
      params.push(lastSync);
      fkQuery += ` AND "${timestampCol}" > $1`;
    }

    const fkResult = await sourcePool.query(fkQuery, params);
    const fkIds = fkResult.rows.map((r) => r.fk_id).filter((id) => id != null);

    if (fkIds.length === 0) {
      logger.debug(`No ${fkColumn} references to check for ${tableName}`);
      continue;
    }

    // Step 2: Find which of these IDs are missing in destination
    const missingQuery = `
      SELECT unnest($1::text[]) as id
      EXCEPT
      SELECT id FROM "${refTable}"
    `;
    const missingResult = await destPool.query(missingQuery, [fkIds]);
    const missingIds = missingResult.rows.map((r) => r.id);

    if (missingIds.length === 0) {
      logger.debug(`All ${refTable} dependencies exist for ${tableName}`);
      continue;
    }

    logger.info(`Found ${missingIds.length} missing ${refTable} records needed by ${tableName}`);

    // Step 3: Sync only the missing records from source
    const quotedCols = refColumns.map((c) => `"${c}"`).join(', ');
    const selectQuery = `
      SELECT ${quotedCols}
      FROM "${refTable}"
      WHERE id = ANY($1::text[])
    `;
    const sourceRows = await sourcePool.query(selectQuery, [missingIds]);

    if (sourceRows.rows.length === 0) {
      logger.warn(`Could not find ${missingIds.length} ${refTable} records in source`);
      continue;
    }

    // Step 4: Insert missing records into destination
    const placeholders = refColumns.map((_, i) => `$${i + 1}`).join(', ');
    const upsertQuery = `
      INSERT INTO "${refTable}" (${quotedCols})
      VALUES (${placeholders})
      ON CONFLICT (id) DO UPDATE SET ${refColumns
        .filter((c) => c !== 'id')
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ')}
    `;

    const client = await destPool.connect();
    try {
      await client.query('BEGIN');

      for (const row of sourceRows.rows) {
        const values = refColumns.map((col) => row[col]);
        await client.query(upsertQuery, values);
      }

      await client.query('COMMIT');
      logger.info(`Synced ${sourceRows.rows.length} missing ${refTable} records`);
      results.push({ table: refTable, synced: sourceRows.rows.length });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Failed to sync missing ${refTable}: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  return results;
}
