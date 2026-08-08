// Database configuration from environment variables
// Supports both connection URLs (PRODUCTION_DB, LOCAL_DB) and individual variables

function parseConnectionUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "5432", 10),
      database: parsed.pathname.slice(1), // remove leading /
      user: parsed.username,
      password: decodeURIComponent(parsed.password),
      ssl:
        parsed.searchParams.get("sslmode") !== "disable"
          ? { rejectUnauthorized: false }
          : false,
    };
  } catch {
    return null;
  }
}

// Source config: prefer NEW_PRODUCTION_DB URL, fallback to PRODUCTION_DB, then individual vars
const sourceUrl = process.env.NEW_PRODUCTION_DB || process.env.PRODUCTION_DB;
const sourceFromUrl = parseConnectionUrl(sourceUrl);
export const sourceConfig = sourceFromUrl
  ? {
      connectionString: sourceUrl, // Use full connection string to preserve query params (sslmode, channel_binding, options)
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || "5432", 10),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      ssl:
        process.env.SOURCE_DB_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

// Dest config: prefer LOCAL_DB URL, fallback to individual vars or defaults
const destFromUrl = parseConnectionUrl(process.env.LOCAL_DB);
export const destConfig = destFromUrl
  ? {
      ...destFromUrl,
      ssl: false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }
  : {
      host: process.env.DEST_DB_HOST || "localhost",
      port: parseInt(process.env.DEST_DB_PORT || "5432", 10),
      database: process.env.DEST_DB_NAME || "ngeshare_local",
      user: process.env.DEST_DB_USER || "postgreuser",
      password: process.env.DEST_DB_PASSWORD || "mainmain",
      ssl: false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
