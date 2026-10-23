# 部署与隔离

## 服务和入口

- Star Orbit：服务器目录 /opt/xingke-v2，API 容器 xingke-v2-api-1，数据库 xingke-v2-db-1。
- 官网：http://startimetable.xyz/；服务器目录 /opt/xingke-download，容器 xingke-download。
- App 接口：https://8.154.43.154；管理后台：https://8.154.43.154:8443/admin/。
- 另一项目 Fuguang 位于 /opt/fuguang。两项目共享主机与443入口，不是独立主机故障隔离。

## 必须保留的网络边界

- starorbit_ingress：Star Orbit API、8443后台代理和共同443代理。API 独有别名 starorbit-backend。
- fuguang_ingress：Fuguang API 与共同443代理，独有别名 fuguang-backend。
- Star Orbit 数据库仅在 xingke-v2_default 私有网络；Fuguang 保留自己的数据卷与私有网络。
- 共同代理不能连接两个项目的 default 网络，也不能用通用 api 名称或固定容器IP找后端；使用唯一别名与 Docker DNS 动态解析。
- ops/isolation/ 中是跨项目入口配置参考。维护另一个项目之前应核对它自己的当前配置，不从本项目直接覆盖。
- 外部入口网络不要随单个项目删除；不得用 docker compose down -v 清理生产。

## 发布与备份

构建使用 backend/Dockerfile 和 backend/requirements.txt。当前镜像标签由 compose.beta21.yaml 管理。生产叠加配置包括：

```sh
docker compose -f compose.v2.yaml -f compose.v2.ip-test.yaml -f compose.v2.public-tls.yaml -f compose.ui-refresh.yaml -f compose.beta21.yaml up -d --no-deps --no-build api
```

此命令用于服务器已有部署；compose.ui-refresh.yaml 是服务器保留的环境覆盖文件，不能假定新克隆自带。发布前先检查完整配置、备份数据库和现有配置并构建新镜像。只重建目标服务，不重建另一项目、数据库或共享入口。修改入口配置后先 nginx -t，再平滑重载。

官网单独使用 /opt/xingke-download/compose.web-ui.yaml。保留80端口的 ACME webroot 挂载与反馈转发，不用旧版示例 Compose 覆盖现网。

数据库备份与模型加密主密钥分别安全保存；已有备份统一位于服务器 /opt/starorbit-ops-backups/，不复制进 Git。签名、生产密钥、环境变量及数据库不能作为普通历史文件清理。账号、星币、迁移或回滚测试应使用独立测试库，不改真实用户数据。

## 发布检查

核对 App 健康接口200、无凭证的受保护API返回401而非404、后台和H5可访问、两个APK哈希符合预期。共享入口调整还需检查另一项目健康接口。证书检查见 tls-renewal.md。

云安全告警必须按触发命令和时间核对，不关闭安全代理或添加宽泛白名单；不能把一条已确认的运维误报推广到所有告警。
