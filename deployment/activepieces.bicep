// Bicep template for deploying Activepieces with Postgres and Redis
// --- PARAMETERS ---
param location string = resourceGroup().location
param environmentName string = 'testContainerEnvironment'
param keyVaultName string = 'salesopt-kv-test'
param acrName string = 'salesopttest'
param appImageTag string = 'latest'
param revisionSuffix string = ''
param containerAppName string
param postgresServerName string
param postgresAdminUser string
param redisCacheName string
param deployNewInfrastructure bool = true

// This password is now passed securely from the deployment script
param postgresAdminPassword string {
@secure()
}

// --- EXISTING RESOURCES ---
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

// --- SECRETS (REFERENCED ONLY) ---
// The deployment script now ensures these secrets exist. Bicep only needs to reference them.
resource existingPostgresUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: 'POSTGRES-CONNECTION-STRING'
}
resource existingRedisUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: 'REDIS-CONNECTION-STRING'
}
resource existingApEncryptionKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: 'AP-ENCRYPTION-KEY'
}
resource existingApJwtSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: 'AP-JWT-SECRET'
}
resource existingApApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: 'AP-API-KEY'
}

// --- INFRASTRUCTURE (CONDITIONAL CREATION) ---
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = if (deployNewInfrastructure) {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    version: '14'
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
  }
}
resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = if (deployNewInfrastructure) {
  parent: postgresServer
  name: 'activepieces'
}
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = if (deployNewInfrastructure) {
  name: redisCacheName
  location: location
  sku: {
    name: 'Basic'
    family: 'C'
    capacity: 0
  }
  properties: {
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// Unconditional reference for connection string construction
resource existingPostgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' existing = {
  name: postgresServerName
}
resource existingRedisCache 'Microsoft.Cache/redis@2023-08-01' existing = {
  name: redisCacheName
}

// --- CONNECTION STRINGS (Created if infrastructure is new) ---
var postgresConnectionString = 'postgres://${postgresAdminUser}:${postgresAdminPassword}@${existingPostgresServer.properties.fullyQualifiedDomainName}:5432/activepieces'
var redisConnectionString = 'redis://:${existingRedisCache.listKeys().primaryKey}@${existingRedisCache.properties.hostName}:${existingRedisCache.properties.sslPort}'

resource postgresUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (deployNewInfrastructure) {
  parent: keyVault
  name: 'POSTGRES-CONNECTION-STRING'
  properties: {
    value: postgresConnectionString
  }
}
resource redisUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (deployNewInfrastructure) {
  parent: keyVault
  name: 'REDIS-CONNECTION-STRING'
  properties: {
    value: redisConnectionString
  }
}

var fqdn = '${containerAppName}.${environment.properties.defaultDomain}'

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
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: [
        {
          name: 'postgres-connection-string'
          keyVaultUrl: existingPostgresUrlSecret.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'redis-connection-string'
          keyVaultUrl: existingRedisUrlSecret.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'ap-encryption-key'
          keyVaultUrl: existingApEncryptionKeySecret.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'ap-jwt-secret'
          keyVaultUrl: existingApJwtSecret.properties.secretUri
          identity: managedIdentity.id
        }
        {
          name: 'ap-api-key'
          keyVaultUrl: existingApApiKeySecret.properties.secretUri
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          image: '${acr.properties.loginServer}/${containerAppName}:${appImageTag}'
          name: 'main-app'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'AP_ENVIRONMENT'
              value: 'prod'
            }
            {
              name: 'AP_API_KEY'
              secretRef: 'ap-api-key'
            }
            {
              name: 'AP_ENCRYPTION_KEY'
              secretRef: 'ap-encryption-key'
            }
            {
              name: 'AP_JWT_SECRET'
              secretRef: 'ap-jwt-secret'
            }
            {
              name: 'AP_POSTGRES_URL'
              secretRef: 'postgres-connection-string'
            }
            {
              name: 'AP_REDIS_URL'
              secretRef: 'redis-connection-string'
            }
            {
              name: 'AP_FRONTEND_URL'
              value: 'https://${fqdn}'
            }
            {
              name: 'AP_BASE'
              value: 'https://${fqdn}'
            }
            {
              name: 'AP_PROXY_URL'
              value: 'http://${fqdn}:5000'
            }
            {
              name: 'AP_WEBHOOK_TIMEOUT_SECONDS'
              value: '30'
            }
            {
              name: 'AP_TRIGGER_DEFAULT_POLL_INTERVAL'
              value: '5'
            }
            {
              name: 'AP_EXECUTION_MODE'
              value: 'UNSANDBOXED'
            }
            {
              name: 'AP_FLOW_TIMEOUT_SECONDS'
              value: '600'
            }
            {
              name: 'AP_TELEMETRY_ENABLED'
              value: 'true'
            }
            {
              name: 'AP_TEMPLATES_SOURCE_URL'
              value: ''
            }
            {
              name: 'AP_PUBLIC_SIGNUP_PERSONAL'
              value: 'true'
            }
            {
              name: 'AP_SALESOPTAIURL'
              value: 'http://localhost:3000'
            }
            {
              name: 'AP_WEBSITE_NAME'
              value: 'SalesOptAi'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

// --- OUTPUTS ---
output appUrl string = fqdn
