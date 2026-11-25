$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localBin = Join-Path $PSScriptRoot 'work\bin'
if (Test-Path -LiteralPath $localBin) { $env:PATH = $localBin + ';' + $env:PATH }
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js의 npm/npx가 필요합니다.' }
node node_modules/typescript/bin/tsc --noEmit
if ($LASTEXITCODE) { throw 'TypeScript 검사 실패' }
$env:GITHUB_REPOSITORY = 'andy0405-bot/paperback-sbxh'
node node_modules/@paperback/toolchain/bin/run bundle --folder 0.8
if ($LASTEXITCODE) { throw '번들 빌드 실패' }
