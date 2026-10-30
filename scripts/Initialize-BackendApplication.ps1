param(
    [Parameter(Mandatory)][string]$EnvironmentName,
    [string]$ApplicationId,
    [string]$ServiceManagementReference
)
. (Join-Path $PSScriptRoot 'AzureCli.ps1')
if ($EnvironmentName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$') { throw 'Invalid environment name.' }
if ($ApplicationId) {
    $parsed = [guid]::Empty
    if (-not [guid]::TryParse($ApplicationId, [ref]$parsed) -or $parsed -eq [guid]::Empty) {
        throw 'Backend application ID must be a nonempty GUID.'
    }
    $applications = @(Invoke-GraphRequest -Path "/applications?`$filter=appId eq '$ApplicationId'" |
        Select-Object -ExpandProperty value)
    if ($applications.Count -ne 1) { throw 'Expected one backend application in the signed-in tenant.' }
    $application = $applications[0]
} else {
    $name = "community-event-$EnvironmentName-backend"
    $applications = @((Invoke-GraphRequest -Path "/applications?`$filter=displayName eq '$name'").value)
    if ($applications.Count -gt 1) { throw 'Multiple matching backend applications; supply an explicit application ID.' }
    if ($applications.Count -eq 1) {
        $application = $applications[0]
    } else {
        $body = @{
            displayName = $name
            signInAudience = 'AzureADMyOrg'
            api = @{ requestedAccessTokenVersion = 2 }
            requiredResourceAccess = @()
        }
        if ($ServiceManagementReference) { $body.serviceManagementReference = $ServiceManagementReference }
        $application = Invoke-GraphRequest -Path '/applications' -Method post -Body $body
        # Persist immediately so retries do not create a second registration.
        Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name BACKEND_APPLICATION_ID -Value $application.appId
    }
}
$appId = $application.appId
$uri = "api://$appId"
$secrets = @($application.passwordCredentials) + @($application.keyCredentials)
if ($application.signInAudience -ne 'AzureADMyOrg' -or $secrets.Count -ne 0 -or
    @($application.requiredResourceAccess).Count -ne 0) {
    throw 'Backend app must be dedicated, single-tenant, secretless, with no directory API permissions.'
}
if (@($application.identifierUris).Count -gt 0 -and
    (@($application.identifierUris).Count -ne 1 -or $application.identifierUris[0] -ne $uri)) {
    throw 'Unexpected backend identifier URI; refusing to alter an unrelated registration.'
}
Invoke-GraphRequest -Path "/applications/$($application.id)" -Method patch -Body @{
    identifierUris = @($uri)
    api = @{ requestedAccessTokenVersion = 2 }
} | Out-Null
$principals = @((Invoke-GraphRequest -Path "/servicePrincipals?`$filter=appId eq '$appId'").value)
if ($principals.Count -eq 0) {
    Invoke-GraphRequest -Path '/servicePrincipals' -Method post -Body @{ appId = $appId } | Out-Null
} elseif ($principals.Count -ne 1) { throw 'Unexpected duplicate backend service principals.' }
$verified = Invoke-GraphRequest -Path "/applications/$($application.id)"
if ($verified.api.requestedAccessTokenVersion -ne 2 -or $uri -notin $verified.identifierUris) {
    throw 'Backend application verification failed.'
}
Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name BACKEND_APPLICATION_ID -Value $appId
Write-Host "Verified secretless backend application $appId."
