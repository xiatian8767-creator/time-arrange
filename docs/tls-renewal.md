# IP HTTPS 与证书续期

更新日期：2026-10-09。

- 原 App 接口 `https://8.154.43.154` 保留私人 CA。现有客户端只信任这一 CA，直接更换 443 的证书会破坏已安装版本的联网。
- 私人 CA 有效至北京时间 2027-10-02 22:33:56；原根证书不变。测试服务端证书已重新签发 90 天，有效至北京时间 2027-01-07 08:29:55。
- 公开可信管理后台部署在 `https://8.154.43.154:8443/admin/`。服务器本地使用系统默认信任验证返回 200，但外网端口仍超时，需要在阿里云安全组放行 TCP 8443 入站。
- Let’s Encrypt 正式 IP 证书首次有效至北京时间 2026-10-15 23:31:51。IP 证书固定约 6 天，不能延长成单张 30 天证书；通过持续自动续期维持服务。

## 自动续期

`star-orbit-certificate.timer` 每天 00:00 和 12:00（服务器时区）检查，附加最多 30 分钟随机延迟，开机补执行。`star-orbit-certificate.service` 通过 `/bin/sh` 调用 `/usr/local/sbin/star-orbit-renew-certificate`；证书更新后检查并重新加载管理后台 Nginx。证书与私钥目录 `/etc/letsencrypt`，只有公开证书可以下载，私钥留在服务器。

2026-10-19 修复：原脚本在应用目录内被部署覆盖后丢失执行权限，导致自动续期报 `203/EXEC`，公开证书到期。运行脚本现安装到独立的 `/usr/local/sbin/`，由 root 持有、权限 0755；服务显式调用 shell，避免依赖上传文件的执行位。定时器已有随机延迟，因此 Certbot 禁用额外随机等待，确保在服务 300 秒超时内完成。更新续期逻辑时，将本仓库 `backend/renew-public-ip.sh` 以 LF 换行安装到该独立路径；普通 App/后台部署无需覆盖它。

当次正式续签成功，Nginx 已重新加载，新证书有效至北京时间 2026-10-26 12:40:46。外网和服务器本机均使用默认信任验证后台 HTTPS 返回 200；定时器保持启用。

HTTP 80 的 `/.well-known/acme-challenge/` 目录为 `/opt/xingke-acme/webroot`。下载站 compose 已保留目录挂载，后续更新站点必须保留挂载。现有下载内容正常。

检查命令：`systemctl list-timers star-orbit-certificate.timer`，`journalctl -u star-orbit-certificate.service`。

手动演练：`sh /usr/local/sbin/star-orbit-renew-certificate --dry-run`。

官方说明：https://letsencrypt.org/2026/03/11/shorter-certs-certbot
