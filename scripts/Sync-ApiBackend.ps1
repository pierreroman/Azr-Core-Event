. (Join-Path $PSScriptRoot 'AzureCli.ps1')

$stage = Get-ApiNetworkStage
foreach ($variable in @('AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_STATICWEBAPP_NAME', 'AZURE_LOCATION')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($variable))) {
        throw "$variable is required."
    }
}
$useGateway = $stage -in @('gateway', 'private')
$expected = if ($useGateway) { $env:AZURE_APIM_ID } else { $env:AZURE_FUNCTION_APP_ID }
if ([string]::IsNullOrWhiteSpace($expected)) { throw 'Expected backend resource ID is missing.' }
$swaId = "/subscriptions/$env:AZURE_SUBSCRIPTION_ID/resourceGroups/$env:AZURE_RESOURCE_GROUP/providers/Microsoft.Web/staticSites/$env:AZURE_STATICWEBAPP_NAME"
$links = @((Invoke-AzureRest -ResourceId "$swaId/linkedBackends" -ApiVersion '2024-04-01').value)
if ($links.Count -gt 1) { throw 'Unexpected multiple linked backends; inspect the environment manually.' }
$current = if ($links.Count -eq 1) { $links[0].properties.backendResourceId } else { '' }
if ($current -ne $expected) {
    if ($current -and $env:API_ALLOW_BACKEND_SWITCH -ne 'true') {
        throw "Backend differs from requested stage $stage. Refusing automatic unlink/relink."
    }
    if ($useGateway -and $env:API_ALLOW_BACKEND_SWITCH -ne 'true') {
        throw 'An APIM backend must be linked during an explicitly approved cutover.'
    }
    if ($current) {
        Invoke-AzureCli -Arguments @('staticwebapp', 'backends', 'unlink', '--name', $env:AZURE_STATICWEBAPP_NAME,
            '--resource-group', $env:AZURE_RESOURCE_GROUP, '--subscription', $env:AZURE_SUBSCRIPTION_ID,
            '--output', 'none') | Out-Null
    }
    Invoke-AzureCli -Arguments @('staticwebapp', 'backends', 'link', '--name', $env:AZURE_STATICWEBAPP_NAME,
        '--resource-group', $env:AZURE_RESOURCE_GROUP, '--subscription', $env:AZURE_SUBSCRIPTION_ID,
        '--backend-resource-id', $expected, '--backend-region', $env:AZURE_LOCATION,
        '--output', 'none') | Out-Null
    Write-Host "Linked backend for stage $stage."
} else {
    Write-Host "Existing backend matches stage $stage; no relink needed."
}
if (-not $useGateway) { return }

$swa = Invoke-AzureRest -ResourceId $swaId -ApiVersion '2024-04-01'
$hostname = $swa.properties.defaultHostname
$generatedProductName = $hostname.Split('.')[0]
$products = @((Invoke-AzureRest -ResourceId "$expected/products").value |
    Where-Object {
        $_.properties.displayName -eq "Azure Static Web Apps - $hostname (Linked)" -or
        ($_.name -eq $generatedProductName -and
            $_.properties.displayName -eq "Generated for Static Web Apps resource  with default hostname: $generatedProductName")
    })
if ($products.Count -ne 1) {
    throw 'Expected one generated SWA product. Gateway remains fail-closed; inspect the linking operation.'
}
$product = $products[0]
if (-not $product.properties.subscriptionRequired) { throw 'Linked SWA product must require a subscription.' }
$productPolicy = Invoke-AzureRest -ResourceId "$($product.id)/policies/policy"
[xml]$policy = $productPolicy.properties.value
if ($null -eq $policy.SelectSingleNode('/policies/inbound/validate-jwt')) {
    throw 'Generated product JWT validation is missing. Do not expose the API.'
}
Invoke-AzureRest -ResourceId "$($product.id)/apis/summit" -Method put -Body @{} | Out-Null
Invoke-AzureRest -ResourceId "$expected/namedValues/summit-linked-product" -Method put -Body @{
    properties = @{ displayName = 'summit-linked-product'; secret = $false; value = $product.name }
} | Out-Null
if ([string]::IsNullOrWhiteSpace($env:AZURE_ENV_NAME)) { throw 'AZURE_ENV_NAME is required to persist the product ID.' }
& azd env set APIM_LINKED_PRODUCT_ID $product.name --environment $env:AZURE_ENV_NAME
if ($LASTEXITCODE -ne 0) { throw 'Failed to persist APIM_LINKED_PRODUCT_ID. Do not reprovision until it is restored.' }
Write-Host "SWA product $($product.name) contains the Summit API; product ID persisted for idempotent redeployments."
