. (Join-Path $PSScriptRoot 'AzureCli.ps1')

if ((Get-ApiNetworkStage) -ne 'private') { throw 'This check is for the private stage only.' }
if ($env:PRIVATE_DEPLOYMENT_APPROVED -ne 'true') {
    throw 'The private deployment environment has not been approved.'
}
$site = Invoke-AzureRest -ResourceId $env:AZURE_FUNCTION_APP_ID -ApiVersion '2024-04-01'
if ($site.properties.publicNetworkAccess -ne 'Disabled') {
    throw 'Function public network access must remain Disabled during private deployments.'
}
$approved = @($site.properties.privateEndpointConnections |
    Where-Object { $_.properties.privateLinkServiceConnectionState.status -eq 'Approved' })
if ($approved.Count -eq 0) { throw 'No approved Function private endpoint.' }
$addresses = @()
foreach ($connection in $approved) {
    $endpoint = Invoke-AzureRest -ResourceId $connection.properties.privateEndpoint.id -ApiVersion '2023-11-01'
    foreach ($nic in $endpoint.properties.networkInterfaces) {
        $networkInterface = Invoke-AzureRest -ResourceId $nic.id -ApiVersion '2023-11-01'
        $addresses += @($networkInterface.properties.ipConfigurations | ForEach-Object { $_.properties.privateIPAddress })
    }
}
$hostname = $site.properties.defaultHostName
$resolved = @([System.Net.Dns]::GetHostAddresses($hostname) | ForEach-Object { $_.IPAddressToString })
if ($resolved.Count -eq 0 -or @($resolved | Where-Object { $_ -notin $addresses }).Count -gt 0) {
    throw "Function DNS does not resolve exclusively to its approved private endpoint: $hostname"
}
$response = Invoke-WebRequest "https://$hostname/api/schedule" -SkipHttpErrorCheck -MaximumRedirection 0
if ([int]$response.StatusCode -notin @(401, 403)) {
    throw "Unexpected anonymous private backend status: $($response.StatusCode)"
}
$storage = Invoke-AzureRest -ResourceId "/subscriptions/$env:AZURE_SUBSCRIPTION_ID/resourceGroups/$env:AZURE_RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$env:AZURE_STORAGE_ACCOUNT_NAME" -ApiVersion '2023-01-01'
if ($storage.properties.publicNetworkAccess -ne 'Disabled') {
    throw 'Storage must remain private for this deployment path.'
}
Write-Host "Function DNS resolves to its approved private endpoint and HTTPS responds. No public-access setting was changed."
Write-Host 'Flex end-to-end deployment acceptance must also cover package storage, build, and any SCM endpoints used by the selected tooling.'
