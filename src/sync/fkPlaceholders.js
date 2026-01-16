// Ensures FK placeholder records exist before syncing main tables

import { logger } from '../utils/logger.js';
import { FK_TABLE_MAP } from './tableConfigs.js';

/**
 * Ensures placeholder records exist for FK references
 * Extracts unique FK IDs from source data and creates minimal records in dest
 */
export async function ensureFkPlaceholders(sourcePool, destClient, tableName, fkColumns) {
  if (!fkColumns || fkColumns.length === 0) return;

  for (const fkCol of fkColumns) {
    const refTable = FK_TABLE_MAP[fkCol];
    if (!refTable) continue;

    // Get distinct FK values from source
    const sourceQuery = `
      SELECT DISTINCT "${fkCol}" as fk_id
      FROM "${tableName}"
      WHERE "${fkCol}" IS NOT NULL
    `;
    const sourceResult = await sourcePool.query(sourceQuery);
    const fkIds = sourceResult.rows.map((r) => r.fk_id);

    if (fkIds.length === 0) continue;

    // Insert placeholders (ignore conflicts)
    const insertQuery = `
      INSERT INTO "${refTable}" (id, "createdAt", "updatedAt")
      SELECT unnest($1::text[]), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ON CONFLICT (id) DO NOTHING
    `;
    const result = await destClient.query(insertQuery, [fkIds]);
    if (result.rowCount > 0) {
      logger.debug(`Created ${result.rowCount} placeholder(s) in ${refTable} for ${tableName}.${fkCol}`);
    }
  }
}
