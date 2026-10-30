. (Join-Path $PSScriptRoot 'AzureCli.ps1')

$stage = Get-ApiNetworkStage
if ([string]::IsNullOrWhiteSpace($env:AZURE_SUBSCRIPTION_ID)) {
    throw 'AZURE_SUBSCRIPTION_ID is required.'
}
if ($stage -ne 'direct') {
    if ([string]::IsNullOrWhiteSpace($env:APIM_PUBLISHER_NAME) -or
        [string]::IsNullOrWhiteSpace($env:APIM_PUBLISHER_EMAIL)) {
        throw 'Set APIM_PUBLISHER_NAME and APIM_PUBLISHER_EMAIL before preparing the gateway.'
    }
}
if ($stage -in @('gateway', 'private')) {
    $applicationId = [guid]::Empty
    if (-not [guid]::TryParse($env:BACKEND_APPLICATION_ID, [ref]$applicationId) -or
        $applicationId -eq [guid]::Empty) {
        throw 'BACKEND_APPLICATION_ID must identify the approved single-tenant backend application.'
    }
    if ($env:API_GATEWAY_CUTOVER_APPROVED -ne 'true') {
        throw 'Approve this environment cutover before setting API_GATEWAY_CUTOVER_APPROVED=true. Production also requires completed isolated identity tests.'
    }
}
if ($stage -eq 'private' -and $env:PRIVATE_DEPLOYMENT_APPROVED -ne 'true') {
    throw 'Approve use of the VNet-connected deployment environment before setting PRIVATE_DEPLOYMENT_APPROVED=true.'
}

$resourceGroup = $env:AZURE_RESOURCE_GROUP
if ([string]::IsNullOrWhiteSpace($resourceGroup)) {
    if ([string]::IsNullOrWhiteSpace($env:AZURE_ENV_NAME)) { throw 'AZURE_ENV_NAME is required.' }
    $resourceGroup = "rg-$env:AZURE_ENV_NAME"
}
$exists = Invoke-AzureCli -Arguments @('group', 'exists', '--name', $resourceGroup,
    '--subscription', $env:AZURE_SUBSCRIPTION_ID, '--output', 'tsv')
if ($exists -eq 'false') {
    Write-Host "New environment: migration stage $stage."
    return
}
$resources = @(Invoke-AzureCli -Arguments @('resource', 'list', '--resource-group', $resourceGroup,
    '--subscription', $env:AZURE_SUBSCRIPTION_ID, '--output', 'json') | ConvertFrom-Json)
foreach ($resourceType in @('Microsoft.Web/sites', 'Microsoft.Web/staticSites')) {
    $candidates = @($resources | Where-Object { $_.type -eq $resourceType })
    $configuredName = if ($resourceType -eq 'Microsoft.Web/sites') { $env:AZURE_FUNCTION_APP_NAME } else { $env:AZURE_STATICWEBAPP_NAME }
    if ($candidates.Count -gt 0 -and
        ($candidates.Count -ne 1 -or $candidates[0].name -ne $configuredName)) {
        throw "Refresh and verify azd outputs for existing $resourceType before provisioning. Refusing an ambiguous target."
    }
}
$gateways = @($resources | Where-Object { $_.type -eq 'Microsoft.ApiManagement/service' -and $_.name -like 'apim-summit-*' })
if ($stage -eq 'direct' -and $gateways.Count -gt 0) {
    throw 'A migration gateway already exists. Refusing direct mode, which could remove its integration subnet. Restore API_NETWORK_STAGE.'
}
if ($stage -ne 'direct') {
    $vnets = @($resources | Where-Object { $_.type -eq 'Microsoft.Network/virtualNetworks' -and $_.name -like 'azvnet*' })
    if ($vnets.Count -gt 1) { throw 'Multiple candidate VNets; review the target before provisioning.' }
    if ($vnets.Count -eq 1) {
        $vnet = Invoke-AzureRest -ResourceId $vnets[0].id -ApiVersion '2023-11-01'
        foreach ($subnet in $vnet.properties.subnets) {
            if ($subnet.name -notin @('functionapp', 'private-endpoints', 'apim-integration')) {
                throw "Unmodeled subnet $($subnet.name). Incorporate it before modifying the VNet."
            }
            if ($subnet.name -eq 'apim-integration') { continue }
            $properties = $subnet.properties
            $nsg = if ($properties.PSObject.Properties['networkSecurityGroup']) { $properties.networkSecurityGroup.id } else { '' }
            $expectedNsg = if ($subnet.name -eq 'functionapp') { $env:FUNCTION_SUBNET_NSG_ID } else { $env:PRIVATE_ENDPOINT_SUBNET_NSG_ID }
            if ("$nsg" -ne "$expectedNsg") {
                throw "Preserve the NSG on $($subnet.name): set FUNCTION_SUBNET_NSG_ID / PRIVATE_ENDPOINT_SUBNET_NSG_ID to the current IDs."
            }
            $expectedPrefix = if ($subnet.name -eq 'functionapp') { '10.0.1.0/24' } else { '10.0.2.0/24' }
            if (-not $properties.PSObject.Properties['addressPrefix'] -or $properties.addressPrefix -ne $expectedPrefix) {
                throw "Unexpected address space on subnet $($subnet.name). Incorporate it before provisioning."
            }
            $delegations = @(if ($properties.PSObject.Properties['delegations']) {
                $properties.delegations | ForEach-Object { $_.properties.serviceName }
            })
            if (($subnet.name -eq 'functionapp' -and ($delegations.Count -ne 1 -or $delegations[0] -ne 'Microsoft.App/environments')) -or
                ($subnet.name -eq 'private-endpoints' -and $delegations.Count -ne 0)) {
                throw "Unexpected delegation on subnet $($subnet.name). Preserve it before provisioning."
            }
            if ($properties.PSObject.Properties['privateEndpointNetworkPolicies'] -and $properties.privateEndpointNetworkPolicies -ne 'Disabled') {
                throw "Unexpected endpoint network policy on subnet $($subnet.name). Review before provisioning."
            }
            foreach ($property in @('routeTable', 'serviceEndpoints', 'serviceEndpointPolicies', 'natGateway')) {
                if ($properties.PSObject.Properties[$property] -and $properties.$property) {
                    throw "Unmodeled $property on subnet $($subnet.name). Preserve it in IaC before provisioning."
                }
            }
        }
    }
}
$sites = @($resources | Where-Object { $_.type -eq 'Microsoft.Web/sites' -and $_.name -eq $env:AZURE_FUNCTION_APP_NAME })
if ($sites.Count -eq 1) {
    $site = Invoke-AzureRest -ResourceId $sites[0].id -ApiVersion '2024-04-01'
    if ($site.properties.publicNetworkAccess -eq 'Disabled' -and $stage -ne 'private') {
        throw 'Function public access is already Disabled. Refusing to reopen it through provisioning.'
    }
}
if (-not [string]::IsNullOrWhiteSpace($env:AZURE_STATICWEBAPP_NAME)) {
    $swaId = "/subscriptions/$env:AZURE_SUBSCRIPTION_ID/resourceGroups/$resourceGroup/providers/Microsoft.Web/staticSites/$env:AZURE_STATICWEBAPP_NAME"
    $links = @( (Invoke-AzureRest -ResourceId "$swaId/linkedBackends" -ApiVersion '2024-04-01').value )
    $apimLinks = @($links | Where-Object { $_.properties.backendResourceId -match '/Microsoft.ApiManagement/service/' })
    if ($apimLinks.Count -gt 0 -and $stage -in @('direct', 'prepare')) {
        throw 'SWA already uses APIM. Refusing a stage that would revert backend authorization.'
    }
    $bootstrap = $env:API_BOOTSTRAP_APPROVED -eq 'true' -and
        $env:SITE_BOOTSTRAP_STATUS -eq 'in-progress' -and $stage -eq 'private' -and $links.Count -eq 0
    if ($stage -eq 'private' -and $apimLinks.Count -ne 1 -and -not $bootstrap) {
        throw 'Switch to and validate the gateway stage before disabling Function public access.'
    }
    if ($stage -in @('gateway', 'private') -and $apimLinks.Count -eq 0 -and
        $env:API_ALLOW_BACKEND_SWITCH -ne 'true') {
        throw 'Backend cutover requires API_ALLOW_BACKEND_SWITCH=true in the process environment during the approved maintenance window.'
    }
    if ($apimLinks.Count -gt 0 -and [string]::IsNullOrWhiteSpace($env:APIM_LINKED_PRODUCT_ID)) {
        throw 'Restore APIM_LINKED_PRODUCT_ID before provisioning; do not reset a live gateway to unlinked.'
    }
}
Write-Host "API migration prerequisite checks passed for stage $stage. Cost, quota and security approvals remain operator responsibilities."
