targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Name of the resource group')
param resourceGroupName string = 'rg-${environmentName}'

@description('Optional resource-group resiliency classification. Leave empty unless approved for this environment.')
param resiliencyClassification string = ''

@allowed(['direct', 'prepare', 'gateway', 'private'])
@description('New deployments use private connectivity. Other stages are explicit legacy migration options.')
param apiNetworkStage string = 'private'

param apimPublisherName string = ''
param apimPublisherEmail string = ''
@description('Single-tenant backend Entra application client ID; required for gateway/private.')
param backendApplicationId string = ''
@description('Generated SWA APIM product ID, persisted after an explicitly approved backend switch.')
param apimLinkedProductId string = 'unlinked'
param functionSubnetNsgId string = ''
param privateEndpointSubnetNsgId string = ''

// Generate unique token for resource naming
var resourceToken = uniqueString(subscription().id, location, environmentName)

// Resource Group
resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: union({
    'azd-env-name': environmentName
  }, empty(resiliencyClassification) ? {} : {
    'ms-resiliency-classification': resiliencyClassification
  })
}

// Deploy all resources
module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    resourceToken: resourceToken
    apiNetworkStage: apiNetworkStage
    apimPublisherName: apimPublisherName
    apimPublisherEmail: apimPublisherEmail
    backendApplicationId: backendApplicationId
    apimLinkedProductId: apimLinkedProductId
    functionSubnetNsgId: functionSubnetNsgId
    privateEndpointSubnetNsgId: privateEndpointSubnetNsgId
  }
}

// Outputs required by azd
output AZURE_RESOURCE_GROUP string = rg.name
output RESOURCE_GROUP_ID string = rg.id
output AZURE_LOCATION string = location

// Static Web App outputs
output AZURE_STATICWEBAPP_NAME string = resources.outputs.staticWebAppName
output AZURE_STATICWEBAPP_HOSTNAME string = resources.outputs.staticWebAppHostname

// Function App outputs
output AZURE_FUNCTION_APP_NAME string = resources.outputs.functionAppName
output AZURE_FUNCTION_APP_ID string = resources.outputs.functionAppId
output AZURE_API_NETWORK_STAGE string = apiNetworkStage
output AZURE_APIM_NAME string = resources.outputs.apimName
output AZURE_APIM_ID string = resources.outputs.apimId
output AZURE_APIM_PRINCIPAL_ID string = resources.outputs.apimPrincipalId

// Storage outputs
output AZURE_STORAGE_ACCOUNT_NAME string = resources.outputs.storageAccountName
output AZURE_STORAGE_ACCOUNT_ID string = resources.outputs.storageAccountId
output AZURE_PRIVATE_ENDPOINT_SUBNET_ID string = resources.outputs.privateEndpointSubnetId
output AZURE_VIRTUAL_NETWORK_NAME string = resources.outputs.vnetName

// Cosmos DB outputs
output AZURE_COSMOS_ACCOUNT_NAME string = resources.outputs.cosmosAccountName
output AZURE_COSMOS_ENDPOINT string = resources.outputs.cosmosEndpoint
