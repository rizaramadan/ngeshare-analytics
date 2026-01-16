// Singleton pool instances for source and destination databases

import { createPool, closePool } from './connection.js';
import { sourceConfig, destConfig } from '../config/database.js';

let sourcePool = null;
let destPool = null;

export async function getSourcePool() {
  if (!sourcePool) {
    sourcePool = await createPool(sourceConfig, 'source');
  }
  return sourcePool;
}

export async function getDestPool() {
  if (!destPool) {
    destPool = await createPool(destConfig, 'dest');
  }
  return destPool;
}

export async function closePools() {
  await closePool(sourcePool, 'source');
  await closePool(destPool, 'dest');
  sourcePool = null;
  destPool = null;
}
