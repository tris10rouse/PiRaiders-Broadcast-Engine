param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$item = Get-Item -LiteralPath $File
$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
$subject = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject }
[ordered]@{
    signatureStatus = [string]$signature.Status
    signer = $subject
    fileVersion = $item.VersionInfo.FileVersion
    productVersion = $item.VersionInfo.ProductVersion
    productName = $item.VersionInfo.ProductName
} | ConvertTo-Json -Compress
