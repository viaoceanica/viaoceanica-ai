#!/bin/bash
# Create the email module database if it doesn't exist.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE viaoceanica_email OWNER viaoceanica'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'viaoceanica_email')\gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname viaoceanica_email <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL

echo "Database viaoceanica_email ensured."
