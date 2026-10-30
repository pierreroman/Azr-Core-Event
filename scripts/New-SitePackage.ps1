param([Parameter(Mandatory)][string]$OutputPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $output) { throw 'Output already exists; choose a new archive path.' }
if ([IO.Path]::GetExtension($output) -ne '.zip') { throw 'Output must be a ZIP file.' }
$files = [Collections.Generic.List[IO.FileInfo]]::new()
foreach ($name in @('readme.md', '.gitignore', 'deploy.ps1', 'azure.yaml', 'package.json',
    'package-lock.json', 'playwright.config.js', 'locustfile.py', 'load-test-config.yaml',
    'load-test-na.yaml', 'load-test-eu.yaml', 'load-test-apac.yaml',
    'api\README.md', 'api\package.json', 'api\package-lock.json', 'api\host.json', 'api\.funcignore',
    'infra\main.parameters.json')) {
    $files.Add((Get-Item -LiteralPath (Join-Path $root $name)))
}
foreach ($folder in @('src\web', 'api\src', 'api\test', 'scripts', 'docs', 'tests', 'infra')) {
    foreach ($item in Get-ChildItem -LiteralPath (Join-Path $root $folder) -Recurse -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Symbolic links are not packaged: $($item.Name)" }
        if ($item.PSIsContainer) { continue }
        if ($folder -eq 'infra' -and $item.Extension -notin @('.bicep', '.xml')) { continue }
        if ($folder -eq 'docs' -and $item.Extension -ne '.md') { continue }
        if ($folder -eq 'tests' -and $item.Extension -notin @('.js', '.ps1')) { continue }
        if ($folder -eq 'scripts' -and $item.Extension -notin @('.ps1', '.sh')) { continue }
        if ($item.Name -match '(?i)(^\.env($|\.)|local\.settings|credentials|private-agent|\.pem$|\.key$)') {
            throw "Secret-like file in source package: $($item.Name)"
        }
        $files.Add($item)
    }
}
$manifest = [Collections.Generic.List[object]]::new()
$parent = Split-Path $output -Parent
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Output directory must already exist.' }
$archive = [IO.Compression.ZipFile]::Open($output, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files | Sort-Object FullName -Unique) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Symbolic links are not packaged: $($file.Name)" }
        $name = [IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name) | Out-Null
        $manifest.Add(@{ path = $name; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() })
    }
    $entry = $archive.CreateEntry('deployment-manifest.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try {
        $writer.Write((@{ schemaVersion = 1; files = $manifest.ToArray() } | ConvertTo-Json -Depth 5))
    } finally { $writer.Dispose() }
} catch {
    $archive.Dispose()
    Remove-Item -LiteralPath $output
    throw
} finally { $archive.Dispose() }
Write-Output "Source package: $output"
Write-Output "Files: $($manifest.Count); environments, secrets, installed dependencies and live event data excluded."
Write-Output "SHA256: $((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash)"
