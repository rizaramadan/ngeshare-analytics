// Ensures FK placeholder records exist before syncing main tables

import { logger } from '../utils/logger.js';
import { FK_TABLE_MAP } from './tableConfigs.js';

/**
 * Ensures placeholder records exist for FK references
 * If destination already has data in FK tables, skip placeholder creation
 * Otherwise, try to sync the FK records from source
 */
export async function ensureFkPlaceholders(sourcePool, destClient, tableName, fkColumns) {
  if (!fkColumns || fkColumns.length === 0) return;

  for (const fkCol of fkColumns) {
    const refTable = FK_TABLE_MAP[fkCol];
    if (!refTable) continue;

    // Check if dest table already has data - if so, skip placeholder creation
    const countResult = await destClient.query(`SELECT COUNT(*) as cnt FROM "${refTable}"`);
    if (parseInt(countResult.rows[0].cnt) > 0) {
      logger.debug(`${refTable} already has data, skipping placeholder creation`);
      continue;
    }

    // Get distinct FK values from source that we need
    const sourceQuery = `
      SELECT DISTINCT "${fkCol}" as fk_id
      FROM "${tableName}"
      WHERE "${fkCol}" IS NOT NULL
    `;
    const sourceResult = await sourcePool.query(sourceQuery);
    const fkIds = sourceResult.rows.map((r) => r.fk_id);

    if (fkIds.length === 0) continue;

    // Try to insert minimal placeholders (ignore conflicts)
    // This may fail if the table has required columns we don't know about
    try {
      const insertQuery = `
        INSERT INTO "${refTable}" (id, "createdAt", "updatedAt")
        SELECT unnest($1::text[]), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ON CONFLICT (id) DO NOTHING
      `;
      const result = await destClient.query(insertQuery, [fkIds]);
      if (result.rowCount > 0) {
        logger.debug(`Created ${result.rowCount} placeholder(s) in ${refTable} for ${tableName}.${fkCol}`);
      }
    } catch (err) {
      logger.debug(`Could not create placeholders in ${refTable}: ${err.message}`);
    }
  }
}
