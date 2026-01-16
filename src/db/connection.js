// Connection pool factory with retry logic

import pg from 'pg';
import { retry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

/**
 * Creates a PostgreSQL connection pool with retry logic
 * @param {Object} config - pg Pool configuration
 * @param {string} name - Pool name for logging ('source' or 'dest')
 * @returns {Promise<Pool>} Connected pool instance
 */
export async function createPool(config, name) {
  const pool = new Pool(config);

  // Test connection with retry
  await retry(
    async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        logger.info(`Connected to ${name} database`);
      } finally {
        client.release();
      }
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      name: `${name} connection`,
    }
  );

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error(`Unexpected error on ${name} pool:`, err.message);
  });

  return pool;
}

/**
 * Gracefully closes a pool
 */
export async function closePool(pool, name) {
  if (pool) {
    await pool.end();
    logger.info(`Closed ${name} database connection`);
  }
}
