# 两项目网络隔离与告警核对

2026-10-20 修复。Star Orbit 与 Fuguang 仍在同一台主机，共享 443 TLS 入口；后端服务、数据卷和内部网络分别维护。主机资源和共同入口仍是共享基础设施，本次不是两台独立主机的故障隔离。

## 原因与修复

两个 Compose 项目都将后端服务命名为 `api`。原 443 代理同时连接 `xingke-v2_default` 与 `fuguang_default`，使 `api` 被解析到 Fuguang；Star Orbit 的 `/api/v1/me/data` 因此返回 404。

- `starorbit_ingress`：Star Orbit API、Star Orbit 8443 后台代理、共同 443 代理。API 独有别名 `starorbit-backend`。
- `fuguang_ingress`：Fuguang API、共同 443 代理。API 独有别名 `fuguang-backend`。
- Star Orbit 数据库仅位于 `xingke-v2_default`；Fuguang 保留独立数据卷和 `fuguang_default`。
- 共同代理不再接入两个项目的 default 私有网络。代理使用明确别名及 Docker DNS 动态解析，不依赖通用名称 `api` 或固定容器 IP。
- 代理健康检查改用实际监听的 HTTPS 8443 `/healthz`。
- `/opt/xingke-v2` 与其 `backend` 目录由全员可写收紧为 root 所有的 0755；没有执行全盘或数据卷权限重写。

## 已验证

App 入口 `/api/v1/health` 返回 200；无登录凭证请求 `/api/v1/me/data` 返回预期 401，而非错误的 404。后台 HTTPS 返回 200，Fuguang 域名 `/healthz` 返回 200 且服务标识为 fuguang。两个后端不能解析对方独有别名，两个方向直接连接对方入口 IP:8000 均超时。两个代理健康检查均正常。没有修改用户数据、钱包或数据库内容。

## 持久化与运维

Star Orbit 的网络声明保存在 `compose.v2.yaml`、`compose.v2.ip-test.yaml`、`compose.v2.public-tls.yaml`；完整部署仍使用原有五个 Compose 文件。入口网络是外部网络，首次迁移已创建，后续不要随单个项目删除。

Fuguang 的现网 Compose 和 nginx 修改归档于 `ops/isolation/`；对应现网文件分别为 `/opt/fuguang/compose.yaml`、`/opt/fuguang/deploy/https.nginx.conf`。旧 `/opt/fuguang/deploy/edge.override.yaml` 已改为空兼容覆盖，不再连接 Fuguang 的 default 网络。共同入口挂载已纳入 Star Orbit 的入口 Compose 文件，避免重建时丢失域名路由。

迁移时两个后端未重启，通过 `docker network connect --alias` 接入各自入口网络；后续后端重建由 Compose 声明恢复同样的网络与别名。单个后端发布只重建本项目服务，共同入口仅在路由、证书或入口配置变更时维护。

本次原配置备份：服务器 `/opt/starorbit-ops-backups/isolation-20261020/`，root 0700。若需要回滚，先恢复其中各项目配置，再将代理接回原网络后重建入口；原配置包含本次导致串线的通用 api 名称，不建议直接回滚为长期方案。

## 云安全中心事件

用户提供事件 781591422：2026-10-20 09:10:34 执行，09:11:26 通知，规则备注 `wget_curl`、名称“蠕虫病毒命令”。记录中完整命令与本次 SSH 诊断操作逐字对应：检查容器 DNS、请求两个本机容器健康接口、读取 Docker 网络信息及请求 App 的鉴权接口。没有下载并执行脚本。这一条事件可判定为已知运维命令误报，可在控制台按误报处理，保留安全代理与规则开启。

有限主机排查未见明显异常高占用进程、临时目录可执行载荷或新增可疑 cron 项；这不等于完成全盘取证，也不代表其他独立告警均为误报。本次未关闭云安全中心、未添加宽泛命令白名单，未代用户更改控制台告警状态。
