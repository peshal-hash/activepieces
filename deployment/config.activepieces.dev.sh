#!/bin/bash

# Development Environment Configuration
ENVIRONMENT_NAME="Development"
RESOURCE_GROUP="testing-containers"
ACR_NAME="salesopttest"
LOCATION="eastus"
BICEP_FILE="./activepieces.bicep"
KEY_VAULT_NAME="salesopt-kv-test"

UNIQUE_ID=$(head -c 4 /dev/urandom | xxd -p)

# App-specific name for the Activepieces container
APP_NAME_ACTIVEPIECES="salesopt-activepieces-app"

# Names for your new Postgres and Redis resources
POSTGRES_SERVER_NAME="salesopt-pg-server-dev-${UNIQUE_ID}"
POSTGRES_ADMIN_USER="salesoptadmin"
REDIS_CACHE_NAME="salesopt-redis-cache-dev-${UNIQUE_ID}"
