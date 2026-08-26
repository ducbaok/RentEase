<#
.SYNOPSIS
  Blocks the local Supabase ports at the Windows firewall (bug B0-1).

.DESCRIPTION
  `supabase start` publishes every container port on ALL interfaces, so on a
  laptop joined to a cafe or office network the local Postgres — user
  `postgres`, password `postgres`, no TLS — answers anyone on that network, and
  so does Supabase Studio.

  The obvious fix, binding to 127.0.0.1 in supabase/config.toml, does not
  exist: the CLI builds its Docker arguments as `-p <port>:<port>` with no host
  address, and there is no configuration key that changes it. Verified against
  CLI 2.115.0; see the note in supabase/config.toml.

  So the block goes one layer out, at the firewall. Loopback traffic bypasses
  the Windows firewall entirely, so `pnpm dev`, `pnpm db:reset`, psql on
  127.0.0.1 and the pgTAP runner are all unaffected — only another machine on
  the network is refused.

  This changes a system security setting, so it needs an elevated PowerShell and
  it is never run automatically by any test or build.

.PARAMETER Remove
  Removes the rules again.

.EXAMPLE
  # In an elevated PowerShell, from the repository root:
  ./scripts/harden-local-supabase.ps1

.EXAMPLE
  ./scripts/harden-local-supabase.ps1 -Remove
#>
[CmdletBinding()]
param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

# API gateway 54321 · Postgres 54322 · Studio 54323 · Inbucket 54324 ·
# analytics 54327. 54320 is the shadow database used by `db diff`.
$RuleName = 'RentEase - block local Supabase ports from the network'
$Ports = '54320-54329'

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  Write-Error @'
This script edits Windows Firewall rules and must run elevated.
Open PowerShell as Administrator, cd to the repository root, and run it again.
'@
  exit 1
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

if ($Remove) {
  if ($existing) {
    $existing | Remove-NetFirewallRule
    Write-Host "Removed the firewall rule. The Supabase ports are reachable from the network again."
  } else {
    Write-Host "Nothing to remove - the rule is not present."
  }
  exit 0
}

if ($existing) {
  Write-Host "The rule already exists; leaving it as it is."
} else {
  New-NetFirewallRule `
    -DisplayName $RuleName `
    -Description 'Bug B0-1: the Supabase CLI publishes container ports on 0.0.0.0 and offers no bind address. Loopback is exempt from the Windows firewall, so local development is unaffected.' `
    -Direction Inbound `
    -Action Block `
    -Protocol TCP `
    -LocalPort $Ports `
    -Profile Any `
    -Enabled True | Out-Null
  Write-Host "Blocked inbound TCP $Ports on every profile."
}

# Prove it, rather than asserting it. A block rule that silently failed to apply
# is exactly the outcome this script exists to prevent.
$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Checking Postgres (54322) on each non-loopback address:'
foreach ($address in $addresses) {
  $reachable = (Test-NetConnection -ComputerName $address -Port 54322 -WarningAction SilentlyContinue).TcpTestSucceeded
  $verdict = if ($reachable) { 'STILL REACHABLE' } else { 'blocked' }
  Write-Host ("  {0,-16} {1}" -f $address, $verdict)
}

$loopback = (Test-NetConnection -ComputerName 127.0.0.1 -Port 54322 -WarningAction SilentlyContinue).TcpTestSucceeded
Write-Host ''
if ($loopback) {
  Write-Host '  127.0.0.1        still reachable - local development is unaffected, as intended.'
} else {
  Write-Warning '127.0.0.1 is not answering on 54322. Is Supabase running (`pnpm db:start`)?'
}
