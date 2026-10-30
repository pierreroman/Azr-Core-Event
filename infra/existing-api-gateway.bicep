targetScope = 'resourceGroup'

param location string = resourceGroup().location
param environmentName string
param resourceToken string
param backendApplicationId string
param publisherName string
param publisherEmail string
param linkedProductId string = 'unlinked'

var tags = {
  environment: environmentName
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: 'azvnet${resourceToken}'
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-apim-${resourceToken}'
  location: location
  tags: tags
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: 'nsg-apim-${resourceToken}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowKeyVault'
        properties: {
          priority: 100
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: 'VirtualNetwork'
          destinationAddressPrefix: 'AzureKeyVault'
        }
      }
    ]
  }
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: vnet
  name: 'apim-integration'
  properties: {
    addressPrefix: '10.0.3.0/24'
    networkSecurityGroup: {
      id: nsg.id
    }
    delegations: [
      {
        name: 'apim'
        properties: {
          serviceName: 'Microsoft.Web/serverFarms'
        }
      }
    ]
  }
}

module gateway 'modules/private-api.bicep' = {
  name: 'private-api'
  params: {
    name: 'apim-summit-${resourceToken}'
    location: location
    tags: tags
    publisherName: publisherName
    publisherEmail: publisherEmail
    functionName: 'azfn${resourceToken}'
    vnetName: vnet.name
    gatewayIdentityId: identity.id
    gatewayIdentityClientId: identity.properties.clientId
    backendApplicationId: backendApplicationId
    linkedProductId: linkedProductId
    workspaceId: resourceId('Microsoft.OperationalInsights/workspaces', 'azlog${resourceToken}')
  }
  dependsOn: [subnet]
}

output gatewayId string = gateway.outputs.id
output gatewayPrincipalId string = identity.properties.principalId
output gatewayClientId string = identity.properties.clientId
