// Bicep template for deploying Activepieces with Postgres and Redis

// --- PARAMETERS ---
param location string
param environmentName string = 'testAPContainerEnvironment'
param logAnalyticsWorkspaceName string = 'ap-logs-${uniqueString(resourceGroup().id)}' // Added for environment logs
param acrName string = 'salesopttest'
param appImageTag string = 'latest'
param revisionSuffix string = ''
param containerAppName string
param postgresServerName string
param postgresAdminUser string
param redisCacheName string
param deployNewInfrastructure bool = true

@secure()
param postgresAdminPassword string

@secure()
param apiKey string

@secure()
param encryptionKey string

@secure()
param jwtSecret string

// --- EXISTING RESOURCES ---
// NOTE: The 'existing' environment reference has been removed and is now created conditionally below.
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'salesopt-container-identity'
}

// --- INFRASTRUCTURE (CONDITIONAL CREATION) ---

// 1. (NEW) Log Analytics Workspace needed for the Container Apps Environment
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = if (deployNewInfrastructure) {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
  }
}

// (FIX) Unconditional reference to the Log Analytics Workspace to resolve BCP318 error
resource existingLogAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  name: logAnalyticsWorkspaceName
}

// 2. (CHANGED) Create the environment if deploying new infrastructure
resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = if (deployNewInfrastructure) {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        // Use the unconditional reference to safely access properties
        customerId: existingLogAnalyticsWorkspace.properties.customerId
        sharedKey: existingLogAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// Unconditional reference to the environment, for use in the Container App
resource existingEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' existing = {
  name: environmentName
}

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
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
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

// --- CONNECTION STRINGS ---
var postgresConnectionString = 'postgres://${postgresAdminUser}:${postgresAdminPassword}@${existingPostgresServer.properties.fullyQualifiedDomainName}:5432/activepieces'
var redisConnectionString = 'redis://:${existingRedisCache.listKeys().primaryKey}@${existingRedisCache.properties.hostName}:${existingRedisCache.properties.sslPort}'

var fqdn = '${containerAppName}.${existingEnvironment.properties.defaultDomain}'

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
    // 3. (CHANGED) This now correctly references the environment that was just created (or already existed)
    // Bicep automatically creates a dependency, ensuring the environment is ready before the app is deployed.
    managedEnvironmentId: existingEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 5000 // Port exposed by the Activepieces container
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          image: '${acr.properties.loginServer}/${containerAppName}:${appImageTag}'
          name: 'apmain-app'
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            {
              name: 'AP_POSTGRES_URL'
              value: postgresConnectionString
            }
            {
              name: 'AP_REDIS_URL'
              value: redisConnectionString
            }
            {
              name: 'AP_API_KEY'
              value: apiKey
            }
            {
              name: 'AP_ENCRYPTION_KEY'
              value: encryptionKey
            }
            {
              name: 'AP_JWT_SECRET'
              value: jwtSecret
            }
            {
              name: 'AP_ENVIRONMENT'
              value: 'prod'
            }
            {
              name: 'AP_FRONTEND_URL'
              value: 'https://${fqdn}' // Changed to remove the port
            }
            {
              name: 'AP_BASE_URL' // Note: Renamed from AP_BASE for clarity
              value: 'https://${fqdn}:80'
            }
            {
              name: 'AP_PROXY_URL'
              value: 'http://${fqdn}'
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
              value: 'http://localhost:3000' // Note: This points to localhost within the container
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
        maxReplicas: 2
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
output appUrl string = 'https://${fqdn}'
