#!/bin/bash
# Exit immediately if a command fails, and treat unset variables as an error.
set -euo pipefail

# --- Argument Parsing ---
# ... (this section remains the same) ...
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
# ... (this section remains the same) ...
ACR_SERVER="${ACR_NAME}.azurecr.io"
BUILD_TIMESTAMP=$(date +%Y%m%d%H%M%S)
GIT_SHA=${GITHUB_SHA:-$(git rev-parse --short HEAD)}
GIT_SHA_SHORT=$(echo "${GIT_SHA}" | cut -c1-7)
IMAGE_TAG="${GIT_SHA_SHORT}-${BUILD_TIMESTAMP}"
REVISION_SUFFIX="${GIT_SHA_SHORT}-${BUILD_TIMESTAMP}"

# --- Logging ---
# ... (this section remains the same) ...
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
write_info() { echo -e "${YELLOW}[INFO] $1${NC}" >&2; }
write_success() { echo -e "${GREEN}[SUCCESS] $1${NC}" >&2; }
write_error() { echo -e "${RED}[ERROR] $1${NC}" >&2; }

# --- Error Handling ---
# ... (this section remains the same) ...
function cleanup_on_error() {
  write_error "${ENVIRONMENT_NAME} deployment failed. Please check the logs."
  # The GitHub Actions workflow will handle deactivating failed revisions.
  exit 1
}
trap cleanup_on_error ERR

# --- NEW FUNCTION ---
# Checks if a secret exists in Key Vault. If not, it generates and stores it.
function ensure_key_vault_secret() {
  local SECRET_NAME=$1
  local GENERATION_COMMAND=$2

  write_info "Checking for secret '$SECRET_NAME' in Key Vault '$KEY_VAULT_NAME'..."
  # Try to show the secret and suppress output. A non-zero exit code means it doesn't exist.
  if ! az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "$SECRET_NAME" &> /dev/null; then
    write_info "Secret not found. Generating a new value..."
    # Execute the generation command passed as an argument
    local GENERATED_VALUE
    GENERATED_VALUE=$(eval "$GENERATION_COMMAND")

    az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "$SECRET_NAME" --value "$GENERATED_VALUE" >&2
    write_success "Successfully created and stored secret '$SECRET_NAME'."
  else
    write_success "Secret '$SECRET_NAME' already exists. Using existing value."
  fi
}

# --- Core Functions ---
# ... (validate_prerequisites and build_and_push_image remain the same) ...
function validate_prerequisites() {
  for tool in az docker; do
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

    # Read the postgres password from Key Vault to pass to Bicep
    local POSTGRES_PASSWORD
    POSTGRES_PASSWORD=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "$POSTGRES_PASSWORD_SECRET_NAME" --query "value" -o tsv)

    local DEPLOY_NEW_INFRA='true'

    az deployment group create \
      --resource-group "$RESOURCE_GROUP" \
      --template-file "$BICEP_FILE" \
      --parameters \
        appImageTag="$IMAGE_TAG" \
        revisionSuffix="$REVISION_SUFFIX" \
        containerAppName="$APP_NAME_ACTIVEPIECES" \
        postgresServerName="$POSTGRES_SERVER_NAME" \
        postgresAdminUser="$POSTGRES_ADMIN_USER" \
        redisCacheName="$REDIS_CACHE_NAME" \
        deployNewInfrastructure="$DEPLOY_NEW_INFRA" \
        postgresAdminPassword="$POSTGRES_PASSWORD" \
      --query "properties.outputs.appUrl.value" \
      -o tsv
}

# ... (health_check remains the same) ...
function health_check() {
  local app_url=$1
  local health_endpoint="https://${app_url}/"
  write_info "Performing health check on $health_endpoint..."
  for i in {1..20}; do
    # Use --fail to make curl return an error code on HTTP failure
    if curl --fail -s -o /dev/null "$health_endpoint"; then
      write_success "Health check passed!"
      return 0
    fi
    write_info "Attempt $i/20 failed, retrying in 10s..."
    sleep 10
  done
  write_error "Health check failed for $app_url."
  return 1
}


# --- Main Execution ---
function main() {
  write_success "Starting ${ENVIRONMENT_NAME} deployment..."
  write_info "Deployment ID: ${REVISION_SUFFIX}"

  validate_prerequisites

  # -- ADD THIS SECTION --
  # Ensure all required secrets exist in Key Vault before deployment
  ensure_key_vault_secret "$POSTGRES_PASSWORD_SECRET_NAME" "openssl rand -hex 16"
  ensure_key_vault_secret "$API_KEY_SECRET_NAME" "openssl rand -hex 64"
  ensure_key_vault_secret "$ENCRYPTION_KEY_SECRET_NAME" "openssl rand -hex 16"
  ensure_key_vault_secret "$JWT_SECRET_NAME" "openssl rand -hex 32"

  write_info "Logging in to Azure Container Registry: $ACR_NAME"
  az acr login --name "$ACR_NAME"

  build_and_push_image "$APP_NAME_ACTIVEPIECES" "../Dockerfile" ".."

  write_success "Container image built and pushed."

  # Deploy using Bicep
  local app_fqdn
  app_fqdn=$(deploy_infrastructure)
  if [[ -z "$app_fqdn" ]]; then
    write_error "Failed to get App FQDN from Bicep deployment output."
    exit 1
  fi

  # Final health check
  health_check "$app_fqdn"

  echo "" >&2
  write_success "=== ${ENVIRONMENT_NAME} DEPLOYMENT COMPLETED ==="
  write_success "Application URL: https://$app_fqdn"
  write_success "Image Tag: $IMAGE_TAG"

  # Return the FQDN for the GitHub Actions workflow
  echo "https://$app_fqdn"
}

main
