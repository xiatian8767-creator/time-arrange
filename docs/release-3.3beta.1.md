# Star Orbit 3.3beta.1 · 探索版

## 用户更新

- 自定义头像，默认继续使用星小助；课表顶部显示头像、星币余额与兑换入口。
- 给在线搭子发送图片与文字弹窗：可设置背景色、文字颜色、发送时间，复用最近的留言；每次消耗 1 星币。
- 给搭子赠送星币并附留言，余额与交易记录可查看。
- 兑换码领取星币，重复兑换会提示，不会重复到账。

## 运营更新

- 用户列表新增独立详情页：搭子、余额、最近上报的 App 版本、交易记录、云端备份导出。
- 后台赠送星币，可附图片＋文字到账弹窗并设置展示时间。星币立即到账，弹窗按所设时间展示。
- 星币兑换码批量生成、一次性/每用户限一次的可复用码、启停与兑换人数统计。
- 弹窗新增每次打开 App 的频率，Reset 重置展示记录；不自动启用已停用任务。

## 版本与投放

- 稳定版保留 3.2beta.6 原安装包；探索版为 3.3beta.1（versionCode 24，原签名覆盖更新）。
- 更新说明继续使用原地址：`https://8.154.43.154:8443/updates/3.2beta.6/`，仅介绍用户功能，并链接新包。
- 不代替管理员配置或启用弹窗任务。
- 老用户默认 0 星币，不自动发币，不改变原课表与待办。
- 本次不包含 AI 星币对话或商城。

## 数据与接口

新增独立表：star_profiles、star_wallets、star_transactions、star_operations、star_codes、star_redemptions、star_messages、campaign_resets。旧用户表和文档结构保持不变。

客户端：`GET /api/v1/stars`、`POST /stars/profile`、`GET /stars/transactions`、`POST /stars/gift`、`POST /stars/send`、`GET /stars/templates`、`POST /stars/redeem`（后六项均有 `/api/v1` 前缀）。

后台：`GET /admin/api/users/{id}/detail`、`GET /admin/api/users/{id}/backup`、`POST /admin/api/users/{id}/stars`、`GET/POST /admin/api/star-codes`、`POST /admin/api/star-codes/{id}`、`POST /admin/api/campaigns/{id}/reset`。

余额更新和流水在同一事务中；搭子转账按用户 ID 固定顺序加锁，兑换码加行锁；请求 ID 实现幂等，余额不能为负。后台写操作保留管理员鉴权、CSRF 与审计。备份导出只包含原始用户文档，不包含密码、密保答案或访问令牌。

版本信息是最近上报值，不表示离线设备实时状态。定时留言在到达时间后，下次进入 App 时展示，不是系统通知推送。

## 本轮验证（仅新增功能）

- 本地接口：5 组通过，PostgreSQL 专用并发用例在本地 SQLite 环境跳过。
- 独立 PostgreSQL 容器：5 组通过，包含 12 个并发赠送请求竞争 5 枚星币，仅 5 个成功；同一个一次性码被两人同时兑换，仅一人成功。测试容器与生产数据库完全隔离，完成后销毁。
- 浏览器：头像、兑换、搭子留言/赠币、后台详情/赠币/兑换码，320/360/390/430px 布局与脚本异常检查通过。
- APK 编译、原签名验证和 zipalign 通过；当前没有连接安卓设备，未执行真机相册选择测试。
- 线上：新后台页、H5、双版本页面、HTTP/HTTPS 下载均可访问；新旧包远端哈希与本地一致，API 证书与匿名访问限制检查通过。
- 稳定版 SHA-256：`64896ff820264bdd7c0f3a788b6b098ed50ebdd50c8a7a636f7b0640fdea6fc2`。
- 探索版 SHA-256：`d3d5e14c794d1ff1a81bff0300e9643436939fa6e274d64231bd7bc95bd498a6`。
- 发布前服务器已保留数据库、后台与站点备份：`backup-20261015-33b1*`。
