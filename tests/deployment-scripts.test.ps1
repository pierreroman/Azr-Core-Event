$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$scripts = Join-Path $root 'scripts'
$saved = @{}
Get-ChildItem Env: | ForEach-Object { $saved[$_.Name] = $_.Value }
$temp = Join-Path ([IO.Path]::GetTempPath()) "site-deployment-tests-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temp | Out-Null
$global:SiteDeploymentTest = @{
    values = @{ AZURE_ENV_NAME = 'fixture'; AZURE_SUBSCRIPTION_ID = 'subscription'; AZURE_LOCATION = 'eastus2'; AZURE_RESOURCE_GROUP = 'rg-fixture' }
    calls = [Collections.Generic.List[string]]::new()
    groupExists = $false
    failSmoke = $false
    graphMode = 'fresh'
    failAz = $false
    failWeb = $false
    badSchema = $false
}
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    Write-Output "PASS: $Message"
}
function Assert-Throws([scriptblock]$Action, [string]$Expected) {
    $caught = $false
    try { & $Action } catch {
        if ($_.Exception.Message -notlike "*$Expected*") { throw }
        $caught = $true
    }
    Assert-True $caught "denied: $Expected"
}
function azd {
    $global:LASTEXITCODE = 0
    $state = $global:SiteDeploymentTest
    $state.calls.Add("azd $($args -join ' ')")
    if ($args[0] -eq 'provision') {
        foreach ($pair in @(@('AZURE_FUNCTION_APP_NAME', 'function'), @('AZURE_STATICWEBAPP_NAME', 'web'),
            @('AZURE_STATICWEBAPP_HOSTNAME', 'fixture.azurestaticapps.net'))) { $state.values[$pair[0]] = $pair[1] }
        return
    }
    switch ($args[1]) {
        'get-values' { foreach ($entry in $state.values.GetEnumerator()) { "$($entry.Key)=`"$($entry.Value)`"" }; return }
        'set' { $state.values[$args[2]] = $args[3]; return }
        'list' { return '[{"Name":"fixture"}]' }
        default { throw "Unexpected azd command: $($args -join ' ')" }
    }
}
function az {
    $global:LASTEXITCODE = 0
    $state = $global:SiteDeploymentTest
    $state.calls.Add("az $($args -join ' ')")
    if ($state.failAz) { $global:LASTEXITCODE = 7; return }
    if ($args[0] -eq 'account') {
        if ($args[1] -eq 'show') { return '{"tenantId":"tenant"}' }
        return
    }
    if ($args[0] -eq 'group') { return "$($state.groupExists)".ToLowerInvariant() }
    if ($args[0] -eq 'staticwebapp') {
        if ($args[1] -eq 'secrets') { return 'fake-deployment-token' }
        if ($state.graphMode -eq 'bad-invite') { return '{}' }
        return '{"invitationUrl":"https://fixture.azurestaticapps.net/.auth/invitations/fixture"}'
    }
    if ($args[0] -ne 'rest') { throw "Unexpected Azure command: $($args -join ' ')" }
    $url = $args[([array]::IndexOf($args, '--url') + 1)]
    $method = $args[([array]::IndexOf($args, '--method') + 1)]
    if ($url -like 'https://management.azure.com/*') {
        if ($url -match '/linkedBackends\?') {
            return (ConvertTo-Json -InputObject @{ value = @(@{ properties = @{ backendResourceId = $state.values.AZURE_APIM_ID } }) } -Depth 10)
        }
        return '{"properties":{"publicNetworkAccess":"Disabled"}}'
    }
    $app = @{
        id = 'object'; appId = '11111111-2222-3333-4444-555555555555'
        signInAudience = 'AzureADMyOrg'; passwordCredentials = @(); keyCredentials = @()
        requiredResourceAccess = @(); identifierUris = @('api://11111111-2222-3333-4444-555555555555')
        api = @{ requestedAccessTokenVersion = 2 }
    }
    if ($state.graphMode -eq 'secret') { $app.passwordCredentials = @(@{ keyId = 'unexpected' }) }
    if ($url -match '/applications\?') {
        $matching = @(switch ($state.graphMode) { 'ambiguous' { @($app, $app) } 'secret' { @($app) } default { @() } })
        return (ConvertTo-Json -InputObject @{ value = $matching } -Depth 10)
    }
    if ($url -match '/servicePrincipals\?') { return '{"value":[]}' }
    if ($method -eq 'post' -and $url -match '/applications$') {
        $bodyPath = $args[([array]::IndexOf($args, '--body') + 1)].Substring(1)
        $body = Get-Content -LiteralPath $bodyPath -Raw | ConvertFrom-Json
        if ($body.signInAudience -ne 'AzureADMyOrg' -or $body.api.requestedAccessTokenVersion -ne 2 -or
            @($body.requiredResourceAccess).Count -ne 0) { throw 'Incorrect backend app create body.' }
    }
    if ($method -eq 'patch' -or $url -match '/servicePrincipals$') { return '{}' }
    return ($app | ConvertTo-Json -Depth 10)
}
function node {
    $state = $global:SiteDeploymentTest
    if ($args -contains '--deployment-token' -or ($args -join ' ') -like '*fake-deployment-token*') { throw 'Deployment token leaked to arguments.' }
    if ($env:SWA_CLI_DEPLOYMENT_TOKEN -ne 'fake-deployment-token') { throw 'Missing process-scoped deployment token.' }
    $global:LASTEXITCODE = if ($state.failWeb) { 8 } else { 0 }
}
function Invoke-WebRequest {
    param($Uri, [switch]$SkipHttpErrorCheck, $TimeoutSec)
    if ($global:SiteDeploymentTest.badSchema) { $body = '{}' }
    else {
        $body = switch -Wildcard ($Uri) {
            '*/schedule' { '{"schedule":[]}' }
            '*/speakers' { '{"speakers":[]}' }
            '*/sponsors' { '{"sponsors":[]}' }
            '*/branding' { '{"eventName":"Community Online Event"}' }
            '*/registration' { '{"enabled":false}' }
            '*/content/*' { '{"content":"Sample defaults"}' }
            default { throw "Unexpected smoke URL: $Uri" }
        }
    }
    return @{ StatusCode = 200; Headers = @{ 'Content-Type' = 'application/json' }; Content = $body }
}
try {
    . (Join-Path $scripts 'AzureCli.ps1')
    Assert-True ([bool](Get-Command Import-AzdEnvironment)) 'environment helper is top-level'
    $env:API_NETWORK_STAGE = ''
    Assert-True ((Get-ApiNetworkStage) -eq 'private') 'missing stage defaults to private'
    $env:AZURE_APIM_ID = '/stale/gateway'
    $env:RESILIENCY_CLASSIFICATION = 'Must not leak across environments'
    $imported = Import-AzdEnvironment -EnvironmentName fixture
    Assert-True ($imported.AZURE_SUBSCRIPTION_ID -eq 'subscription' -and -not $env:AZURE_APIM_ID -and
        -not $env:RESILIENCY_CLASSIFICATION) 'environment import clears stale resource identity and governance tags'
    Assert-Throws { Import-AzdEnvironment -EnvironmentName "bad'name" } 'Invalid environment name'
    $global:SiteDeploymentTest.failAz = $true
    Assert-Throws { Invoke-AzureCli -Arguments @('account', 'show') } 'Azure CLI failed'
    $global:SiteDeploymentTest.failAz = $false
    & (Join-Path $scripts 'Initialize-BackendApplication.ps1') -EnvironmentName fixture
    Assert-True ($global:SiteDeploymentTest.values.BACKEND_APPLICATION_ID -eq '11111111-2222-3333-4444-555555555555') 'dedicated secretless app is persisted'
    $global:SiteDeploymentTest.graphMode = 'ambiguous'
    Assert-Throws { & (Join-Path $scripts 'Initialize-BackendApplication.ps1') -EnvironmentName fixture } 'Multiple matching'
    $global:SiteDeploymentTest.graphMode = 'secret'
    Assert-Throws { & (Join-Path $scripts 'Initialize-BackendApplication.ps1') -EnvironmentName fixture } 'secretless'
    $global:SiteDeploymentTest.values.SITE_ADMIN_EMAILS = 'owner@example.net'
    $global:SiteDeploymentTest.values.AZURE_STATICWEBAPP_NAME = 'web'
    $global:SiteDeploymentTest.values.AZURE_STATICWEBAPP_HOSTNAME = 'fixture.azurestaticapps.net'
    & (Join-Path $scripts 'Invite-SiteAdministrators.ps1') -EnvironmentName fixture
    Assert-True ($global:SiteDeploymentTest.calls[-1] -like '*owner@example.net*') 'administrator email is supplied by environment'
    $global:SiteDeploymentTest.graphMode = 'bad-invite'
    Assert-Throws { & (Join-Path $scripts 'Invite-SiteAdministrators.ps1') -EnvironmentName fixture } 'invitation URL'
    $env:SWA_CLI_DEPLOYMENT_TOKEN = 'previous-token'
    & (Join-Path $scripts 'Deploy-Web.ps1') -EnvironmentName fixture
    Assert-True ($env:SWA_CLI_DEPLOYMENT_TOKEN -eq 'previous-token') 'frontend deployment token stays off arguments and previous token is restored'
    $global:SiteDeploymentTest.failWeb = $true
    Assert-Throws { & (Join-Path $scripts 'Deploy-Web.ps1') -EnvironmentName fixture } 'Frontend deployment failed'
    Assert-True ($env:SWA_CLI_DEPLOYMENT_TOKEN -eq 'previous-token') 'failed frontend deployment restores token'
    $global:SiteDeploymentTest.values.AZURE_FUNCTION_APP_ID = '/subscriptions/subscription/resourceGroups/rg-fixture/providers/Microsoft.Web/sites/function'
    $global:SiteDeploymentTest.values.AZURE_APIM_ID = '/subscriptions/subscription/resourceGroups/rg-fixture/providers/Microsoft.ApiManagement/service/gateway'
    $global:SiteDeploymentTest.values.AZURE_STORAGE_ACCOUNT_NAME = 'storage'
    & (Join-Path $scripts 'Test-SiteDeployment.ps1') -EnvironmentName fixture
    Assert-True $true 'empty collection responses pass real smoke-script shape checks'
    $global:SiteDeploymentTest.badSchema = $true
    Assert-Throws { & (Join-Path $scripts 'Test-SiteDeployment.ps1') -EnvironmentName fixture } 'response shape mismatch'

    $fixtureScripts = Join-Path $temp 'scripts'
    New-Item -ItemType Directory -Path $fixtureScripts, (Join-Path $temp 'node_modules\@azure\static-web-apps-cli') | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'deploy.ps1') -Destination $temp
    Copy-Item -LiteralPath (Join-Path $scripts 'AzureCli.ps1') -Destination $fixtureScripts
    foreach ($name in @('Initialize-BackendApplication', 'Deploy-PrivateApi', 'Deploy-Web',
        'Test-SiteDeployment', 'Invite-SiteAdministrators')) {
        $stub = @'
param($EnvironmentName, $VmSize, $ApplicationId, $ServiceManagementReference, $Action = 'Deploy',
    [switch]$ProvisionAgent, [switch]$RemoveAgent)
$global:SiteDeploymentTest.calls.Add("$([IO.Path]::GetFileNameWithoutExtension($PSCommandPath)) $Action")
if ($Action -eq 'Cleanup' -and -not $RemoveAgent) { throw 'Cleanup must request RemoveAgent.' }
if ($PSCommandPath -like '*Test-SiteDeployment*' -and $global:SiteDeploymentTest.failSmoke) { throw 'Expected smoke failure' }
'@
        Set-Content -LiteralPath (Join-Path $fixtureScripts "$name.ps1") -Value $stub
    }
    $options = @{
        EnvironmentName = 'fixture'; SubscriptionId = 'subscription'; TenantId = 'tenant'; Location = 'eastus2'
        PublisherName = 'Community'; PublisherEmail = 'publisher@example.net'; AdminEmails = @('owner@example.net')
        Approved = $true
    }
    $global:SiteDeploymentTest.groupExists = $true
    $global:SiteDeploymentTest.values.SITE_BOOTSTRAP_STATUS = 'complete'
    Assert-Throws { & (Join-Path $temp 'deploy.ps1') @options } 'Resource group already exists'
    Assert-Throws { & (Join-Path $temp 'deploy.ps1') @options -Resume } 'Resource group already exists'
    $global:SiteDeploymentTest.groupExists = $false
    $global:SiteDeploymentTest.calls.Clear()
    & (Join-Path $temp 'deploy.ps1') @options
    $events = $global:SiteDeploymentTest.calls
    Assert-True ($global:SiteDeploymentTest.values.SITE_BOOTSTRAP_STATUS -eq 'complete') 'bootstrap completes only after successful acceptance and cleanup'
    Assert-True ($events.IndexOf('Deploy-PrivateApi Deploy') -lt $events.IndexOf('Deploy-Web Deploy') -and
        $events.IndexOf('Deploy-Web Deploy') -lt $events.IndexOf('Test-SiteDeployment Deploy')) 'private API deployment precedes frontend and smoke checks'
    Assert-True ($events.Contains('Deploy-PrivateApi Cleanup')) 'temporary VM cleanup runs'
    $global:SiteDeploymentTest.calls.Clear()
    & (Join-Path $temp 'deploy.ps1') -Action Deploy -EnvironmentName fixture -Approved
    Assert-True (-not ($global:SiteDeploymentTest.calls | Where-Object { $_ -like '*provision*' -or $_ -like 'Initialize-*' })) 'code-only deployment does not reprovision or modify Entra'
    $global:SiteDeploymentTest.failSmoke = $true
    $global:SiteDeploymentTest.calls.Clear()
    Assert-Throws { & (Join-Path $temp 'deploy.ps1') -Action Deploy -EnvironmentName fixture -Approved } 'Expected smoke failure'
    Assert-True ($global:SiteDeploymentTest.calls.Contains('Deploy-PrivateApi Cleanup')) 'failed acceptance still cleans the temporary VM'

    $archivePath = Join-Path $temp 'site.zip'
    & (Join-Path $scripts 'New-SitePackage.ps1') -OutputPath $archivePath
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $names = @($zip.Entries.FullName)
        foreach ($required in @('deploy.ps1', 'azure.yaml', 'package-lock.json', 'api/package-lock.json',
            'scripts/Deploy-PrivateApi.ps1', 'infra/deployment-agent.bicep', 'src/web/index.html', 'docs/deployment.md')) {
            Assert-True ($required -in $names) "source package contains $required"
        }
        Assert-True (-not ($names | Where-Object { $_ -match '(^|/)(\.azure|node_modules|\.git|local\.settings\.json)(/|$)' })) 'source package excludes environment, dependency and credential state'
        $reader = [IO.StreamReader]::new($zip.GetEntry('deployment-manifest.json').Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        foreach ($file in $manifest.files) {
            $entry = $zip.GetEntry($file.path)
            $stream = $entry.Open()
            try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
            finally { $stream.Dispose() }
            if ($hash -ne $file.sha256 -or $entry.Length -ne $file.bytes) { throw "Archive manifest mismatch: $($file.path)" }
        }
        Assert-True ($manifest.files.Count -eq $zip.Entries.Count - 1) 'every packaged file has a verified length and SHA256'
    } finally { $zip.Dispose() }
    Assert-Throws { & (Join-Path $scripts 'New-SitePackage.ps1') -OutputPath $archivePath } 'already exists'
    Write-Output 'All offline whole-site deployment checks passed. No Azure resource operation was executed.'
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
    foreach ($item in @(Get-ChildItem Env:)) {
        if (-not $saved.ContainsKey($item.Name)) { [Environment]::SetEnvironmentVariable($item.Name, $null) }
    }
    foreach ($entry in $saved.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value) }
    Remove-Variable SiteDeploymentTest -Scope Global
}
