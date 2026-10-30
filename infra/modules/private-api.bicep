param name string
param location string
param tags object = {}
@minLength(1)
param publisherName string
@minLength(1)
param publisherEmail string
param functionName string
param vnetName string
param gatewayIdentityId string
param gatewayIdentityClientId string
param backendApplicationId string
param linkedProductId string
param workspaceId string

var operations = loadJsonContent('../../api/src/shared/http-operations.json')

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: vnetName
}
resource functionApp 'Microsoft.Web/sites@2024-04-01' existing = {
  name: functionName
}

resource privateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.azurewebsites.net'
  location: 'global'
  tags: tags
}
resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDns
  name: 'function-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}
resource endpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-${functionName}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: '${vnet.id}/subnets/private-endpoints'
    }
    privateLinkServiceConnections: [
      {
        name: 'function'
        properties: {
          privateLinkServiceId: functionApp.id
          groupIds: ['sites']
        }
      }
    ]
  }
}
resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: endpoint
  name: 'function-dns'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'websites'
        properties: {
          privateDnsZoneId: privateDns.id
        }
      }
    ]
  }
}

resource gateway 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'StandardV2'
    capacity: 1
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${gatewayIdentityId}': {}
    }
  }
  properties: {
    publisherName: publisherName
    publisherEmail: publisherEmail
    publicNetworkAccess: 'Enabled'
    virtualNetworkType: 'External'
    virtualNetworkConfiguration: {
      subnetResourceId: '${vnet.id}/subnets/apim-integration'
    }
  }
}

resource productName 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = {
  parent: gateway
  name: 'summit-linked-product'
  properties: {
    displayName: 'summit-linked-product'
    secret: false
    value: linkedProductId
  }
}

resource api 'Microsoft.ApiManagement/service/apis@2024-05-01' = {
  parent: gateway
  name: 'summit'
  properties: {
    displayName: 'Summit API'
    path: 'api'
    protocols: ['https']
    serviceUrl: 'https://${functionName}.azurewebsites.net/api'
    subscriptionRequired: true
    apiRevision: '1'
  }
}

resource apiOperations 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = [for operation in operations: {
  parent: api
  name: operation.name
  properties: {
    displayName: operation.name
    method: operation.method
    urlTemplate: operation.route
    templateParameters: [for parameter in operation.parameters: {
      name: parameter
      type: 'string'
      required: true
    }]
    responses: []
  }
}]

resource policy 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = {
  parent: api
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: replace(replace(loadTextContent('../policies/summit-api.xml'), '__BACKEND_AUDIENCE__', 'api://${backendApplicationId}'), '__GATEWAY_CLIENT_ID__', gatewayIdentityClientId)
  }
  dependsOn: [productName]
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: gateway
  name: 'gateway-logs'
  properties: {
    workspaceId: workspaceId
    logs: [
      {
        category: 'GatewayLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output apimName string = gateway.name
output id string = gateway.id
