param([string]$EnvironmentName = $env:AZURE_ENV_NAME)
. (Join-Path $PSScriptRoot 'AzureCli.ps1')
if ($EnvironmentName) { Import-AzdEnvironment -EnvironmentName $EnvironmentName | Out-Null }
$admins = @($env:SITE_ADMIN_EMAILS -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($admins.Count -eq 0) {
    Write-Host 'No SITE_ADMIN_EMAILS configured; administrator invitations were not requested.'
    return
}
foreach ($key in @('AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_STATICWEBAPP_NAME', 'AZURE_STATICWEBAPP_HOSTNAME')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { throw "$key is required for administrator invitations." }
}
foreach ($admin in $admins) {
    $result = Invoke-AzureCli -Arguments @('staticwebapp', 'users', 'invite',
        '--name', $env:AZURE_STATICWEBAPP_NAME, '--resource-group', $env:AZURE_RESOURCE_GROUP,
        '--subscription', $env:AZURE_SUBSCRIPTION_ID, '--authentication-provider', 'aad',
        '--user-details', $admin, '--roles', 'administrator', '--domain', $env:AZURE_STATICWEBAPP_HOSTNAME,
        '--invitation-expiration-in-hours', '168', '-o', 'json') | ConvertFrom-Json
    if (-not $result.PSObject.Properties['invitationUrl'] -or -not $result.invitationUrl) {
        throw "Azure did not return an invitation URL for $admin."
    }
    Write-Host "Administrator $admin must accept this invitation (valid 7 days), then sign out/in:"
    Write-Host $result.invitationUrl
}
