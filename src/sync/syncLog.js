// Functions to interact with sync_log table for incremental sync tracking

/**
 * Gets the last successful sync timestamp for a table
 * @param {Pool} destPool - Destination database pool
 * @param {string} tableName - Name of the table
 * @returns {Promise<Date|null>} Last sync timestamp or null if never synced
 */
export async function getLastSyncTimestamp(destPool, tableName) {
  const query = `
    SELECT last_sync_timestamp
    FROM sync_log
    WHERE table_name = $1
      AND status = 'completed'
    ORDER BY sync_completed_at DESC
    LIMIT 1
  `;
  const result = await destPool.query(query, [tableName]);
  return result.rows[0]?.last_sync_timestamp || null;
}

/**
 * Logs the start of a sync operation
 * @returns {Promise<number>} The sync_log entry ID
 */
export async function logSyncStart(destPool, tableName, lastSyncTimestamp) {
  const query = `
    INSERT INTO sync_log (table_name, status, last_sync_timestamp)
    VALUES ($1, 'in_progress', $2)
    RETURNING id
  `;
  const result = await destPool.query(query, [tableName, lastSyncTimestamp]);
  return result.rows[0].id;
}

/**
 * Logs completion of a sync operation
 */
export async function logSyncComplete(destPool, logId, rowsSynced, status = 'completed', errorMessage = null) {
  const query = `
    UPDATE sync_log
    SET sync_completed_at = CURRENT_TIMESTAMP,
        rows_synced = $1,
        status = $2,
        error_message = $3
    WHERE id = $4
  `;
  await destPool.query(query, [rowsSynced, status, errorMessage, logId]);
}
