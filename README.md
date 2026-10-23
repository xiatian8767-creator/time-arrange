# Star Orbit

课表、搭子、待办与星小助。Android 客户端使用原生桥接与 WebView，服务端使用 FastAPI、PostgreSQL 和 Nginx。

## 当前版本

- 稳定版：3.3beta.4。
- 探索版：3.4beta.2（versionCode 29）。
- [官网](http://startimetable.xyz/) · [GitHub Releases](https://github.com/xiatian8767-creator/time-arrange/releases)
- 历史版本、更新记录和安装包以 Git 历史、GitHub Releases 为准，不在仓库重复维护逐版本文档或源码压缩包。

## 从哪里开始

- [开发者说明](开发者说明文档.md)：源码入口、构建与测试。
- [部署与隔离](docs/deployment.md)：服务、网络和安全边界。
- [证书续期](docs/tls-renewal.md)：HTTPS 维护。
- [星小助](docs/assistant-billing.md)：API 池、上下文、星币计费。
- [用户反馈](docs/feedback.md)：反馈入口与处理。
- [发布规则](docs/发布规则.md)：稳定版与探索版递进规则。

## 构建

需要 JDK 17+、Android SDK Platform 35、Build Tools 35.0.0；使用 PowerShell 运行：

```powershell
./build.ps1 -JavaHome "<JDK路径>" -AndroidSdk "<SDK路径>" -OutputDirectory "test/build"
```

SDK 目录布局不标准时，额外指定 `-BuildTools` 和 `-Platform`。当前本地工具链在 `test/toolchain/`，勿随构建缓存一起删除。签名位于 `signing/`，不要上传或重新生成已有发布签名。

## 目录约定

`app/` 客户端，`backend/` 服务端与后台，`web/download/` 官网，`qa/` 回归脚本，`ops/` 运维配置。

`test/` 放构建和验证中间产物，`dist/` 只保留当前稳定版与探索版的最终安装包；两者均不进入 Git。工具链、测试依赖、签名、软著材料和原始设计附件不作为普通历史缓存清理。
