#!/bin/bash
# Schema Verification Script for ngeShare Analytics
# Validates that all required tables and indexes exist

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Database connection parameters
DB_NAME="${DB_NAME:-ngeshare_analytics}"
DB_USER="${DB_USER:-ngeshare}"
export PGPASSWORD="${DB_PASSWORD:-ngeshare_local_password}"

echo -e "${YELLOW}ngeShare Analytics - Schema Verification${NC}"
echo "=========================================="
echo ""

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running${NC}"
    exit 1
fi

# Check if postgres container is running
if ! docker compose ps | grep -q "ngeshare-analytics-db.*running"; then
    echo -e "${RED}Error: Database container is not running${NC}"
    echo "Start it with: docker compose up -d"
    exit 1
fi

# Expected tables
EXPECTED_TABLES=(
    "User"
    "CircleProfile"
    "Image"
    "HangoutProgram"
    "Order"
    "Hangout"
    "HangoutEpisode"
    "HangoutGroup"
    "UserHangoutGroup"
    "UserHangoutGroupAttendance"
    "sync_log"
)

# Expected indexes
EXPECTED_INDEXES=(
    "idx_user_hangout_group_group_role"
    "idx_user_hangout_group_user_joined"
    "idx_attendance_group_attended"
)

echo "Checking tables..."
MISSING_TABLES=()

for table in "${EXPECTED_TABLES[@]}"; do
    EXISTS=$(docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');")
    if [[ $EXISTS =~ "t" ]]; then
        echo -e "  ${GREEN}✓${NC} $table"
    else
        echo -e "  ${RED}✗${NC} $table (MISSING)"
        MISSING_TABLES+=("$table")
    fi
done

echo ""
echo "Checking indexes..."
MISSING_INDEXES=()

for index in "${EXPECTED_INDEXES[@]}"; do
    EXISTS=$(docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME -t -c "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = '$index');")
    if [[ $EXISTS =~ "t" ]]; then
        echo -e "  ${GREEN}✓${NC} $index"
    else
        echo -e "  ${RED}✗${NC} $index (MISSING)"
        MISSING_INDEXES+=("$index")
    fi
done

# Get table row counts
echo ""
echo "Table statistics:"
docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME -c "
    SELECT
        schemaname,
        tablename,
        n_live_tup as row_count
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
"

# Summary
echo ""
if [ ${#MISSING_TABLES[@]} -eq 0 ] && [ ${#MISSING_INDEXES[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All schema components verified successfully!${NC}"
    exit 0
else
    echo -e "${RED}✗ Schema verification failed${NC}"
    if [ ${#MISSING_TABLES[@]} -gt 0 ]; then
        echo "Missing tables: ${MISSING_TABLES[*]}"
    fi
    if [ ${#MISSING_INDEXES[@]} -gt 0 ]; then
        echo "Missing indexes: ${MISSING_INDEXES[*]}"
    fi
    echo ""
    echo "Run ./migrate.sh to apply the schema"
    exit 1
fi
