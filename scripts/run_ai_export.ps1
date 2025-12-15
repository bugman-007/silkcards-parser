param(
  [Parameter(Mandatory=$true)][string]$JobId,
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutDir
)

$jsxPath = "D:\silkcards-parser\scripts\export_plates.jsx"

try {
  $ai = New-Object -ComObject "Illustrator.Application"
  $ai.UserInteractionLevel = 3 # aiDontDisplayAlerts (best effort)

  $doc = $ai.Open($InputPath)

  # Pass args to JSX via global variable string
  $argsJson = "{""jobId"":""$JobId"",""outDir"":""$OutDir""}"
  $ai.DoJavaScript("var __PARSER_ARGS__ = " + $argsJson + ";")
  $ai.DoJavaScriptFile($jsxPath)

  $doc.Close(2) # aiDoNotSaveChanges
  exit 0
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}
