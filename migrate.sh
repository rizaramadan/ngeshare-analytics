#!/bin/bash
# Schema Migration Script for ngeShare Analytics Local Database
# This script applies the schema.sql to the local PostgreSQL database

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Database connection parameters
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ngeshare_analytics}"
DB_USER="${DB_USER:-ngeshare}"
DB_PASSWORD="${DB_PASSWORD:-ngeshare_local_password}"

echo -e "${YELLOW}ngeShare Analytics - Schema Migration${NC}"
echo "========================================"
echo ""

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running${NC}"
    echo "Please start Docker and ensure the database container is running:"
    echo "  docker compose up -d"
    exit 1
fi

# Check if postgres container is running
if ! docker compose ps | grep -q "ngeshare-analytics-db.*running"; then
    echo -e "${YELLOW}Database container is not running. Starting it now...${NC}"
    docker compose up -d
    echo "Waiting for database to be ready..."
    sleep 5
fi

# Wait for database to be healthy
echo "Checking database health..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker compose exec -T postgres pg_isready -U $DB_USER -d $DB_NAME > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Database is ready${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for database... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}Error: Database did not become ready in time${NC}"
    exit 1
fi

# Run schema migration
echo ""
echo "Applying schema migration..."
export PGPASSWORD=$DB_PASSWORD

if docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME < schema.sql > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Schema migration completed successfully${NC}"
else
    echo -e "${RED}Error: Schema migration failed${NC}"
    exit 1
fi

# Verify tables were created
echo ""
echo "Verifying schema..."
TABLE_COUNT=$(docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")

echo "Tables created: $TABLE_COUNT"

if [ $TABLE_COUNT -gt 0 ]; then
    echo -e "${GREEN}✓ Schema verification passed${NC}"
    echo ""
    echo "Tables in database:"
    docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
else
    echo -e "${RED}Error: No tables found in database${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Schema migration completed successfully!${NC}"
