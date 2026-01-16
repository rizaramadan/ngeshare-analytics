# ADR 002: Schema Migration Using Shell Script

## Status
Accepted

## Context
The ngeShare Analytics project requires a reliable way to initialize and migrate the local PostgreSQL database schema. We need to:

1. Apply the initial schema (tables, indexes, constraints) to the local database
2. Ensure the migration is idempotent (can be run multiple times safely)
3. Provide clear feedback on migration success/failure
4. Handle cases where Docker or the database is not ready
5. Make it easy for developers to set up their local environment

## Decision
We will use a Bash shell script (`migrate.sh`) for schema migrations with the following characteristics:

### Approach
- Single shell script that orchestrates the entire migration process
- Uses `schema.sql` as the source of truth for database structure
- All tables use `CREATE TABLE IF NOT EXISTS` for idempotency
- Executes SQL via Docker Compose exec to the running PostgreSQL container

### Key Features
1. **Pre-flight Checks**: Validates Docker is running and database container is available
2. **Auto-start**: Automatically starts the database container if not running
3. **Health Checks**: Waits for database to be ready before applying schema (max 30 retries)
4. **Transaction Safety**: PostgreSQL DDL is transactional, ensuring atomicity
5. **Verification**: Confirms tables were created by querying `information_schema`
6. **User Feedback**: Color-coded output for success/warning/error states

### Why Shell Script vs. Migration Tools
**Rejected Alternatives:**
- **Node.js migration tools** (e.g., Knex, TypeORM, Sequelize migrations):
  - ❌ Adds dependencies and complexity for simple one-time setup
  - ❌ Requires Node.js environment to be set up first
  - ✅ Would be better for versioned migrations in production

- **SQL-only approach** (just running `psql < schema.sql`):
  - ❌ No error handling or validation
  - ❌ No feedback on success/failure
  - ❌ Doesn't check if database is ready

- **Docker entrypoint initialization** (mounting schema.sql to `/docker-entrypoint-initdb.d/`):
  - ❌ Only runs on first container creation, not on restarts
  - ❌ Harder to re-run if schema changes during development
  - ✅ Simple but inflexible

### Usage
```bash
# First time setup
./migrate.sh

# Re-run after schema changes (idempotent)
./migrate.sh
```

## Consequences

### Positive
- ✅ Simple, self-contained, no additional dependencies
- ✅ Idempotent: Safe to run multiple times
- ✅ Clear error messages and validation
- ✅ Works across different development environments (Linux, macOS, WSL)
- ✅ Easy to extend with additional validation or data seeding

### Negative
- ⚠️ Requires Bash shell (not Windows-native without WSL)
- ⚠️ Not suitable for complex versioned migrations in production
- ⚠️ Manual execution required (not automated on container start)

### Migration Path
For future production deployment or versioned migrations, we can:
1. Keep `migrate.sh` for local development
2. Add proper migration tools (e.g., Flyway, Liquibase, or TypeORM) for production
3. Use `schema.sql` as the baseline/initial migration

## References
- Related: ADR 001 (Technology stack decision)
- Implementation: `migrate.sh`, `schema.sql`
- Plan: Section 1.1.4 "Run schema migration on local DB"
