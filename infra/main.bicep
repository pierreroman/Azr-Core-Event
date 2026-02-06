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

// Generate unique token for resource naming
var resourceToken = uniqueString(subscription().id, location, environmentName)

// Resource Group
resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

// Deploy all resources
module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    resourceToken: resourceToken
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

// Storage outputs
output AZURE_STORAGE_ACCOUNT_NAME string = resources.outputs.storageAccountName
