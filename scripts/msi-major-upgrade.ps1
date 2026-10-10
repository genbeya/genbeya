# powershell -File scripts/msi-major-upgrade.ps1 <installer.msi>
# Makes an MSI replace older installed versions of the same product (a "major
# upgrade", what WiX's <MajorUpgrade/> does). Deno Desktop's MSIs keep the upgrade
# code across versions but lack the Upgrade table, so without this each version
# would install next to the previous one.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = "Stop"

$installer = New-Object -ComObject WindowsInstaller.Installer
function Invoke($target, $method, $arguments) { $target.GetType().InvokeMember($method, "InvokeMethod", $null, $target, $arguments) }
function Get($target, $property, $arguments) { $target.GetType().InvokeMember($property, "GetProperty", $null, $target, $arguments) }

# 1 = msiOpenDatabaseModeTransact
$database = Invoke $installer "OpenDatabase" @((Resolve-Path $Path).Path, 1)
function Run([string]$sql) {
  $view = Invoke $database "OpenView" @($sql)
  Invoke $view "Execute" $null | Out-Null
  $view
}
function Value([string]$sql) {
  $record = Invoke (Run $sql) "Fetch" $null
  if ($record) { Get $record "StringData" 1 } else { $null }
}

$upgradeCode = Value "SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = 'UpgradeCode'"
$version = Value "SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = 'ProductVersion'"
if (-not $upgradeCode -or -not $version) { throw "$Path has no UpgradeCode or ProductVersion." }
if ((Get $database "TablePersistent" @("Upgrade")) -eq 1) { Write-Host "$Path already has an Upgrade table."; exit 0 }

Run "CREATE TABLE ``Upgrade`` (``UpgradeCode`` CHAR(38) NOT NULL, ``VersionMin`` CHAR(20), ``VersionMax`` CHAR(20), ``Language`` CHAR(255), ``Attributes`` LONG NOT NULL, ``Remove`` CHAR(255), ``ActionProperty`` CHAR(72) NOT NULL PRIMARY KEY ``UpgradeCode``, ``VersionMin``, ``VersionMax``, ``Language``, ``Attributes``)" | Out-Null
# Every older version: 256 = msidbUpgradeAttributesVersionMinInclusive; the maximum (this version) is exclusive.
Run "INSERT INTO ``Upgrade`` (``UpgradeCode``, ``VersionMin``, ``VersionMax``, ``Attributes``, ``ActionProperty``) VALUES ('$upgradeCode', '0.0.0', '$version', 256, 'PREVIOUSVERSIONSINSTALLED')" | Out-Null
# MSIs built before GitDesk set a version all claimed 1.0.0; replace those too while GitDesk is below 1.0.
# 768 = minimum and maximum inclusive.
if ($version.StartsWith("0.")) {
  Run "INSERT INTO ``Upgrade`` (``UpgradeCode``, ``VersionMin``, ``VersionMax``, ``Attributes``, ``ActionProperty``) VALUES ('$upgradeCode', '1.0.0', '1.0.0', 768, 'PREVIOUSVERSIONSINSTALLED')" | Out-Null
}
# Windows Installer passes only secure properties from the UI to the elevated install.
$secure = Value "SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = 'SecureCustomProperties'"
if ($secure) {
  Run "UPDATE ``Property`` SET ``Value`` = '$secure;PREVIOUSVERSIONSINSTALLED' WHERE ``Property`` = 'SecureCustomProperties'" | Out-Null
} else {
  Run "INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('SecureCustomProperties', 'PREVIOUSVERSIONSINSTALLED')" | Out-Null
}
# Find older versions early; remove them right after validation, before this version installs.
Run "INSERT INTO ``InstallExecuteSequence`` (``Action``, ``Sequence``) VALUES ('FindRelatedProducts', 25)" | Out-Null
Run "INSERT INTO ``InstallExecuteSequence`` (``Action``, ``Sequence``) VALUES ('RemoveExistingProducts', 1401)" | Out-Null
if ((Get $database "TablePersistent" @("InstallUISequence")) -eq 1) {
  Run "INSERT INTO ``InstallUISequence`` (``Action``, ``Sequence``) VALUES ('FindRelatedProducts', 25)" | Out-Null
}
Invoke $database "Commit" $null | Out-Null
Write-Host "$Path now replaces older versions of $upgradeCode."
