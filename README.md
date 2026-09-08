# 星课表

轻量离线安卓课表。已根据用户提供的图片初始化课程；浅蓝背景、蓝色 904、粉色 905，金色五角星表示当前星期及时间。

## 安装与使用

将 `StarTimetable-1.0.0.apk` 发送到安卓手机，用手机文件管理器打开并安装。系统如有提示，请允许当前文件管理器安装此应用。本应用不需要账号或网络权限。

- 点课程卡片：编辑名称、星期、起止节次、地点、备注和颜色，或删除课程。
- 点课表空白格或底部“添加课程”：添加每周重复的课程。
- 点底部“作息时间”：自定义每节起止时间，增加或删除节次，最多 24 节。已有课程占用的节次需要先移除课程才能删除。
- 点“今天”：返回本周并滚动至当前时间。五角星每 15 秒刷新，也会在返回应用时刷新；课间按间隔比例定位，课前/课后位于课表边界。查看其他周时隐藏时间标记。
- 右上角设置：导出和导入 JSON 备份，或恢复图片中的初始课表。导入和恢复前会显示确认提示。
- 所有编辑保存在手机本机。卸载会删除数据，请先导出备份；覆盖安装同一签名的新版可保留数据。

系统最低安装版本为 Android 6.0（API 23），界面使用系统 WebView，需支持现代 JavaScript（建议 WebView 80 或更新版本）。实际安装测试的系统版本及结果见 `docs/验证记录.md`，未做全部品牌真机兼容测试。

## 图片初始化内容

图片提供的是 904 / 905 标签，因此保留原标签，没有猜测实际课程名、老师或地点。共 14 个课程块（18 个有课节次），每周重复，不设置未知的学期日期。

| 星期 | 904（蓝色） | 905（粉色） |
| --- | --- | --- |
| 一 | 第 4 节 | 第 8 节 |
| 二 | 第 3、8 节 | 第 6 节 |
| 三 | 第 1 节 | 第 2、5 节 |
| 四 | 第 6 节 | 第 2–3、9–10 节 |
| 五 | 第 4–5、9–10 节 | 第 1 节 |
| 六、日 | 无 | 无 |

| 节次 | 时间 | 节次 | 时间 |
| --- | --- | --- | --- |
| 1 | 08:00–08:40 | 7 | 14:50–15:30 |
| 2 | 08:50–09:30 | 8 | 16:00–16:40 |
| 3 | 10:10–10:50 | 9 | 16:50–17:35 |
| 4 | 11:00–11:40 | 10 | 17:45–18:30 |
| 5 | 11:50–12:20 | 11 | 20:30–21:20 |
| 6 | 14:00–14:40 | | |

图片底部第 12、13 节被广告和导航遮挡，时间不完整，未猜填。可在“作息时间”自行增加。

## 源代码

```text
app/src/main/
  AndroidManifest.xml                 应用信息，无任何网络权限
  java/cn/xingke/timetable/MainActivity.java
                                      安卓容器、本地存储、系统文件备份
  assets/index.html                   页面结构
  assets/style.css                    手机布局与视觉样式
  assets/core.js                      初始课程、时间算法、数据校验
  assets/app.js                       编辑、周切换、实时状态与备份交互
  res/                               启动图标与安卓主题
build.ps1                            Windows 一键构建、签名、校验
tests/core.test.js                    时间与课程逻辑测试
signing/star-timetable.jks            仅保存在本机的个人签名文件
docs/验证记录.md                      安卓与浏览器验证记录
开发者说明文档.md                     架构、运行流程与维护说明
test/                                 Codex 临时验证文件（不进入源码包）
```

页面资源全部打包在 APK 内。安卓通过 `shouldInterceptRequest` 将专用本地域名映射至内置资源；任何其他资源返回空内容。清单未声明 `INTERNET` 权限，WebView 网络加载关闭；无需服务器、CDN、远程字体或第三方服务。安卓使用 SharedPreferences 保存数据，备份通过系统文件选择器读写，不申请全部文件访问权限。正常版本关闭 WebView 调试。

## 重新构建 APK（Windows）

构建工具准备：JDK 17 或更高版本，以及 Android SDK 的 Platform 35 和 Build Tools 35.0.0。第一次下载这些开发工具需要联网；工具准备好后构建可离线完成。运行应用始终无需联网。

官方工具：[Android SDK 下载](https://developer.android.com/studio#command-line-tools-only)、[sdkmanager 使用方法](https://developer.android.com/tools/sdkmanager)、[Eclipse Temurin JDK](https://adoptium.net/temurin/releases/)。

在源码根目录的 PowerShell 中执行（将路径换成自己的安装位置）：

```powershell
.\build.ps1 -JavaHome 'C:\path\to\jdk-17' -AndroidSdk 'C:\path\to\Android\Sdk'
```

如自行解压 SDK 压缩包，也可直接指定工具位置：

```powershell
.\build.ps1 -JavaHome 'C:\path\to\jdk-17' `
  -BuildTools 'C:\path\to\build-tools\35.0.0' `
  -Platform 'C:\path\to\platforms\android-35\android.jar'
```

默认输出为 `test/build/StarTimetable-1.0.0.apk`，避免构建中间物散落在项目根目录。正式发布时可传入 `-OutputDirectory dist`。脚本完成资源编译、Java 编译、DEX 转换、对齐、签名及签名检查。无需 Gradle、Node 或 npm 参与安卓打包。系统 PowerShell 5.1 和 PowerShell 7 均可运行脚本。

本机项目的 `signing/star-timetable.jks` 是本次 APK 的个人签名文件。出于安全考虑，面向交付的源码 ZIP 不包含该私钥。需要继续覆盖安装当前 APK 时，请在本机安全保留 `signing` 目录；如果从源码 ZIP 单独构建，脚本会生成一份新密钥，新签名的 APK 不能覆盖已安装的旧签名版本。计划公开代码或发布应用商店版本时，应使用单独、受保护的正式签名配置。

可用 Node.js 18+ 执行逻辑测试（不影响打包）：

```powershell
node --test tests/core.test.js
```

## 数据说明

备份格式版本为 1，包含 `slots`（时间节次）和 `courses`（课程）。每门课程通过起止节次 ID 关联时间，修改时间会同步影响课程定位。导入前校验时间顺序、课程引用、节次冲突和字段长度；超过 1 MB 的备份不会导入。课程名称、地点及备注按文本渲染。

当前范围为每周重复课表，不包含提醒通知、单双周、节假日调整或云同步。
