# 用户反馈

官网反馈按钮进入 /feedback/，由同源HTTPS表单提交；HTTP官网会跳转到8443的反馈入口。无需登录，问题描述、联系方式必填，最多三张图片。

服务端校验并重新编码图片为JPEG，移除照片元信息；数据与图片保存在 PostgreSQL 的 user_feedback 中，数据库备份包含图片。限制为单张上传180KiB、总请求1MiB。

后台支持筛选、分页、弹窗查看处理、图片预览、备注与删除；状态为待处理、处理中、处理完成。管理接口必须鉴权，写入需CSRF，修改存在并发冲突检测。匿名用户不能查询反馈、联系方式或图片。

主要接口见 backend/feedback.py：公开 POST /feedback/api，后台 /admin/api/feedback。改动后运行 backend/test_feedback.py，必要时验证官网跳转与后台完整处理流程，不在本文件堆积逐次测试报告。
