@description('部署环境名称，用于资源命名')
param envName string = 'prod'

@description('部署区域')
param location string = resourceGroup().location

@description('PostgreSQL 管理员密码')
@secure()
param dbPassword string

@description('JWT 密钥')
@secure()
param jwtSecret string

@description('JWT Refresh 密钥')
@secure()
param jwtRefreshSecret string

@description('知识库 Agent API Key')
@secure()
param kbApiKey string

@description('Teams Webhook URL')
param teamsWebhookUrl string = ''

var prefix = 'ticket-${envName}'

// ── App Service Plan ──────────────────────────────────────────────────────────
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${prefix}-plan'
  location: location
  sku: { name: 'B2', tier: 'Basic' }
  kind: 'linux'
  properties: { reserved: true }
}

// ── PostgreSQL Flexible Server ────────────────────────────────────────────────
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: '${prefix}-pg'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    administratorLogin: 'pgadmin'
    administratorLoginPassword: dbPassword
    version: '15'
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'ticket_system'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource postgresFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// ── Storage Account ───────────────────────────────────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: replace('${prefix}storage', '-', '')
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { allowBlobPublicAccess: false, minimumTlsVersion: 'TLS1_2' }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

resource attachmentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'attachments'
  properties: { publicAccess: 'None' }
}

// ── Service Bus ───────────────────────────────────────────────────────────────
resource serviceBusNs 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: '${prefix}-sb'
  location: location
  sku: { name: 'Standard', tier: 'Standard' }
}

resource ticketEventsQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNs
  name: 'ticket-events'
  properties: { maxDeliveryCount: 5, defaultMessageTimeToLive: 'P1D' }
}

// ── Key Vault ─────────────────────────────────────────────────────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${prefix}-kv'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 7
  }
}

// ── Backend App Service ───────────────────────────────────────────────────────
resource backendApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${prefix}-api'
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '3000' }
        { name: 'DATABASE_URL', value: 'postgresql://pgadmin:${dbPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/ticket_system?sslmode=require' }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'JWT_REFRESH_SECRET', value: jwtRefreshSecret }
        { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'AZURE_STORAGE_CONTAINER_NAME', value: 'attachments' }
        { name: 'AZURE_SERVICE_BUS_QUEUE_NAME', value: 'ticket-events' }
        { name: 'KB_AGENT_URL', value: 'https://agnetdoc-cve0guf5h8eggmej.southeastasia-01.azurewebsites.net' }
        { name: 'KB_AGENT_API_KEY', value: kbApiKey }
        { name: 'TEAMS_WEBHOOK_URL', value: teamsWebhookUrl }
        { name: 'EXTERNAL_STATUS_API_URL', value: 'http://20.191.156.160/status/api' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
      ]
    }
    httpsOnly: true
  }
}

// ── Static Web App（前端）────────────────────────────────────────────────────
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${prefix}-frontend'
  location: 'eastasia'
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {}
}

// ── 输出 ──────────────────────────────────────────────────────────────────────
output backendUrl string = 'https://${backendApp.properties.defaultHostName}'
output frontendUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output storageAccountName string = storage.name
output serviceBusNamespace string = serviceBusNs.name
