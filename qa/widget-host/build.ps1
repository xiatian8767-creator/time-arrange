param([string]$AppBuild='test/build-34beta3-debug')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$tools=Join-Path $root 'test/toolchain/sdk/android-15';$platform=Join-Path $root 'test/toolchain/sdk/android-35/android.jar';$jdk='C:/Program Files/Java/jdk-26.0.2.1';$env:JAVA_HOME=$jdk
$out=Join-Path $root 'test/widget-host';New-Item -ItemType Directory -Force -Path $out,(Join-Path $out 'classes'),(Join-Path $out 'dex') | Out-Null
function Run($tool,$params){& $tool @params;if($LASTEXITCODE -ne 0){throw "Failed: $tool"}}
Run (Join-Path $tools 'aapt2.exe') @('link','-o',"$out/unsigned.apk",'-I',$platform,'--manifest',"$PSScriptRoot/AndroidManifest.xml",'--debug-mode')
Run "$jdk/bin/javac.exe" @('-encoding','UTF-8','--release','8','-classpath',($platform+';'+(Join-Path $root "$AppBuild/classes.jar")),'-d',"$out/classes","$PSScriptRoot/WidgetHostActivity.java","$PSScriptRoot/WidgetChecks.java")
Add-Type -AssemblyName System.IO.Compression.FileSystem
if(Test-Path "$out/classes.jar"){Remove-Item -LiteralPath "$out/classes.jar"};[IO.Compression.ZipFile]::CreateFromDirectory("$out/classes","$out/classes.jar")
Run "$tools/d8.bat" @('--lib',$platform,'--min-api','23','--output',"$out/dex","$out/classes.jar")
$archive=[IO.Compression.ZipFile]::Open("$out/unsigned.apk",[IO.Compression.ZipArchiveMode]::Update);try{[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,"$out/dex/classes.dex",'classes.dex')|Out-Null}finally{$archive.Dispose()}
Run "$tools/zipalign.exe" @('-f','4',"$out/unsigned.apk","$out/aligned.apk")
Run "$tools/apksigner.bat" @('sign','--ks',"$root/signing/star-timetable.jks",'--ks-key-alias','star-timetable','--ks-pass','pass:android','--key-pass','pass:android','--out',"$out/widget-host.apk","$out/aligned.apk")
Write-Output "QA host only: $out/widget-host.apk"
