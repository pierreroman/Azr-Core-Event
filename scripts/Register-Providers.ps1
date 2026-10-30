. (Join-Path $PSScriptRoot 'AzureCli.ps1')
if (-not $env:AZURE_SUBSCRIPTION_ID) { throw 'AZURE_SUBSCRIPTION_ID is required.' }
$providers = @('Microsoft.App', 'Microsoft.Compute', 'Microsoft.DocumentDB', 'Microsoft.Insights',
    'Microsoft.ManagedIdentity', 'Microsoft.Network', 'Microsoft.OperationalInsights',
    'Microsoft.Storage', 'Microsoft.Web')
if ((Get-ApiNetworkStage) -ne 'direct') { $providers += 'Microsoft.ApiManagement' }
$registered = (Invoke-AzureCli -Arguments @('provider', 'list', '--subscription', $env:AZURE_SUBSCRIPTION_ID,
    '--query', "[?registrationState=='Registered'].namespace", '-o', 'tsv')) -split "`r?`n"
foreach ($provider in @($providers | Where-Object { $_ -notin $registered })) {
    Invoke-AzureCli -Arguments @('provider', 'register', '--namespace', $provider,
        '--subscription', $env:AZURE_SUBSCRIPTION_ID, '-o', 'none') | Out-Null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $state = Invoke-AzureCli -Arguments @('provider', 'show', '--namespace', $provider,
            '--subscription', $env:AZURE_SUBSCRIPTION_ID, '--query', 'registrationState', '-o', 'tsv')
        if ($state -eq 'Registered') { break }
        Start-Sleep -Seconds 5
    }
    if ($state -ne 'Registered') { throw "Resource provider registration timed out: $provider" }
    Write-Host "Registered $provider."
}
