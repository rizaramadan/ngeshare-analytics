# ngeShare Analytics

Local analytics and sync tool for ngeShare platform data analysis.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for sync scripts)
- Bash shell (Linux, macOS, or WSL on Windows)

## Quick Start

### 1. Start the Database

```bash
docker compose up -d
```

This will start a PostgreSQL 15 database container with persistent storage.

### 2. Run Schema Migration

```bash
./migrate.sh
```

This will:
- Check if Docker and database are running
- Apply the schema from `schema.sql`
- Verify that all tables were created successfully

### 3. Verify Schema

```bash
./verify-schema.sh
```

This will validate that all required tables and indexes exist.

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your production database credentials
```

### 5. Run Data Sync

```bash
npm install   # First time only
npm run sync  # Sync data from production to local
```

This will sync tables in FK dependency order: User → Hangout → HangoutEpisode → HangoutGroup → UserHangoutGroup.

## Database Configuration

The local database uses the following default configuration (defined in `docker-compose.yml`):

- **Host**: localhost
- **Port**: 5432
- **Database**: ngeshare_analytics
- **User**: ngeshare
- **Password**: ngeshare_local_password

You can override these using environment variables:

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=ngeshare_analytics
export DB_USER=ngeshare
export DB_PASSWORD=ngeshare_local_password
```

## Project Structure

```
.
├── docker-compose.yml          # PostgreSQL container configuration
├── schema.sql                  # Database schema definition
├── migrate.sh                  # Schema migration script
├── verify-schema.sh            # Schema validation script
├── package.json                # Node.js dependencies
├── .env.example                # Environment variable template
├── src/                        # Sync script source code
│   ├── index.js                # Main entry point
│   ├── config/database.js      # Database configurations
│   ├── db/                     # Connection pool management
│   └── sync/                   # Sync logic (incremental UPSERT)
├── new-plan.md                 # Implementation plan
├── context.md                  # Project context
└── ADR/                        # Architecture Decision Records
    ├── 001-js-postgre.md       # Technology stack decision
    └── 002-schema-migration-script.md  # Migration approach decision
```

## Development Workflow

1. Make changes to `schema.sql` if needed
2. Run `./migrate.sh` to apply changes (idempotent - safe to run multiple times)
3. Run `./verify-schema.sh` to confirm schema is correct

## Schema Overview

The database includes the following main tables:

- `User` - User accounts
- `Hangout` - Course/program definitions
- `HangoutEpisode` - Individual course sessions
- `HangoutGroup` - Active learning groups
- `UserHangoutGroup` - Group membership (members and facilitators)
- `UserHangoutGroupAttendance` - Attendance records
- `sync_log` - Audit trail for data synchronization

Supporting tables:
- `CircleProfile`, `Image`, `HangoutProgram`, `Order`

## Next Steps

See `new-plan.md` for the full implementation plan. The current status:

- ✅ Phase 1.1: Local DB Setup (docker-compose.yml)
- ✅ Phase 1.1: Schema definition (schema.sql)
- ✅ Phase 1.1: Schema migration (migrate.sh)
- ✅ Phase 1.2: Base Sync Script (src/)
- ⏭️ Phase 1.3: Attendance Sync (window sync)

## Architecture Decisions

All significant technical decisions are documented in the `ADR/` directory:

- [ADR 001: Technology Stack (Node.js & PostgreSQL)](ADR/001-js-postgre.md)
- [ADR 002: Schema Migration Using Shell Script](ADR/002-schema-migration-script.md)

## Troubleshooting

### Database container won't start

```bash
# Check container status
docker compose ps

# View logs
docker compose logs postgres

# Restart container
docker compose restart postgres
```

### Migration fails

```bash
# Check if database is ready
docker compose exec postgres pg_isready -U ngeshare -d ngeshare_analytics

# Connect to database manually
docker compose exec postgres psql -U ngeshare -d ngeshare_analytics
```

### Reset database

```bash
# Stop and remove container and volumes
docker compose down -v

# Restart and re-run migration
docker compose up -d
./migrate.sh
```
