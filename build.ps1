param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [string]$BuildTools = '',
    [string]$Platform = '',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'test\build'),
    [switch]$DebugBuild
)
$ErrorActionPreference = 'Stop'
if (!$JavaHome -or !(Test-Path (Join-Path $JavaHome 'bin\javac.exe'))) { throw 'Set JAVA_HOME to a JDK 17+ directory, or pass -JavaHome.' }
if (!$BuildTools) { $BuildTools = Join-Path $AndroidSdk 'build-tools\35.0.0' }
if (!$Platform) { $Platform = Join-Path $AndroidSdk 'platforms\android-35\android.jar' }
if (!(Test-Path $Platform) -or !(Test-Path (Join-Path $BuildTools 'aapt2.exe'))) { throw 'Android SDK Platform 35 and Build Tools 35.0.0 are required.' }
$env:JAVA_HOME=$JavaHome
function Run([string]$Tool,[string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Tool failed with exit code $LASTEXITCODE" }
}
$source=Join-Path $PSScriptRoot 'app\src\main'
$out=[IO.Path]::GetFullPath($OutputDirectory)
$classes=Join-Path $out 'classes'
$dex=Join-Path $out 'dex'
New-Item -ItemType Directory -Force -Path $out,$classes,$dex | Out-Null
$res=Join-Path $out 'resources.zip'
$unsigned=Join-Path $out 'unsigned.apk'
$aligned=Join-Path $out 'aligned.apk'
$apk=Join-Path $out $(if($DebugBuild){'StarTimetable-1.1.0-debug.apk'}else{'StarTimetable-1.1.0.apk'})
Run (Join-Path $BuildTools 'aapt2.exe') @('compile','--dir',(Join-Path $source 'res'),'-o',$res)
$linkArgs=@('link','-o',$unsigned,'-I',$Platform,'--manifest',(Join-Path $source 'AndroidManifest.xml'),'-A',(Join-Path $source 'assets'),'--auto-add-overlay',$res)
if($DebugBuild){$linkArgs+='--debug-mode'}
Run (Join-Path $BuildTools 'aapt2.exe') $linkArgs
$javaFiles=@(Get-ChildItem (Join-Path $source 'java') -Recurse -Filter '*.java' | ForEach-Object FullName)
Run (Join-Path $JavaHome 'bin\javac.exe') (@('-encoding','UTF-8','--release','8','-classpath',$Platform,'-d',$classes)+$javaFiles)
$classesJar=Join-Path $out 'classes.jar'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if(Test-Path -LiteralPath $classesJar){Remove-Item -LiteralPath $classesJar}
[IO.Compression.ZipFile]::CreateFromDirectory($classes,$classesJar)
Run (Join-Path $BuildTools 'd8.bat') @('--lib',$Platform,'--min-api','23','--output',$dex,$classesJar)
$archive=[IO.Compression.ZipFile]::Open($unsigned,[IO.Compression.ZipArchiveMode]::Update)
try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $dex 'classes.dex'),'classes.dex') | Out-Null } finally { $archive.Dispose() }
Run (Join-Path $BuildTools 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
$signing=Join-Path $PSScriptRoot 'signing'
$key=Join-Path $signing 'star-timetable.jks'
New-Item -ItemType Directory -Force -Path $signing | Out-Null
if (!(Test-Path $key)) {
    Run (Join-Path $JavaHome 'bin\keytool.exe') @('-genkeypair','-keystore',$key,'-storepass','android','-keypass','android','-alias','star-timetable','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Star Timetable Personal, OU=Personal, O=Star Timetable, C=CN')
}
Run (Join-Path $BuildTools 'apksigner.bat') @('sign','--ks',$key,'--ks-key-alias','star-timetable','--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,$aligned)
Run (Join-Path $BuildTools 'apksigner.bat') @('verify','--verbose',$apk)
Run (Join-Path $BuildTools 'zipalign.exe') @('-c','-v','4',$apk)
Write-Host "APK ready: $apk"
