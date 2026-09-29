# ZQ-Proxy

一个跑在 Cloudflare Workers 上的代理服务，单文件 `worker.js`，不需要构建：

- **GitHub 反代** —— 把 `github.com` 及它的各个子域整体搬到自己的域名下，页面里的链接自动改写
- **GitHub 文件加速** —— `https://本站域名/密码/github.com/文件路径`，链接可以直接发给别人
- **Docker 镜像加速** —— `docker pull 本站域名/密码/镜像[:标签]`，控制台里查到真实 tag 再复制命令
- **单页控制台** —— 站点分组（白名单）管理 + 关联域名自动扫描 + Docker 镜像查询

所有对外请求都由一个密码把关：密码既是界面入口，也是加速链接里的那一段路径。

---

## 一、部署

### 1. 建 KV 命名空间

Cloudflare 面板 → **Workers & Pages → KV** → 创建命名空间（名字随意）。

绑定时**变量名必须填 `Proxy`** —— 代码里 `KV_BINDING_NAME = 'Proxy'` 是写死的，名字不对等于没有 KV，
界面在保存站点或设置密码时会在报错里提示这一点。

KV 里会存两个键：

| Key | 内容 |
| --- | --- |
| `admin_password` | 访问密码（明文，Workers 除 KV 外没有密钥存储） |
| `site_groups` | 站点分组白名单，形如 `[{"name":"GitHub","domains":["github.com",...]}]` |

### 2. 部署 Worker

面板 → Workers → 创建 Worker → 把 `worker.js` 全部粘进编辑器 → 保存并部署。

### 3. 绑定 KV

Worker → 设置 → 绑定 → 添加 KV 命名空间，**变量名 `Proxy`**，选第 1 步建的那个。

### 4. DNS

给 `*.你的域名` 加一条 A 记录（IP 随便填，比如 `192.0.2.1`）并**打开小云朵代理**。
不打算用泛域名的话，至少要有 `proxy.你的域名` 与 `*.proxy.你的域名`。

### 5. 路由

Worker → 设置 → 触发器 → 路由，加上：

| 路由 | 作用 |
| --- | --- |
| `proxy.你的域名/*` | 控制台界面与它的接口 |
| `*-proxy.你的域名/*` | GitHub 各子域的反代入口 |

嫌麻烦就只加一条 `*.你的域名/*` 覆盖上述两者。

### 6. 首次访问

打开 `https://proxy.你的域名/`：

- KV 里没有密码 → 显示**设置密码**页（至少 6 位），设完自动带密码跳进控制台
- 有密码 → 显示**登录**页，输入后进控制台

---

## 二、控制台

访问 `https://proxy.你的域名/`，一页四个区块（`/admin` 是等价入口，旧书签仍可用）：

### GitHub 文件加速

一个输入框，把 GitHub 的路径整段粘进去即可（完整链接也行，会自动去掉 `https://`）——
密码自动用当前登录的那个，不用再填。生成形如下面的链接，可直接复制或打开：

```
https://proxy.你的域名/密码/github.com/用户名/仓库/releases/download/v1.0.0/file.zip
```

### Docker 镜像查询

输入镜像名 → 直接去镜像仓库取**真实 tag 列表**，选好 tag 后复制 `docker pull` 命令。

- 官方镜像写名字即可：`nginx`
- 组织镜像必须写全：`openlistteam/openlist`
- 其他仓库带主机名：`ghcr.io/用户名/镜像`

查询只认**完整仓库名**，没有关键词模糊搜索。曾经做过一条（Docker Hub 的 `search/v4` 端点 + 自填凭据），
2026-09-29 整条删掉了：那个搜索接口按出口 IP 做 abuse 限流，而 Worker 的出口 IP 是共享的，
连拿凭据换 token 的那一步（`POST hub.docker.com/v2/auth/token`）都直接 429 ——
请求在「你的账号是谁」被判定之前就被挡掉，凭据填了也救不回来，属于「点了必然报错」的功能。

要模糊搜就去 hub.docker.com 网站自己搜，拿到 `组织/镜像` 再回这里查 tag。

### 添加站点

填「名称」+「入口域名」→ 点**查找关联域名** → 勾选要放行的域名 → **添加勾选的域名**。

关联域名的来源：抓该站首页 HTML + `Content-Security-Policy` 响应头 + 最多 6 个同站 JS/CSS，从中提取域名。

入口域名与它的注册域名永远排在结果前两位；扫描失败也会把它们列出来，能加的先加。
**只在用户操作时才请求的接口域名扫不到**（比如点击登录才连的第三方服务），需要手动补。

### 站点分组

每个分组一个折叠栏（默认折叠），展开后可以删单个域名，或删掉整个分组。

KV 里没有 `site_groups` 就是**空白名单**，代码不带任何内置域名 —— 代理谁由你自己加。

---

## 三、用法

### GitHub 文件加速

在原始链接前面加上 `本站域名/密码/`：

```
原始：https://github.com/用户名/仓库/releases/download/v1.0.0/file.zip
加速：https://proxy.你的域名/密码/github.com/用户名/仓库/releases/download/v1.0.0/file.zip
```

### Docker 镜像

```bash
# Docker Hub 官方镜像（不加主机名）
docker pull proxy.你的域名/密码/nginx:latest

# 其他仓库（必须带主机名，否则 docker 会跑去 Hub 找一个不存在的名字）
docker pull proxy.你的域名/密码/ghcr.io/用户名/镜像:标签
```

### GitHub 站点反代

代理主机名 = 原域名**点换成横线** + `-proxy.` + 你的域名后缀：

```
github.com        →  github-com-proxy.你的域名
api.github.com    →  api-github-com-proxy.你的域名
raw.githubusercontent.com → raw-githubusercontent-com-proxy.你的域名
```

响应正文里的域名引用会被自动改写成对应的代理域名，所以页面里的相对链接、头像、静态资源都能正常加载。

### 密码

一个密码同时管两件事：进控制台（`?pwd=`）和所有加速链接（路径第一段）。
所以**拿得到链接 = 被允许用这个代理**。路径第一段对不上会返回 401
（Docker 客户端收到的是纯文本 `unauthorized`）。

密码在页面与链接中都以 `encodeURIComponent` 编码后传递，所以密码里带 `/` 之类的字符也不会截断路径。

---

## 四、代码里的开关

| 常量 | 位置 | 默认 | 说明 |
| --- | --- | --- | --- |
| `KV_BINDING_NAME` | 顶部 | `'Proxy'` | KV 绑定变量名，改了记得同步面板里的绑定名 |
| `RESTRICT_PATHS` | 顶部 | `false` | 是否限制 GitHub / Docker 的请求路径 |
| `ALLOWED_PATHS` | 顶部 | `['library', ...]` | `RESTRICT_PATHS` 打开时生效的路径关键字 |
| `DOCKER_BLOB_DIRECT` | 顶部 | `false` | 镜像层是否改成 302 直连源站 CDN。打开能大幅降低 Worker 请求数，**前提是客户端能直连该 CDN** —— 打开前先本机 `docker pull` 验一次 |
| `TRACE_HOSTS` | 顶部 | gist 相关 3 个 | 只给这几个目标打一行来源指纹，排查用，用完可整块删 |
| `STATIC_CACHE` 等 | 顶部 | 见注释 | 按内容类型分级设置的浏览器缓存策略 |

代码里没有任何内置域名清单，关联域名一律靠扫描现取。

---

## 五、限制

- 不支持 GitHub 的登录 / 注册（相关路径会被重定向出去）
- 部分依赖 WebSocket 或特殊认证的 GitHub 功能不可用
- Docker Hub 没有关键词模糊搜索（上游按共享出口 IP 限流，做不了），只能按完整仓库名查 tag
- 关联域名扫描只覆盖首页 HTML + CSP 头 + 同站脚本，动态请求的接口域名抓不到
- 白名单为空时，`*-proxy.` 主机不会代理任何站点

---

## 六、排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 保存站点或设密码时提示 KV 未绑定 | 绑定变量名不是 `Proxy`，或没绑定 |
| 加速链接返回 401 | 链接第一段不是密码，或密码被 URL 编码后不一致 |
| `docker pull` 报 `unauthorized` | 同上，密码段漏了或写错 |
| 打开页面版式简陋、无样式 | 页面样式走 Tailwind CDN，网络不通时退化，功能不受影响 |
| 镜像查询说「没找到」 | 名字不完整。组织镜像必须写成 `组织/镜像`（如 `openlistteam/openlist`），只有官方镜像可以只写名字 |
| 某个域名没被放行 | 它在 KV 的 `site_groups` 里吗？新加的域名有 60 秒内存缓存 |

---

## 免责声明

本项目仅用于学习与研究。使用者需自行确保遵守 GitHub、Docker 的服务条款以及所在地法律法规。
