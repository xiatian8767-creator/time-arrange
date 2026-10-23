# HTTPS 与证书续期

- App 的443接口使用随包信任的私有CA。不要直接更换根CA或跳过校验，否则现有安装包可能失去连接。
- 8443管理后台使用公开可信IP证书。此证书有效期短，通过持续自动续期维持服务，不依赖手工延长单张证书。
- 不在文档维护固定到期日期；每次诊断读取实际服务证书及有效期，避免旧记录误导。

## 自动续期

star-orbit-certificate.timer 定时触发 star-orbit-certificate.service，通过 shell 执行 /usr/local/sbin/star-orbit-renew-certificate。运行脚本独立于应用目录，root持有、0755；仓库源文件为 backend/renew-public-ip.sh，部署时以LF换行安装。

证书私钥保留在服务器 /etc/letsencrypt；HTTP80的挑战目录为 /opt/xingke-acme/webroot。官网更新必须保留其挂载。续签后校验并平滑重载相应Nginx；不要重启无关后端。

```sh
systemctl list-timers star-orbit-certificate.timer
journalctl -u star-orbit-certificate.service
sh /usr/local/sbin/star-orbit-renew-certificate --dry-run
```

排查时同时检查定时器、服务执行权限、ACME目录、端口和Nginx实际挂载；不得通过关闭HTTPS验证掩盖证书问题。私有CA、服务端私钥及公开证书的用途不同，备份与更换应分别处理。
