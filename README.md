# ZQ-Proxy GitHub代理服务与加速下载工具

## 项目概述

这是一个基于Cloudflare Workers的多功能服务，集成了GitHub代理和加速下载功能，解决某些网络环境下GitHub访问受限的问题，同时提供GitHub文件和Docker镜像的加速下载服务。

## 特性

### GitHub代理功能
- **子域名匹配系统**：使用 `-proxy.` 后缀作为GitHub主站的代理入口，支持任何域名后缀
- **完整的资源映射**：支持GitHub相关的所有主要域名，包括API、静态资源、用户内容等
- **内容替换**：自动替换响应中的所有域名引用，确保链接正常工作
- **路径修复**：解决嵌套URL路径问题，特别针对仓库提交信息等特殊路径
- **安全重定向**：对敏感路径（如登录页面）进行安全重定向
- **HTTPS强制**：自动将HTTP请求升级为HTTPS

### 加速下载功能
- **GitHub文件加速**：通过代理服务器加速GitHub文件下载，提高下载速度
- **Docker镜像加速**：加速Docker镜像拉取，解决大陆拉取第三方Docker镜像层失败的问题
- **响应式网页界面**：提供直观的网页界面，支持浅色/深色模式切换
- **自动处理重定向**：自动递归处理所有302/307跳转，无论跳转到哪个域名，都由Worker继续反代
- **AWS S3支持**：自动补全x-amz-content-sha256和x-amz-date头，确保S3请求成功

## 支持的域名映射

### GitHub代理域名

服务支持以下GitHub相关域名的代理访问：

- github.com → github-com-proxy.[您的域名]
- avatars.githubusercontent.com → avatars-githubusercontent-com-proxy.[您的域名]
- github.githubassets.com → github-githubassets-com-proxy.[您的域名]
- api.github.com → api-github-com-proxy.[您的域名]
- raw.githubusercontent.com → raw-githubusercontent-com-proxy.[您的域名]
- 以及更多GitHub相关服务域名

### 加速下载域名

- 根域名：[您的域名] → 加速工具网页界面

## 部署指南

### 前提条件

- Cloudflare账户
- 已配置的域名（托管在Cloudflare上）
- 基本的DNS配置知识

### 部署步骤

1. **登录Cloudflare控制台**
   - 进入Workers部分

2. **创建新的Worker**
   - 点击"创建Worker"
   - 将提供的代码粘贴到代码编辑器中
   - 给Worker命名并保存

3. **配置DNS记录**
   - 为您的泛域名添加任何命中CDN的记录
   - 例如 `*.您的域名` A记录指向任何IP并开启代理

4. **配置Worker路由和域名**
   - 添加路由 `*-proxy.您的域名/*` 指向您的Worker
   - 添加域名指向您的Worker（用于加速工具界面）

## 使用方法

### 1. 访问GitHub网站

部署成功后，只需将原始GitHub URL中的域名部分替换为对应的代理域名：

```
# 原始URL
https://github.com/用户名/仓库名

# 代理URL
https://github-com-proxy.您的域名/用户名/仓库名
```

其他GitHub资源的访问方式类似，系统会自动处理域名映射和内容替换。

### 2. 使用GitHub文件加速

#### 方法一：使用网页界面
1. 访问 `https://您的域名/`
2. 在"GitHub文件加速"部分输入GitHub文件链接
3. 点击"获取加速链接"
4. 复制生成的加速链接并使用

#### 方法二：直接构造加速链接
在GitHub文件链接前加上您的域名：

```
# 原始GitHub文件链接
https://github.com/用户名/仓库名/releases/download/v1.0.0/file.zip

# 加速链接
https://您的域名/https://github.com/用户名/仓库名/releases/download/v1.0.0/file.zip
```

### 3. 使用Docker镜像加速

#### 使用网页界面
1. 访问 `https://您的域名/`
2. 在"Docker镜像加速"部分输入镜像地址（如 `hello-world` 或 `ghcr.io/user/repo`）
3. 点击"获取加速命令"
4. 复制生成的加速命令并在终端执行

例如，生成的加速命令可能如下：
```bash
docker pull 您的域名/hello-world
```

## 技术说明

### GitHub代理工作原理

1. 接收对代理域名的请求
2. 识别目标GitHub域名
3. 转发请求到GitHub服务器
4. 接收GitHub的响应
5. 替换响应内容中的域名引用
6. 返回修改后的响应给用户

### 加速下载工作原理

1. 接收对加速路径的请求
2. 解析目标URL或镜像地址
3. 构建目标请求
4. 发送请求到目标服务器
5. 处理认证挑战（对于Docker镜像）
6. 处理重定向（特别是S3重定向）
7. 返回响应给用户

### 特殊路径处理

代码包含专门的逻辑来处理特殊路径，特别是用于仓库提交信息的路径，解决了嵌套URL问题：

```
/用户名/仓库名/latest-commit/分支名/https://gh.域名/...
```

这类路径会被正确截断并转发到GitHub。

## 安全考虑

- 代理服务不存储或处理用户凭据
- 敏感路径（如登录页面）会被重定向到其他网站
- 所有流量都通过HTTPS加密
- 域名白名单限制，只允许指定的域名通过代理访问

## 限制

- 不支持GitHub的登录和注册功能
- 某些高级GitHub功能可能不完全兼容
- 不能代替GitHub CLI或Git等工具的直接连接
- Docker镜像加速仅支持白名单中的镜像仓库

## 故障排除

如果遇到问题：

1. 确认DNS记录配置正确
2. 检查Worker是否正常运行
3. 尝试清除浏览器缓存
4. 检查请求和响应日志以获取详细错误信息
5. 确认目标域名在白名单中

## 贡献指南

欢迎提交Pull Request或Issue来改进此项目。特别欢迎以下方面的贡献：

- 增加对更多GitHub相关域名的支持
- 改进内容替换逻辑
- 增强错误处理机制
- 添加性能优化
- 扩展加速下载支持的服务范围

## 免责声明

此代理服务仅用于教育和研究目的。使用者应确保遵守GitHub的服务条款、Docker的服务条款和当地法律法规。
