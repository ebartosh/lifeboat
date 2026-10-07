param(
  [ValidateSet('x86_64', 'arm64-v8a', 'all')]
  [string]$Architecture = 'x86_64',
  [switch]$Release,
  [string]$JavaPath = 'C:\Program Files\Java\jdk-17',
  [string]$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
)

$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath "$JavaPath\bin\java.exe")) { throw "JDK not found: $JavaPath" }
if (!(Test-Path -LiteralPath "$SdkPath\platforms\android-36")) { throw 'Android SDK Platform 36 is required' }
$root = Split-Path -Parent $PSScriptRoot
if (!(Test-Path -LiteralPath "$root\android\gradlew.bat")) {
  throw 'Run corepack pnpm exec expo prebuild --platform android --no-clean first'
}

$names = @('JAVA_HOME', 'ANDROID_HOME', 'PATH', 'NODE_ENV', 'CMAKE_BUILD_PARALLEL_LEVEL', 'DEBUG')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $root
try {
  $env:JAVA_HOME = $JavaPath
  $env:ANDROID_HOME = $SdkPath
  $env:PATH = "$JavaPath\bin;$SdkPath\platform-tools;$env:PATH"
  $env:NODE_ENV = if ($Release) { 'production' } else { 'development' }
  $env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
  $env:DEBUG = ''
  $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
  $architectures = if ($Architecture -eq 'all') { 'x86_64,arm64-v8a' } else { $Architecture }
  & .\android\gradlew.bat -p android $task "-PreactNativeArchitectures=$architectures" `
    '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=1024m' `
    '-Pkotlin.compiler.execution.strategy=in-process' --max-workers=2 --no-parallel --console=plain
  $buildExit = $LASTEXITCODE
} finally {
  Pop-Location
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
exit $buildExit
