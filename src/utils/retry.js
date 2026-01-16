// Generic retry wrapper with exponential backoff

import { logger } from './logger.js';

/**
 * Executes a function with retry logic and exponential backoff
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelayMs - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 10000)
 * @param {string} options.name - Operation name for logging
 * @returns {Promise<any>} Result of fn()
 */
export async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    name = 'operation',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        logger.error(`${name} failed after ${maxRetries} attempts: ${error.message}`);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      logger.warn(`${name} attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
