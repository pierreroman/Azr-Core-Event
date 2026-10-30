targetScope = 'resourceGroup'

param location string = resourceGroup().location
@minLength(1)
@maxLength(40)
param agentName string
param ownerToken string
param subnetId string
param functionAppName string
param storageAccountName string
param vmSize string = 'Standard_D2s_v5'
param adminUsername string = 'deployagent'
@secure()
param sshPublicKey string

var tags = {
  'private-deployment-owner': ownerToken
  'private-deployment-temporary': 'true'
}
var websiteContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
var blobContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var reader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')

resource functionApp 'Microsoft.Web/sites@2024-04-01' existing = {
  name: functionAppName
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}
resource osDisk 'Microsoft.Compute/disks@2024-03-02' existing = {
  name: '${agentName}-os'
}
resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${agentName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}
resource nic 'Microsoft.Network/networkInterfaces@2023-11-01' = {
  name: '${agentName}-nic'
  location: location
  tags: tags
  properties: {
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [
      {
        name: 'private'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: { id: subnetId }
        }
      }
    ]
  }
}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: agentName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: agentName
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        name: '${agentName}-os'
        createOption: 'FromImage'
        deleteOption: 'Detach'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [
        { id: nic.id }
      ]
    }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
  }
}
resource functionRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, vm.id, websiteContributor)
  scope: functionApp
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: websiteContributor
  }
}
resource storageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, vm.id, blobContributor)
  scope: storage
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributor
  }
}
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, vm.id, reader)
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: reader
  }
}
output vmId string = vm.id
output nicId string = nic.id
output diskId string = osDisk.id
output diskUniqueId string = osDisk.properties.uniqueId
output nsgId string = nsg.id
output principalId string = vm.identity.principalId
output ownerToken string = ownerToken
output subnetId string = subnetId
output functionId string = functionApp.id
output storageId string = storage.id
output roleAssignments array = [
  { id: functionRole.id, scope: functionApp.id, roleDefinitionId: websiteContributor }
  { id: storageRole.id, scope: storage.id, roleDefinitionId: blobContributor }
  { id: readerRole.id, scope: resourceGroup().id, roleDefinitionId: reader }
]
