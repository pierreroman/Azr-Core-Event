Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-AzureCli {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $result = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed (exit $LASTEXITCODE): $($Arguments[0]) $($Arguments[1])"
    }
    return ($result -join "`n")
}

function Invoke-AzureRest {
    param(
        [Parameter(Mandatory)][string]$ResourceId,
        [string]$ApiVersion = '2024-05-01',
        [ValidateSet('get', 'put')][string]$Method = 'get',
        [object]$Body
    )
    $arguments = @('rest', '--method', $Method, '--url',
        "https://management.azure.com${ResourceId}?api-version=$ApiVersion",
        '--headers', 'Accept=application/json', '--output', 'json')
    if ($null -eq $Body) { return (Invoke-AzureCli -Arguments $arguments | ConvertFrom-Json) }
    $file = [IO.Path]::GetTempFileName()
    try {
        $Body | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $file -Encoding utf8
        return (Invoke-AzureCli -Arguments ($arguments + @('--body', "@$file")) | ConvertFrom-Json)
    } finally { Remove-Item -LiteralPath $file }
}

function Get-ApiNetworkStage {
    $stage = $env:API_NETWORK_STAGE
    if ([string]::IsNullOrWhiteSpace($stage)) { $stage = 'private' }
    if ($stage -notin @('direct', 'prepare', 'gateway', 'private')) { throw "Invalid API_NETWORK_STAGE: $stage" }
    return $stage
}

function Import-AzdEnvironment {
    param([Parameter(Mandatory)][string]$EnvironmentName)
    if ($EnvironmentName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$') { throw 'Invalid environment name.' }
    $result = & azd env get-values --environment $EnvironmentName
    if ($LASTEXITCODE -ne 0) { throw "Could not load azd environment '$EnvironmentName'." }
    $values = @{}
    foreach ($line in $result) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)="(.*)"$') {
            throw 'Unexpected azd environment output format. Values were not printed.'
        }
        $values[$Matches[1]] = $Matches[2]
    }
    foreach ($key in @('AZURE_SUBSCRIPTION_ID', 'AZURE_LOCATION', 'RESOURCE_GROUP_ID',
        'API_NETWORK_STAGE', 'AZURE_API_NETWORK_STAGE', 'RESILIENCY_CLASSIFICATION',
        'SITE_BOOTSTRAP_STATUS', 'PRIVATE_DEPLOYMENT_APPROVED',
        'API_GATEWAY_CUTOVER_APPROVED', 'APIM_PUBLISHER_NAME', 'APIM_PUBLISHER_EMAIL',
        'AZURE_RESOURCE_GROUP', 'AZURE_STATICWEBAPP_NAME', 'AZURE_STATICWEBAPP_HOSTNAME',
        'AZURE_FUNCTION_APP_ID', 'AZURE_FUNCTION_APP_NAME', 'AZURE_STORAGE_ACCOUNT_NAME',
        'AZURE_STORAGE_ACCOUNT_ID', 'AZURE_PRIVATE_ENDPOINT_SUBNET_ID', 'PRIVATE_ENDPOINT_SUBNET_ID',
        'AZURE_APIM_ID', 'AZURE_APIM_NAME', 'AZURE_APIM_PRINCIPAL_ID',
        'APIM_LINKED_PRODUCT_ID', 'BACKEND_APPLICATION_ID',
        'FUNCTION_SUBNET_NSG_ID', 'PRIVATE_ENDPOINT_SUBNET_NSG_ID', 'SITE_ADMIN_EMAILS')) {
        if (-not $values.ContainsKey($key)) { [Environment]::SetEnvironmentVariable($key, $null) }
    }
    foreach ($entry in $values.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value) }
    $env:AZURE_ENV_NAME = $EnvironmentName
    return $values
}

function Set-AzdEnvironmentValue {
    param(
        [Parameter(Mandatory)][string]$EnvironmentName,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Value
    )
    & azd env set $Name $Value --environment $EnvironmentName
    if ($LASTEXITCODE -ne 0) { throw "Could not persist environment setting $Name." }
    [Environment]::SetEnvironmentVariable($Name, $Value)
}

function Invoke-GraphRequest {
    param(
        [Parameter(Mandatory)][string]$Path,
        [ValidateSet('get', 'post', 'patch')][string]$Method = 'get',
        [object]$Body
    )
    if ($Path -notmatch '^/(applications|servicePrincipals)([/(?]|$)') { throw 'Unexpected Graph resource path.' }
    $arguments = @('rest', '--method', $Method, '--url', "https://graph.microsoft.com/v1.0$Path", '--output', 'json')
    if ($null -eq $Body) { return (Invoke-AzureCli -Arguments $arguments | ConvertFrom-Json) }
    $file = [IO.Path]::GetTempFileName()
    try {
        $Body | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $file -Encoding utf8
        $result = Invoke-AzureCli -Arguments ($arguments + @('--headers', 'Content-Type=application/json', '--body', "@$file"))
        if (-not [string]::IsNullOrWhiteSpace($result)) { return ($result | ConvertFrom-Json) }
    } finally { Remove-Item -LiteralPath $file }
}
