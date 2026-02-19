// Script to fix orphaned UserHangoutGroup records by syncing missing User records
// Run with: DB_HOST=localhost DB_NAME=ngeshare_local DB_USER=postgreuser DB_PASSWORD=mainmain node src/sync/fixOrphanedUsers.js

import 'dotenv/config';
import { getSourcePool, getDestPool, closePools } from '../db/pools.js';
import { logger } from '../utils/logger.js';

const USER_COLUMNS = ['id', 'createdAt', 'updatedAt', 'email', 'lastLogin', 'lastActive', 'deletedAt'];

async function fixOrphanedUsers() {
  logger.info('=== Fix Orphaned Users Script ===');
  logger.info(`LOCAL_DB: ${process.env.LOCAL_DB || '(not set, using fallback)'}`);

  let sourcePool, destPool;

  try {
    logger.info('Connecting to databases...');
    sourcePool = await getSourcePool();
    destPool = await getDestPool();

    // Step 1: Find missing User IDs from UserHangoutGroup
    const missingFromUHG = await destPool.query(`
      SELECT DISTINCT uhg."userId" as id
      FROM "UserHangoutGroup" uhg
      LEFT JOIN "User" u ON u.id = uhg."userId"
      WHERE u.id IS NULL AND uhg."userId" IS NOT NULL
    `);

    // Step 2: Find missing User IDs from UserHangoutGroupAttendance
    const missingFromAttendance = await destPool.query(`
      SELECT DISTINCT a."userId" as id
      FROM "UserHangoutGroupAttendance" a
      LEFT JOIN "User" u ON u.id = a."userId"
      WHERE u.id IS NULL AND a."userId" IS NOT NULL
    `);

    // Combine and dedupe
    const allMissingIds = [
      ...missingFromUHG.rows.map((r) => r.id),
      ...missingFromAttendance.rows.map((r) => r.id),
    ];
    const uniqueMissingIds = [...new Set(allMissingIds)];

    if (uniqueMissingIds.length === 0) {
      logger.info('No orphaned User records found. Database is clean!');
      return;
    }

    logger.info(`Found ${uniqueMissingIds.length} missing User records`);
    logger.info(`  - From UserHangoutGroup: ${missingFromUHG.rows.length}`);
    logger.info(`  - From UserHangoutGroupAttendance: ${missingFromAttendance.rows.length}`);

    // Step 3: Fetch missing users from production
    const quotedCols = USER_COLUMNS.map((c) => `"${c}"`).join(', ');
    const sourceUsers = await sourcePool.query(
      `SELECT ${quotedCols} FROM "User" WHERE id = ANY($1::text[])`,
      [uniqueMissingIds]
    );

    if (sourceUsers.rows.length === 0) {
      logger.warn('Could not find any of the missing users in production database');
      logger.warn('These users may have been deleted from production');
      return;
    }

    if (sourceUsers.rows.length < uniqueMissingIds.length) {
      const foundIds = sourceUsers.rows.map((r) => r.id);
      const notFoundIds = uniqueMissingIds.filter((id) => !foundIds.includes(id));
      logger.warn(`${notFoundIds.length} users not found in production (may be deleted):`);
      notFoundIds.forEach((id) => logger.warn(`  - ${id}`));
    }

    logger.info(`Found ${sourceUsers.rows.length} users in production to sync`);

    // Step 4: Insert into destination
    const placeholders = USER_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const upsertQuery = `
      INSERT INTO "User" (${quotedCols})
      VALUES (${placeholders})
      ON CONFLICT (id) DO UPDATE SET ${USER_COLUMNS.filter((c) => c !== 'id')
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ')}
    `;

    const client = await destPool.connect();
    try {
      await client.query('BEGIN');

      let synced = 0;
      for (const row of sourceUsers.rows) {
        const values = USER_COLUMNS.map((col) => row[col]);
        await client.query(upsertQuery, values);
        synced++;
      }

      await client.query('COMMIT');
      logger.info(`Successfully synced ${synced} missing User records`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Failed to sync users: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }

    // Step 5: Verify fix
    const remainingOrphans = await destPool.query(`
      SELECT COUNT(*) as count
      FROM "UserHangoutGroup" uhg
      LEFT JOIN "User" u ON u.id = uhg."userId"
      WHERE u.id IS NULL
    `);

    logger.info('');
    logger.info('=== Verification ===');
    logger.info(`Remaining orphaned UserHangoutGroup records: ${remainingOrphans.rows[0].count}`);

    if (parseInt(remainingOrphans.rows[0].count) === 0) {
      logger.info('All orphaned records have been fixed!');
    } else {
      logger.warn('Some orphaned records remain (users may not exist in production)');
    }
  } catch (error) {
    logger.error('Fatal error:', error.message);
    process.exitCode = 1;
  } finally {
    await closePools();
    logger.info('=== Script Complete ===');
  }
}

fixOrphanedUsers();
