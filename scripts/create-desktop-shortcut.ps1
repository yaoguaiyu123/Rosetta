[CmdletBinding()]
param(
    [string]$DesktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
)

$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$launcherPath = Join-Path $projectDirectory '启动.bat'
$iconPath = Join-Path $projectDirectory 'assets/desktop/reader.ico'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'Launcher not found.' }
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw 'Desktop icon not found.' }
if (-not $DesktopDirectory -or -not (Test-Path -LiteralPath $DesktopDirectory -PathType Container)) {
    throw 'Desktop folder not found.'
}

$shell = New-Object -ComObject WScript.Shell
$shortcutName = '译读 PDF 阅读器'
$shortcutPath = Join-Path $DesktopDirectory ($shortcutName + '.lnk')
$suffix = 2
while (Test-Path -LiteralPath $shortcutPath) {
    $existingShortcut = $shell.CreateShortcut($shortcutPath)
    if ($existingShortcut.TargetPath -ieq $launcherPath) { break }
    # Preserve unrelated shortcuts with the same name.
    $shortcutPath = Join-Path $DesktopDirectory ($shortcutName + ' (' + $suffix + ').lnk')
    $suffix++
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectDirectory
$shortcut.IconLocation = $iconPath + ',0'
$shortcut.Description = '译读：本机 PDF 阅读、划词翻译与全文翻译'
$shortcut.WindowStyle = 7
$shortcut.Save()

# Verify the saved link rather than only the COM object used to write it.
$savedShortcut = $shell.CreateShortcut($shortcutPath)
if ($savedShortcut.TargetPath -ine $launcherPath -or
    $savedShortcut.WorkingDirectory -ine $projectDirectory -or
    $savedShortcut.IconLocation -ine ($iconPath + ',0') -or
    $savedShortcut.WindowStyle -ne 7) {
    throw 'Shortcut verification failed.'
}

[PSCustomObject]@{
    Shortcut = $shortcutPath
    Target = $savedShortcut.TargetPath
    Icon = $savedShortcut.IconLocation
    WindowStyle = $savedShortcut.WindowStyle
}
