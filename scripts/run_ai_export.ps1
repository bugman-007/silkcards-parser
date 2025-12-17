param(
  [Parameter(Mandatory=$true)][string]$JobId,
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutDir
)

$ErrorActionPreference = "Stop"

# Make JSX path relative to this script (avoids D:\ vs C:\ issues)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsxPath = Join-Path $ScriptDir "export_plates.jsx"

function Escape-ForJsString([string]$s) {
  # Escape backslashes and quotes for embedding into JS source
  return ($s -replace '\\', '\\\\' -replace '"', '\"')
}

try {
  if (-not (Test-Path $InputPath)) { throw "InputPath not found: $InputPath" }
  if (-not (Test-Path $jsxPath))   { throw "JSX not found: $jsxPath" }
  if (-not (Test-Path $OutDir))    { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

  $ai = New-Object -ComObject "Illustrator.Application"

  # Use a safer enum value. If it fails, continue without setting it.
  try {
    # Common valid values: 1=DisplayAlerts, 2=DontDisplayAlerts (COM often accepts 2)
    $ai.UserInteractionLevel = 2
  } catch {
    # Don't hard-fail on this; it's optional
  }

  # Optional: keep invisible (set to $true if you want to see it)
  try { $ai.Visible = $true } catch {}

  $doc = $ai.Open((Resolve-Path $InputPath).Path)

  # Build JS args safely (avoid broken JS due to Windows backslashes)
  $jobIdEsc = Escape-ForJsString $JobId
  $outDirEsc = Escape-ForJsString (Resolve-Path $OutDir).Path

  $js = "var __PARSER_ARGS__ = { jobId: ""$jobIdEsc"", outDir: ""$outDirEsc"" };"
  $ai.DoJavaScript($js)
  $ai.DoJavaScriptFile($jsxPath)

  # 2 usually maps to "DoNotSaveChanges" in COM enums; keep but guard it
  try { $doc.Close(2) } catch { try { $doc.Close() } catch {} }

  exit 0
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}
finally {
  # Prevent orphaned Illustrator.exe processes in long-running workers
  try { if ($doc) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) } } catch {}
  try { if ($ai)  { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ai)  } } catch {}
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
