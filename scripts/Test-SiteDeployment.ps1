param([Parameter(Mandatory)][string]$EnvironmentName)
. (Join-Path $PSScriptRoot 'AzureCli.ps1')
Import-AzdEnvironment -EnvironmentName $EnvironmentName | Out-Null
$site = Invoke-AzureRest -ResourceId $env:AZURE_FUNCTION_APP_ID -ApiVersion '2024-04-01'
$storageId = "/subscriptions/$env:AZURE_SUBSCRIPTION_ID/resourceGroups/$env:AZURE_RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$env:AZURE_STORAGE_ACCOUNT_NAME"
$storage = Invoke-AzureRest -ResourceId $storageId -ApiVersion '2023-01-01'
if ($site.properties.publicNetworkAccess -ne 'Disabled' -or $storage.properties.publicNetworkAccess -ne 'Disabled') {
    throw 'Function and Storage must both have public network access Disabled.'
}
$links = @((Invoke-AzureRest -ResourceId "/subscriptions/$env:AZURE_SUBSCRIPTION_ID/resourceGroups/$env:AZURE_RESOURCE_GROUP/providers/Microsoft.Web/staticSites/$env:AZURE_STATICWEBAPP_NAME/linkedBackends" -ApiVersion '2024-04-01').value)
if ($links.Count -ne 1 -or $links[0].properties.backendResourceId -ne $env:AZURE_APIM_ID) {
    throw 'SWA is not linked to the expected API Management gateway.'
}
$checks = @(
    @{ Path = '/schedule'; Property = 'schedule'; Array = $true }
    @{ Path = '/speakers'; Property = 'speakers'; Array = $true }
    @{ Path = '/sponsors'; Property = 'sponsors'; Array = $true }
    @{ Path = '/branding'; Property = 'eventName'; Array = $false }
    @{ Path = '/registration'; Property = 'enabled'; Array = $false }
    @{ Path = '/content/about'; Property = 'content'; Array = $false }
    @{ Path = '/content/code-of-conduct'; Property = 'content'; Array = $false }
)
foreach ($check in $checks) {
    $url = "https://$env:AZURE_STATICWEBAPP_HOSTNAME/api$($check.Path)"
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        $response = Invoke-WebRequest $url -SkipHttpErrorCheck -TimeoutSec 60
        if ([int]$response.StatusCode -eq 200) { break }
        Write-Warning "Waiting for API readiness: $url returned $($response.StatusCode) (attempt $attempt/12)."
        if ($attempt -lt 12) { Start-Sleep -Seconds 10 }
    }
    if ([int]$response.StatusCode -ne 200 -or "$($response.Headers['Content-Type'])" -notlike '*application/json*') {
        throw "API acceptance failed: $url returned $($response.StatusCode), expected JSON."
    }
    $body = $response.Content | ConvertFrom-Json
    if (-not $body.PSObject.Properties[$check.Property] -or
        ($check.Array -and $body.($check.Property) -isnot [array])) {
        throw "API response shape mismatch: $url"
    }
    Write-Host "PASS: $url (empty event collections allowed)."
}
Write-Host 'Live anonymous API/network checks passed. Browser sign-in, admin access and favorites still require operator acceptance.'
