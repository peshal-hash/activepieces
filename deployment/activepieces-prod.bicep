// Azure Container Apps deployment using Bicep for Production Environment
param location string = resourceGroup().location
param environmentName string = 'salesoptai-prod-environment'
param keyVaultName string = 'salesoptai-prod-keyvault'
param acrName string = 'salesoptaiprod'
param appImageTag string = 'latest'
param paymentImageTag string = 'latest'
param customDomainEnabled bool = false  // New parameter to control custom domain
param certificateId string = ''  // Optional certificate ID parameter
param revisionSuffix string = '' // Add this line

// Reference existing ACR
resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' existing = {
  name: acrName
}

// Reference existing Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' existing = {
  name: keyVaultName
}

// Log Analytics Workspace for production monitoring
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'salesoptai-prod-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90  // 90 days retention for production
  }
}

// Create Container Apps Environment for production
resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// User-assigned managed identity for Key Vault access
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'salesoptai-prod-identity'
  location: location
}

// Role assignment for Key Vault Secrets User
resource keyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Role assignment for ACR Pull
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, managedIdentity.id, 'ACR Pull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Payment Service (Internal) - Production Configuration
resource paymentService 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'salesoptai-payment-prod'
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
      activeRevisionsMode: 'Multiple'  // Multiple for zero-downtime deployments
      ingress: {
        external: false
        targetPort: 8001
        transport: 'http'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: [
        {
          name: 'helcim-api-token'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/HELCIM-API-TOKEN'
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          image: '${acr.properties.loginServer}/salesoptai-payment-prod:${paymentImageTag}'
	  name: 'payment-service'
          resources: {
            cpu: json('1.0')  // Higher resources for production
            memory: '2.0Gi'
          }
          env: [
            {
              name: 'ENVIRONMENT'
              value: 'production'
            }
            {
              name: 'DEBUG'
              value: 'false'
            }
            {
              name: 'HELCIM_API_URL'
              value: 'https://api.helcim.com/v2'
            }
            {
              name: 'HELCIM_MONTHLY_PLAN_ID'
              value: '14570'  // TODO: Verify production plan IDs
            }
            {
              name: 'HELCIM_ANNUAL_PLAN_ID'
              value: '14570'  // TODO: Verify production plan IDs
            }
            {
              name: 'HELCIM_API_TOKEN'
              secretRef: 'helcim-api-token'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/'
                port: 8001
              }
              initialDelaySeconds: 30
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/'
                port: 8001
              }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 2  // Minimum 2 for HA
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    keyVaultSecretsUserRole
    acrPullRole
  ]
}

// Main Application (External) - Production Configuration
resource mainApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'salesoptai-app-prod'
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
      activeRevisionsMode: 'Multiple'  // Multiple for zero-downtime deployments
      ingress: {
        external: true
        targetPort: 8000
        transport: 'http'
        corsPolicy: {
          allowedOrigins: [
            'https://salesoptai.com'
            'https://www.salesoptai.com'
            'https://app.salesoptai.com'
            // Remove localhost for production
          ]
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
          allowedHeaders: ['*']
          allowCredentials: true
        }
        // Only include custom domains if enabled and certificate ID is provided
        customDomains: customDomainEnabled && !empty(certificateId) ? [
          {
            name: 'api.salesoptai.com'
            certificateId: certificateId
          }
        ] : []
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/DATABASE-URL'
          identity: managedIdentity.id
        }
        {
          name: 'openai-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/OPENAI-API-KEY'
          identity: managedIdentity.id
        }
        {
          name: 'vapi-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/VAPI-API-KEY'
          identity: managedIdentity.id
        }
        {
          name: 'trieve-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TRIEVE-API-KEY'
          identity: managedIdentity.id
        }
        {
          name: 'smtp-username'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/SMTP-USERNAME'
          identity: managedIdentity.id
        }
        {
          name: 'smtp-password'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/SMTP-PASSWORD'
          identity: managedIdentity.id
        }
        {
          name: 'helcim-api-token'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/HELCIM-API-TOKEN'
          identity: managedIdentity.id
        }
        {
          name: 'helcim-monthly-plan-id'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/HELCIM-MONTHLY-PLAN-ID'
          identity: managedIdentity.id
        }
        {
          name: 'helcim-annual-plan-id'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/HELCIM-ANNUAL-PLAN-ID'
          identity: managedIdentity.id
        }
        {
          name: 'twilio-account-sid'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TWILIO-ACCOUNT-SID'
          identity: managedIdentity.id
        }
        {
          name: 'twilio-auth-token'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TWILIO-AUTH-TOKEN'
          identity: managedIdentity.id
        }
        {
          name: 'twilio-from-number'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TWILIO-FROM-NUMBER'
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          image: '${acr.properties.loginServer}/salesoptai-app-prod:${appImageTag}'
	  name: 'main-app'
          resources: {
            cpu: json('2.0')  // Higher resources for production
            memory: '4.0Gi'
          }
          env: [
            {
              name: 'ENVIRONMENT'
              value: 'production'
            }
            {
              name: 'DEBUG'
              value: 'false'
            }
            {
              name: 'PYTHONUNBUFFERED'
              value: '1'
            }
            {
              name: 'LOG_LEVEL'
              value: 'INFO'
            }
            {
              name: 'LOG_FORMATTER'
              value: 'simple'
            }
            {
              name: 'PAYMENT_SERVICE_URL'
              value: 'http://salesoptai-payment-prod'
            }
            {
              name: 'TRIEVE_ORGANIZATION_ID'
              value: 'ddfcd624-7363-4c41-9bbb-cca81d3e9564'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-api-key'
            }
            {
              name: 'TRIEVE_API_KEY'
              secretRef: 'trieve-api-key'
            }
            {
              name: 'VAPI_API_KEY'
              secretRef: 'vapi-api-key'
            }
            {
              name: 'SMTP_USERNAME'
              secretRef: 'smtp-username'
            }
            {
              name: 'SMTP_PASSWORD'
              secretRef: 'smtp-password'
            }
            {
              name: 'HELCIM_API_TOKEN'
              secretRef: 'helcim-api-token'
            }
            {
              name: 'HELCIM_MONTHLY_PLAN_ID'
              secretRef: 'helcim-monthly-plan-id'
            }
            {
              name: 'HELCIM_ANNUAL_PLAN_ID'
              secretRef: 'helcim-annual-plan-id'
            }
            {
              name: 'TWILIO_ACCOUNT_SID'
              secretRef: 'twilio-account-sid'
            }
            {
              name: 'TWILIO_AUTH_TOKEN'
              secretRef: 'twilio-auth-token'
            }
            {
              name: 'TWILIO_FROM_NUMBER'
              secretRef: 'twilio-from-number'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/'
                port: 8000
              }
              initialDelaySeconds: 30
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/'
                port: 8000
              }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 3  // Minimum 3 for HA
        maxReplicas: 20
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
          {
            name: 'cpu-scaling'
            custom: {
              type: 'cpu'
              metadata: {
                type: 'Utilization'
                value: '70'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    keyVaultSecretsUserRole
    acrPullRole
    paymentService
  ]
}

// Application Insights for monitoring
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'salesoptai-prod-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

// Outputs
output appUrl string = mainApp.properties.configuration.ingress.fqdn
output paymentServiceUrl string = paymentService.properties.configuration.ingress.fqdn
output acrLoginServer string = acr.properties.loginServer
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
output appInsightsConnectionString string = appInsights.properties.ConnectionString
