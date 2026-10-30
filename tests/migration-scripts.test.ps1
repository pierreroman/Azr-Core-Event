$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$scripts = Join-Path $root 'scripts'
$saved = @{}
$variables = @('API_NETWORK_STAGE', 'AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP',
    'AZURE_STATICWEBAPP_NAME', 'AZURE_FUNCTION_APP_NAME', 'AZURE_FUNCTION_APP_ID',
    'AZURE_APIM_ID', 'AZURE_LOCATION', 'APIM_PUBLISHER_NAME', 'APIM_PUBLISHER_EMAIL',
    'BACKEND_APPLICATION_ID', 'API_GATEWAY_CUTOVER_APPROVED', 'PRIVATE_DEPLOYMENT_APPROVED',
    'API_ALLOW_BACKEND_SWITCH', 'APIM_LINKED_PRODUCT_ID', 'AZURE_ENV_NAME',
    'FUNCTION_SUBNET_NSG_ID', 'PRIVATE_ENDPOINT_SUBNET_NSG_ID',
    'API_BOOTSTRAP_APPROVED', 'SITE_BOOTSTRAP_STATUS')
foreach ($name in $variables) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, $null)
}
$global:MigrationScriptTestState = @{
    requests = [System.Collections.Generic.List[string]]::new()
    resources = @()
    links = @()
    networkAccess = 'Enabled'
    subnetProperties = @{
        addressPrefix = '10.0.1.0/24'
        networkSecurityGroup = @{ id = '/test/nsg' }
        delegations = @(@{ properties = @{ serviceName = 'Microsoft.App/environments' } })
    }
    productPolicy = '<policies><inbound><validate-jwt /></inbound></policies>'
    modernProduct = $false
}
function az {
    $global:LASTEXITCODE = 0
    $global:MigrationScriptTestState.requests.Add(($args -join ' '))
    if ($args[0] -eq 'group') { return 'true' }
    if ($args[0] -eq 'resource') { return (ConvertTo-Json -InputObject $global:MigrationScriptTestState.resources -Depth 10) }
    if ($args[0] -eq 'rest') {
        $url = $args[([array]::IndexOf($args, '--url') + 1)]
        if ($args -contains 'put') { return '{}' }
        if ($url -match '/linkedBackends\?') {
            return (ConvertTo-Json -InputObject @{ value = $global:MigrationScriptTestState.links } -Depth 10)
        }
        if ($url -match '/virtualNetworks/') {
            return (ConvertTo-Json -InputObject @{ properties = @{ subnets = @(@{
                name = 'functionapp'; properties = $global:MigrationScriptTestState.subnetProperties
            }) } } -Depth 10)
        }
        if ($url -match '/products\?') {
            return (ConvertTo-Json -InputObject @{ value = @(@{
                id = '/test/products/swa'
                name = if ($global:MigrationScriptTestState.modernProduct) { 'test' } else { 'swa' }
                properties = @{
                    displayName = if ($global:MigrationScriptTestState.modernProduct) {
                        'Generated for Static Web Apps resource  with default hostname: test'
                    } else { 'Azure Static Web Apps - test.azurestaticapps.net (Linked)' }
                    subscriptionRequired = $true
                }
            }) } -Depth 10)
        }
        if ($url -match '/policies/policy\?') {
            return (ConvertTo-Json -InputObject @{ properties = @{ value = $global:MigrationScriptTestState.productPolicy } })
        }
        if ($url -match '/staticSites/') {
            return (ConvertTo-Json -InputObject @{ properties = @{ defaultHostname = 'test.azurestaticapps.net' } })
        }
        return (ConvertTo-Json -InputObject @{ properties = @{ publicNetworkAccess = $global:MigrationScriptTestState.networkAccess } })
    }
    throw "Unexpected Azure write or command during test: $($args -join ' ')"
}
function azd {
    if (($args[0..2] -join ' ') -ne 'env set APIM_LINKED_PRODUCT_ID') { throw 'Unexpected azd command' }
    $global:LASTEXITCODE = 0
    $global:MigrationScriptTestState.requests.Add(($args -join ' '))
}
function Assert-Denied {
    param([string]$Script, [string]$Expected)
    $denied = $false
    try { & (Join-Path $scripts $Script) } catch {
        if ($_.Exception.Message -notlike "*$Expected*") { throw }
        $denied = $true
    }
    if (-not $denied) { throw "Expected denial containing: $Expected" }
    Write-Output "PASS: $Expected"
}
try {
    $env:AZURE_SUBSCRIPTION_ID = 'test-subscription'
    $env:AZURE_RESOURCE_GROUP = 'test-group'
    $env:AZURE_ENV_NAME = 'test'
    $env:AZURE_STATICWEBAPP_NAME = 'test-swa'
    $env:AZURE_FUNCTION_APP_NAME = 'test-function'
    $env:AZURE_FUNCTION_APP_ID = '/subscriptions/test/resourceGroups/test/providers/Microsoft.Web/sites/test-function'
    $env:AZURE_APIM_ID = '/subscriptions/test/resourceGroups/test/providers/Microsoft.ApiManagement/service/test-apim'
    $env:AZURE_LOCATION = 'eastus2'
    $env:API_NETWORK_STAGE = 'typo'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Invalid API_NETWORK_STAGE'
    $env:API_NETWORK_STAGE = 'prepare'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'APIM_PUBLISHER_NAME'
    $env:APIM_PUBLISHER_NAME = 'Test'
    $env:APIM_PUBLISHER_EMAIL = 'test@example.invalid'
    $env:API_NETWORK_STAGE = 'gateway'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'BACKEND_APPLICATION_ID'
    $env:BACKEND_APPLICATION_ID = '11111111-2222-3333-4444-555555555555'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'API_GATEWAY_CUTOVER_APPROVED'
    $env:API_GATEWAY_CUTOVER_APPROVED = 'true'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'API_ALLOW_BACKEND_SWITCH'
    $env:API_NETWORK_STAGE = 'private'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'PRIVATE_DEPLOYMENT_APPROVED'
    $env:PRIVATE_DEPLOYMENT_APPROVED = 'true'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Switch to and validate'
    $env:API_BOOTSTRAP_APPROVED = 'true'
    $env:SITE_BOOTSTRAP_STATUS = 'in-progress'
    $env:API_ALLOW_BACKEND_SWITCH = 'true'
    & (Join-Path $scripts 'Test-ApiMigrationPrerequisites.ps1')
    Write-Output 'PASS: explicit empty-link private bootstrap is allowed'
    $global:MigrationScriptTestState.links = @(@{ properties = @{ backendResourceId = $env:AZURE_FUNCTION_APP_ID } })
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Switch to and validate'
    $global:MigrationScriptTestState.links = @()
    $env:API_BOOTSTRAP_APPROVED = ''
    $env:SITE_BOOTSTRAP_STATUS = ''
    $env:API_ALLOW_BACKEND_SWITCH = ''
    $env:API_NETWORK_STAGE = 'direct'
    $global:MigrationScriptTestState.resources = @(@{ type = 'Microsoft.ApiManagement/service'; name = 'apim-summit-test' })
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'A migration gateway already exists'
    $global:MigrationScriptTestState.resources = @(@{ type = 'Microsoft.Web/sites'; name = 'test-function'; id = $env:AZURE_FUNCTION_APP_ID })
    $env:AZURE_FUNCTION_APP_NAME = ''
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Refresh and verify azd outputs'
    $env:AZURE_FUNCTION_APP_NAME = 'test-function'
    $global:MigrationScriptTestState.networkAccess = 'Disabled'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Refusing to reopen'
    $global:MigrationScriptTestState.networkAccess = 'Enabled'
    $global:MigrationScriptTestState.links = @(@{ properties = @{ backendResourceId = $env:AZURE_APIM_ID } })
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'SWA already uses APIM'
    $env:API_NETWORK_STAGE = 'gateway'
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Restore APIM_LINKED_PRODUCT_ID'
    $env:API_NETWORK_STAGE = 'direct'
    Assert-Denied 'Sync-ApiBackend.ps1' 'Refusing automatic unlink/relink'
    $global:MigrationScriptTestState.links = @(@{ properties = @{ backendResourceId = $env:AZURE_FUNCTION_APP_ID } })
    & (Join-Path $scripts 'Sync-ApiBackend.ps1')
    Write-Output 'PASS: matching direct backend is retained without a write'
    if (@($global:MigrationScriptTestState.requests | Where-Object { $_ -match '(--method put|backends (link|unlink))' }).Count -gt 0) {
        throw 'A read-only safety test unexpectedly attempted an Azure write.'
    }
    $env:API_NETWORK_STAGE = 'prepare'
    $global:MigrationScriptTestState.resources = @(@{ type = 'Microsoft.Network/virtualNetworks'; name = 'azvnet-test'; id = '/test/virtualNetworks/test' })
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Preserve the NSG'
    $env:FUNCTION_SUBNET_NSG_ID = '/test/nsg'
    $global:MigrationScriptTestState.subnetProperties.routeTable = @{ id = '/test/routes' }
    Assert-Denied 'Test-ApiMigrationPrerequisites.ps1' 'Unmodeled routeTable'
    $global:MigrationScriptTestState.subnetProperties.Remove('routeTable')
    & (Join-Path $scripts 'Test-ApiMigrationPrerequisites.ps1')
    Write-Output 'PASS: preparing an existing subnet preserves its NSG'
    $env:API_NETWORK_STAGE = 'gateway'
    $global:MigrationScriptTestState.links = @(@{ properties = @{ backendResourceId = $env:AZURE_APIM_ID } })
    $global:MigrationScriptTestState.productPolicy = '<policies><inbound /></policies>'
    Assert-Denied 'Sync-ApiBackend.ps1' 'JWT validation is missing'
    $global:MigrationScriptTestState.productPolicy = '<policies><inbound><validate-jwt /></inbound></policies>'
    & (Join-Path $scripts 'Sync-ApiBackend.ps1')
    if (@($global:MigrationScriptTestState.requests | Where-Object { $_ -match '--method put' }).Count -ne 2) {
        throw 'Expected only API product association and named-value update.'
    }
    if (@($global:MigrationScriptTestState.requests | Where-Object { $_ -match 'env set APIM_LINKED_PRODUCT_ID swa' }).Count -ne 1) {
        throw 'Generated product ID was not persisted.'
    }
    Write-Output 'PASS: matching gateway retains its link and persists the validated product'
    $global:MigrationScriptTestState.modernProduct = $true
    & (Join-Path $scripts 'Sync-ApiBackend.ps1')
    if (@($global:MigrationScriptTestState.requests | Where-Object { $_ -match 'env set APIM_LINKED_PRODUCT_ID test' }).Count -ne 1) {
        throw 'Current Azure-generated product was not validated and persisted.'
    }
    Write-Output 'PASS: current Azure-generated SWA product is validated and persisted'
    foreach ($file in Get-ChildItem -LiteralPath $scripts -Filter '*.ps1') {
        $tokens = $null
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        if ($errors.Count -gt 0) { throw ($errors | Out-String) }
        Write-Output "PASS: PowerShell syntax $($file.Name)"
    }
    [xml]$apiPolicy = Get-Content -LiteralPath (Join-Path $root 'infra\policies\summit-api.xml') -Raw
    if ($apiPolicy.policies.inbound.FirstChild.Name -ne 'base') { throw 'Product validation must be inherited first.' }
    if ($null -eq $apiPolicy.SelectSingleNode('/policies/inbound/authentication-managed-identity[@ignore-error="false"]')) {
        throw 'Backend managed identity must fail closed.'
    }
    Write-Output 'PASS: gateway policy XML and fail-closed inheritance'
} finally {
    foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    Remove-Variable -Name MigrationScriptTestState -Scope Global
}
