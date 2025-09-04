// Bicep template for deploying Activepieces with Postgres and Redis

// --- PARAMETERS ---
param location string
param salesoptapis string
param environmentName string = 'testAPContainerEnvironment'
param logAnalyticsWorkspaceName string = 'ap-logs-${uniqueString(resourceGroup().id)}'
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
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'salesopt-container-identity'
}

// --- INFRASTRUCTURE (CONDITIONAL CREATION) ---
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = if (deployNewInfrastructure) {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource existingLogAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = if (deployNewInfrastructure) {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: existingLogAnalyticsWorkspace.properties.customerId
        sharedKey: existingLogAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

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

// --- THE CHANGE IS HERE ---
// This resource adds a firewall rule to the PostgreSQL server.
// The IP range 0.0.0.0 to 0.0.0.0 is a special rule that allows
// all Azure services to connect to the database.
resource postgresFirewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-03-01-preview' = if (deployNewInfrastructure) {
  parent: postgresServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
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
var postgresHost = existingPostgresServer.properties.fullyQualifiedDomainName
var redisHost = existingRedisCache.properties.hostName
var redisPort = '${existingRedisCache.properties.sslPort}'

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
    managedEnvironmentId: existingEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 5000
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: [
            'https://portal.salesoptai.com'
            'http://localhost:3000'
            'https://gentle-grass-02d3f240f.1.azurestaticapps.net'
          ]
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
          allowedHeaders: ['*']
          allowCredentials: true
        }
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
          name: 'ap-main-app'
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            {
              name: 'AP_POSTGRES_DATABASE'
              value: 'activepieces'
            }
            {
              name: 'AP_POSTGRES_HOST'
              value: postgresHost
            }
            {
              name: 'AP_POSTGRES_PORT'
              value: '5432'
            }
            {
              name: 'AP_POSTGRES_USERNAME'
              value: postgresAdminUser
            }
            {
              name: 'AP_POSTGRES_PASSWORD'
              value: postgresAdminPassword
            }
            {
              name: 'AP_POSTGRES_USE_SSL'
              value: 'true'
            }
            {
              name: 'AP_REDIS_USE_SSL'
              value: 'true'
            }

            {
              name: 'AP_REDIS_HOST'
              value: redisHost
            }
            {
              name: 'AP_REDIS_PORT'
              value: redisPort
            }

            {
              name: 'AP_REDIS_PASSWORD'
              value: existingRedisCache.listKeys().primaryKey
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
              value: 'https://${fqdn}'
            }
            {
              name: 'AP_BASE_URL'
              value: 'http://localhost:80'
            }
            {
              name: 'AP_PROXY_URL'
              value: 'https://${fqdn}'
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
              name: 'AP_SALESOPTAI_URLS'
              value: salesoptapis
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
output appUrl string = fqdn
