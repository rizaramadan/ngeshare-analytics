// Main entry point for sync script

import 'dotenv/config';
import { getSourcePool, getDestPool, closePools } from './db/pools.js';
import { syncTable } from './sync/syncTable.js';
import { SYNC_TABLES } from './sync/tableConfigs.js';
import { logger } from './utils/logger.js';

async function main() {
  const startTime = Date.now();
  logger.info('=== ngeShare Analytics Sync Starting ===');

  let sourcePool, destPool;
  const results = [];

  try {
    // Initialize database connections
    logger.info('Connecting to databases...');
    sourcePool = await getSourcePool();
    destPool = await getDestPool();

    // Sync tables in FK dependency order
    for (const tableConfig of SYNC_TABLES) {
      try {
        const result = await syncTable(sourcePool, destPool, tableConfig);
        results.push({ table: tableConfig.name, ...result });
      } catch (error) {
        results.push({ table: tableConfig.name, success: false, error: error.message });
        // Continue with next table (don't fail entire sync)
        logger.warn(`Continuing after error in ${tableConfig.name}`);
      }
    }

    // Print summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info('');
    logger.info('=== Sync Summary ===');
    for (const r of results) {
      if (r.success) {
        logger.info(`  ${r.table}: ${r.rowsSynced} rows synced`);
      } else {
        logger.error(`  ${r.table}: FAILED - ${r.error}`);
      }
    }
    logger.info(`Total time: ${elapsed}s`);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      logger.warn(`${failures.length} table(s) failed to sync`);
      process.exitCode = 1;
    } else {
      logger.info('All tables synced successfully!');
    }
  } catch (error) {
    logger.error('Fatal error during sync:', error.message);
    process.exitCode = 1;
  } finally {
    await closePools();
    logger.info('=== Sync Complete ===');
  }
}

main();
