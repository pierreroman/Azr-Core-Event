param([string]$EnvironmentName = $env:AZURE_ENV_NAME)
. (Join-Path $PSScriptRoot 'AzureCli.ps1')
if ($EnvironmentName) { Import-AzdEnvironment -EnvironmentName $EnvironmentName | Out-Null }
foreach ($key in @('AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_STATICWEBAPP_NAME')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { throw "$key is required." }
}
$root = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $root 'node_modules\@azure\static-web-apps-cli\dist\cli\bin.js'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Pinned SWA CLI is missing. Run npm ci in the repository root.' }
$token = Invoke-AzureCli -Arguments @('staticwebapp', 'secrets', 'list',
    '--name', $env:AZURE_STATICWEBAPP_NAME, '--resource-group', $env:AZURE_RESOURCE_GROUP,
    '--subscription', $env:AZURE_SUBSCRIPTION_ID, '--query', 'properties.apiKey', '-o', 'tsv')
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Could not retrieve SWA deployment token.' }
$previousToken = $env:SWA_CLI_DEPLOYMENT_TOKEN
try {
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $token
    $location = Join-Path $root 'src\web'
    & node $cli deploy --app-name $env:AZURE_STATICWEBAPP_NAME --resource-group $env:AZURE_RESOURCE_GROUP `
        --subscription-id $env:AZURE_SUBSCRIPTION_ID --env production --no-use-keychain `
        --app-location $location --output-location $location
    if ($LASTEXITCODE -ne 0) { throw "Frontend deployment failed (exit $LASTEXITCODE)." }
} finally {
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $previousToken
    $token = $null
}
Write-Host "Frontend deployed to https://$env:AZURE_STATICWEBAPP_HOSTNAME."
