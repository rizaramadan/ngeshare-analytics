// Database configuration from environment variables

export const sourceConfig = {
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432', 10),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  ssl: process.env.SOURCE_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Connection pool settings
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

export const destConfig = {
  host: process.env.DEST_DB_HOST || 'localhost',
  port: parseInt(process.env.DEST_DB_PORT || '5432', 10),
  database: process.env.DEST_DB_NAME || 'ngeshare_analytics',
  user: process.env.DEST_DB_USER || 'ngeshare',
  password: process.env.DEST_DB_PASSWORD || 'ngeshare_local_password',
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};
