#!/bin/bash
# Create the contabilidade module database if it doesn't exist
# This runs as part of the PostgreSQL init scripts (00-*.sh runs before 01-*.sql)

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE viaoceanica_contabilidade OWNER viaoceanica'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'viaoceanica_contabilidade')\gexec
EOSQL

echo "Database viaoceanica_contabilidade ensured."
