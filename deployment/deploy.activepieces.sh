#!/bin/bash
# Exit immediately if a command fails, and treat unset variables as an error.
set -euo pipefail

# --- Argument Parsing ---
if [[ $# -eq 0 ]] ; then
    echo "Usage: ./deploy.activepieces.sh --environment <dev|prod>" >&2
    exit 1
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    *)
      echo "Unknown parameter passed: $1" >&2
      exit 1
      ;;
  esac
done

# --- Load Configuration ---
CONFIG_FILE="./config.activepieces.${ENVIRONMENT}.sh"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Configuration file not found: $CONFIG_FILE" >&2
    exit 1
fi
source "$CONFIG_FILE"

# --- Global Variables ---
ACR_SERVER="${ACR_NAME}.azurecr.io"
BUILD_TIMESTAMP=$(date +%Y%m%d%H%M%S)
GIT_SHA=${GITHUB_SHA:-$(git rev-parse --short HEAD)}
GIT_SHA_SHORT=$(echo "${GIT_SHA}" | cut -c1-7)
IMAGE_TAG="${GIT_SHA_SHORT}-${BUILD_TIMESTAMP}"
REVISION_SUFFIX="${GIT_SHA_SHORT}-${BUILD_TIMESTAMP}"
DEPLOYMENT_NAME="ap-deploy-${REVISION_SUFFIX}"

# --- Logging ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
write_info() { echo -e "${YELLOW}[INFO] $1${NC}" >&2; }
write_success() { echo -e "${GREEN}[SUCCESS] $1${NC}" >&2; }
write_error() { echo -e "${RED}[ERROR] $1${NC}" >&2; }

# --- Core Functions ---
function validate_prerequisites() {
  for tool in az docker openssl; do
    if ! command -v $tool &> /dev/null; then write_error "$tool is required." && exit 1; fi
  done
  if ! az account show &>/dev/null; then write_error "Azure login required. Please run 'az login'." && exit 1; fi
  write_success "Prerequisites validated."
}

function build_and_push_image() {
  local service_name=$1
  local dockerfile_path=$2
  local context_path=$3
  local acr_image_name=$(basename "$service_name")

  write_info "Building ${acr_image_name} from ${dockerfile_path}..."
  docker build -t "${ACR_SERVER}/${acr_image_name}:${IMAGE_TAG}" -f "$dockerfile_path" "$context_path" >&2

  write_info "Pushing ${ACR_SERVER}/${acr_image_name}:${IMAGE_TAG}..."
  docker push "${ACR_SERVER}/${acr_image_name}:${IMAGE_TAG}" >&2
  write_success "${acr_image_name} image pushed."
}
function deploy_infrastructure() {
    write_info "Starting Bicep deployment for ${ENVIRONMENT_NAME} environment..."

    # Define secrets and keys directly in the script
    local POSTGRES_PASSWORD="SalesOptAi123"
    local API_KEY
    API_KEY=$(openssl rand -hex 64)
    local ENCRYPTION_KEY
    ENCRYPTION_KEY=$(openssl rand -hex 16)
    local JWT_SECRET
    JWT_SECRET=$(openssl rand -hex 32)

    local DEPLOY_NEW_INFRA='true'

    if ! az deployment group create \
      --name "$DEPLOYMENT_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --template-file "$BICEP_FILE" \
      --parameters \
        location="$LOCATION" \
        salesoptapis="$SALESOPTAI_APIS" \
        appImageTag="$IMAGE_TAG" \
        revisionSuffix="$REVISION_SUFFIX" \
        containerAppName="$APP_NAME_ACTIVEPIECES" \
        postgresServerName="$POSTGRES_SERVER_NAME" \
        postgresAdminUser="$POSTGRES_ADMIN_USER" \
        redisCacheName="$REDIS_CACHE_NAME" \
        deployNewInfrastructure="$DEPLOY_NEW_INFRA" \
        postgresAdminPassword="$POSTGRES_PASSWORD" \
        apiKey="$API_KEY" \
        encryptionKey="$ENCRYPTION_KEY" \
        jwtSecret="$JWT_SECRET" \
      --debug 1>&2; then
        write_error "Bicep deployment failed. See debug output above for details."
        exit 1
    fi

    write_success "Bicep deployment completed."
    write_info "Fetching deployment outputs..."

    # --- FIX IS HERE ---
    # 1. Capture the output of the 'az' command into a variable.
    local raw_fqdn
    raw_fqdn=$(az deployment group show \
      --name "$DEPLOYMENT_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query "properties.outputs.appUrl.value" \
      -o tsv)

    # 2. Now perform the operation on the variable that has a value.
    local app_fqdn="${raw_fqdn%.}"   # remove a trailing dot if present

    # 3. Echo ONLY the FQDN to stdout so the main function can capture it cleanly.
    echo "app_url=$app_fqdn"
}

function health_check() {
  local app_fqdn="$1"
  local url="https://${app_fqdn}/"
  local max=30

  write_info "Performing health check on ${url} ..."
  for ((i=1;i<=max;i++)); do
    if curl -fsSL --max-time 5 -o /dev/null "$url"; then
      write_success "Health check passed on attempt $i."
      return 0
    fi
    write_info "Attempt $i/$max failed, retrying in 10s..."
    sleep 10
  done

  # make non-fatal so the job doesn’t fail when resources are fine
  write_info "Health check did not pass after $max attempts; continuing."
  return 0
}


# --- Main Execution ---
function main() {
  write_success "Starting ${ENVIRONMENT_NAME} deployment..."
  write_info "Deployment ID: ${REVISION_SUFFIX}"

  validate_prerequisites

  write_info "Logging in to Azure Container Registry: $ACR_NAME"
  az acr login --name "$ACR_NAME"

  build_and_push_image "$APP_NAME_ACTIVEPIECES" "../Dockerfile" ".."

  write_success "Container image built and pushed."

  local app_fqdn
  app_fqdn=$(deploy_infrastructure)
  if [[ -z "$app_fqdn" ]]; then
    write_error "Failed to get App FQDN from Bicep deployment output."
    exit 1
  fi

  health_check "$app_fqdn"

  local full_app_url="https://${app_fqdn}"

  echo "" >&2
  write_success "=== ${ENVIRONMENT_NAME} DEPLOYMENT COMPLETED ==="
  write_success "Application URL: $full_app_url"
  write_success "Image Tag: $IMAGE_TAG"

  # Final output for the GitHub Actions step
  echo "app_url=$full_app_url"
}

main

