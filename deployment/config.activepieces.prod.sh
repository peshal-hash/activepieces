#!/bin/bash

# Production Environment Configuration
ENVIRONMENT_NAME="Production"
RESOURCE_GROUP="salesoptai-container-prod"
ACR_NAME="salesoptaiprod"
LOCATION="canadaeast"
BICEP_FILE="./activepieces-prod.bicep" # Assumes bicep file is in the same directory

# App-specific names
APP_NAME_ACTIVEPIECES="salesoptai-activepieces-app-prod"

# Set to 'Multiple' for Blue/Green and 'Single' for standard deployments
REVISION_MODE="Multiple"
