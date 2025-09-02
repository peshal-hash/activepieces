// Bicep template for deploying Activepieces with Postgres and Redis
// --- PARAMETERS ---
// These values are passed in from your deploy.activepieces.sh script
param location string = resourceGroup().location
param environmentName string = 'testContainerEnvironment'
param keyVaultName string = 'salesopt-kv-test'
param acrName string = 'salesopttest'
param appImageTag string = 'latest'
param revisionSuffix string = ''
// These parameters are passed from the deployment script
param containerAppName string
param postgresServerName string
param postgresAdminUser string
param redisCacheName string

// --- EXISTING RESOURCES ---
// References to resources that are already deployed and configured
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}
resource environment 'Microsoft.App/managedEnvironments@2023-05-01' existing = {
  name: environmentName
}
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'salesopt-ap-container-identity'
}

// --- IDEMPOTENT SECRET CREATION ---
// These resources create secrets only if they don't already exist in the Key Vault.
resource postgresAdminPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-server-admin-password'
  properties: {
    value: newGuid()
  }
}
resource existingPostgresPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: postgresAdminPasswordSecret.name
}
resource apEncryptionKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AP-ENCRYPTION-KEY'
  properties: {
    value: newGuid()
  }
}
resource apJwtSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AP-JWT-SECRET'
  properties: {
    value: newGuid()
  }
}
resource apApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AP-API-KEY'
  properties: {
    value: newGuid()
  }
}

// --- NEW INFRASTRUCTURE ---
// These resources will be created by the Bicep template.
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: postgresServerName
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    administratorLogin: postgresAdminUser
    administratorLoginPassword: existingPostgresPassword.getSecret().value
    version: '14'
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}
resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: postgresServer
  name: 'activepieces'
}
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisCacheName
  location: location
  sku: { name: 'Basic', family: 'C', capacity: 0 }
  properties: {
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// --- CONNECTION STRINGS ---
// These secrets store the full connection URLs, which the application will use.
var postgresConnectionString = 'postgres://${postgresAdminUser}:${existingPostgresPassword.getSecret().value}@${postgresServer.properties.fullyQualifiedDomainName}:5432/${postgresDatabase.name}'
var redisConnectionString = 'redis://:${redisCache.listKeys().primaryKey}@${redisCache.properties.hostName}:${redisCache.properties.sslPort}'

resource postgresUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'POSTGRES-CONNECTION-STRING'
  properties: {
    value: postgresConnectionString
  }
}
resource redisUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'REDIS-CONNECTION-STRING'
  properties: {
    value: redisConnectionString
  }
}

// --- CONTAINER APP DEPLOYMENT ---
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: [
        {
          external: true
          targetPort: 80
          transport: 'auto'
          isMainEntryPoint: true
        }
        {
          external: true
          targetPort: 5000
          transport: 'auto'
        }
      ]
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: [
        {
          name: 'postgres-connection-string'
          keyVaultUrl: postgresUrlSecret.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'redis-connection-string'
          keyVaultUrl: redisUrlSecret.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'ap-encryption-key'
          keyVaultUrl: apEncryptionKeySecret.properties.secretUri
          identity: managedIdentity.id
        }
        { name: 'ap-jwt-secret', keyVaultUrl: apJwtSecret.properties.secretUri, identity: managedIdentity.id }
        { name: 'ap-api-key', keyVaultUrl: apApiKeySecret.properties.secretUri, identity: managedIdentity.id }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          image: '${acr.properties.loginServer}/${containerAppName}:${appImageTag}'
          name: 'main-app'
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [
            { name: 'AP_ENVIRONMENT', value: 'prod' }
            { name: 'AP_API_KEY', secretRef: 'ap-api-key' }
            { name: 'AP_ENCRYPTION_KEY', secretRef: 'ap-encryption-key' }
            { name: 'AP_JWT_SECRET', secretRef: 'ap-jwt-secret' }
            { name: 'AP_POSTGRES_URL', secretRef: 'postgres-connection-string' }
            { name: 'AP_REDIS_URL', secretRef: 'redis-connection-string' }
            { name: 'AP_FRONTEND_URL', value: 'https://${containerApp.properties.configuration.ingress[0].fqdn}' }
            { name: 'AP_PROXY_URL', value: 'http://${containerApp.properties.configuration.ingress[0].fqdn}:5000' }
            { name: 'AP_BASE', value: 'https://${containerApp.properties.configuration.ingress[0].fqdn}' }
            { name: 'AP_WEBHOOK_TIMEOUT_SECONDS', value: '30' }
            { name: 'AP_TRIGGER_DEFAULT_POLL_INTERVAL', value: '5' }
            { name: 'AP_EXECUTION_MODE', value: 'UNSANDBOXED' }
            { name: 'AP_FLOW_TIMEOUT_SECONDS', value: '600' }
            { name: 'AP_TELEMETRY_ENABLED', value: 'true' }
            { name: 'AP_TEMPLATES_SOURCE_URL', value: '' }
            { name: 'AP_PUBLIC_SIGNUP_PERSONAL', value: 'true' }
            { name: 'AP_SALESOPTAIURL', value: 'http://localhost:3000' }
            { name: 'AP_WEBSITE_NAME', value: 'SalesOptAi' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-scaling'
            http: { metadata: { concurrentRequests: '100' } }
          }
        ]
      }
    }
  }
}

// --- OUTPUTS ---
// This output is used by the deployment script to perform a health check.
output appUrl string = containerApp.properties.configuration.ingress[0].fqdn
