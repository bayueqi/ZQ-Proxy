// 域名白名单配置（仅保留需要的原生域名）
const domain_whitelist = [
  'github.com',
  'avatars.githubusercontent.com',
  'github.githubassets.com',
  'collector.github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'github.io',
  'assets-cdn.github.com',
  'cdn.jsdelivr.net',
  'securitylab.github.com',
  'www.githubstatus.com',
  'npmjs.com',
  'git-lfs.github.com',
  'githubusercontent.com',
  'github.global.ssl.fastly.net',
  'api.npms.io',
  'github.community'
];

// ALLOWED_HOSTS: 定义允许代理的域名列表（默认白名单）。
const ALLOWED_HOSTS = [
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io',
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com'
];

// RESTRICT_PATHS: 控制是否限制 GitHub 和 Docker 请求的路径。
const RESTRICT_PATHS = false;

// ALLOWED_PATHS: 定义 GitHub 和 Docker 的允许路径关键字。
const ALLOWED_PATHS = [
  'library',   // Docker Hub 官方镜像仓库的命名空间
  'user-id-1',
  'user-id-2',
];

// 闪电 SVG 图标（Base64 编码）
const LIGHTNING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
</svg>`;

// 首页 HTML
const HOMEPAGE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare 加速</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(LIGHTNING_SVG)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Inter', sans-serif;
      transition: background-color 0.3s, color 0.3s;
      padding: 1rem;
    }
    .light-mode {
      background: linear-gradient(to bottom right, #f1f5f9, #e2e8f0);
      color: #111827;
    }
    .dark-mode {
      background: linear-gradient(to bottom right, #1f2937, #374151);
      color: #e5e7eb;
    }
    .container {
      width: 100%;
      max-width: 800px;
      padding: 1.5rem;
      border-radius: 0.75rem;
      border: 1px solid #e5e7eb;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    }
    .light-mode .container {
      background: #ffffff;
    }
    .dark-mode .container {
      background: #1f2937;
    }
    .section-box {
      background: linear-gradient(to bottom, #ffffff, #f3f4f6);
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }
    .dark-mode .section-box {
      background: linear-gradient(to bottom, #374151, #1f2937);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    .theme-toggle {
      position: fixed;
      top: 0.5rem;
      right: 0.5rem;
      padding: 0.5rem;
      font-size: 1.2rem;
    }
    .toast {
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      background: #10b981;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      opacity: 0;
      transition: opacity 0.3s;
      font-size: 0.9rem;
      max-width: 90%;
      text-align: center;
    }
    .toast.show {
      opacity: 1;
    }
    .result-text {
      word-break: break-all;
      overflow-wrap: break-word;
      font-size: 0.95rem;
      max-width: 100%;
      padding: 0.5rem;
      border-radius: 0.25rem;
      background: #f3f4f6;
    }
    .dark-mode .result-text {
      background: #2d3748;
    }

    input[type="text"] {
      background-color: white !important;
      color: #111827 !important;
    }
    .dark-mode input[type="text"] {
      background-color: #374151 !important;
      color: #e5e7eb !important;
    }

    @media (max-width: 640px) {
      .container {
        padding: 1rem;
      }
      .section-box {
        padding: 1rem;
        margin-bottom: 1rem;
      }
      h1 {
        font-size: 1.5rem;
        margin-bottom: 1.5rem;
      }
      h2 {
        font-size: 1.25rem;
        margin-bottom: 0.75rem;
      }
      p {
        font-size: 0.875rem;
      }
      input {
        font-size: 0.875rem;
        padding: 0.5rem;
        min-height: 44px;
      }
      button {
        font-size: 0.875rem;
        padding: 0.5rem 1rem;
        min-height: 44px;
      }
      .flex.gap-2 {
        flex-direction: column;
        gap: 0.5rem;
      }
      .github-buttons, .docker-buttons {
        flex-direction: column;
        gap: 0.5rem;
      }
      .result-text {
        font-size: 0.8rem;
        padding: 0.4rem;
      }
      footer {
        font-size: 0.75rem;
      }
    }
  </style>
</head>
<body class="light-mode">
  <button onclick="toggleTheme()" class="theme-toggle bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition">
    <span class="sun">☀️</span>
    <span class="moon hidden">🌙</span>
  </button>
  <div class="container mx-auto">
    <h1 class="text-3xl font-bold text-center mb-8">Cloudflare 加速下载</h1>

    <!-- GitHub 链接转换 -->
    <div class="section-box">
      <h2 class="text-xl font-semibold mb-2">⚡ GitHub 文件加速</h2>
      <p class="text-gray-600 dark:text-gray-300 mb-4">输入 GitHub 文件链接，自动转换为加速链接。也可以直接在链接前加上本站域名使用。</p>
      <div class="flex gap-2 mb-2">
        <input
          id="github-url"
          type="text"
          placeholder="请输入 GitHub 文件链接，例如：https://github.com/user/repo/releases/..."
          class="flex-grow p-2 border border-gray-400 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
        >
        <button
          onclick="convertGithubUrl()"
          class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition"
        >
          获取加速链接
        </button>
      </div>
      <p id="github-result" class="mt-2 text-green-600 dark:text-green-400 result-text hidden"></p>
      <div id="github-buttons" class="flex gap-2 mt-2 github-buttons hidden">
        <button onclick="copyGithubUrl()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">📋 复制链接</button>
        <button onclick="openGithubUrl()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">🔗 打开链接</button>
      </div>
    </div>

    <!-- Docker 镜像加速 -->
    <div class="section-box">
      <h2 class="text-xl font-semibold mb-2">🐳 Docker 镜像加速</h2>
      <p class="text-gray-600 dark:text-gray-300 mb-4">输入原镜像地址（如 hello-world 或 ghcr.io/user/repo），获取加速拉取命令。</p>
      <div class="flex gap-2 mb-2">
        <input
          id="docker-image"
          type="text"
          placeholder="请输入镜像地址，例如：hello-world 或 ghcr.io/user/repo"
          class="flex-grow p-2 border border-gray-400 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
        >
        <button
          onclick="convertDockerImage()"
          class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition"
        >
          获取加速命令
        </button>
      </div>
      <p id="docker-result" class="mt-2 text-green-600 dark:text-green-400 result-text hidden"></p>
      <div id="docker-buttons" class="flex gap-2 mt-2 docker-buttons hidden">
        <button onclick="copyDockerCommand()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">📋 复制命令</button>
      </div>
    </div>

    <footer class="mt-6 text-center text-gray-500 dark:text-gray-400">
      Powered by <a href="https://github.com/bayueqi/ZQ-Proxy" class="text-blue-500 hover:underline">八月琪/ZQ-Proxy</a>
    </footer>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    // 动态获取当前域名
    const currentDomain = window.location.hostname;

    // 主题切换
    function toggleTheme() {
      const body = document.body;
      const sun = document.querySelector('.sun');
      const moon = document.querySelector('.moon');
      if (body.classList.contains('light-mode')) {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        sun.classList.add('hidden');
        moon.classList.remove('hidden');
        localStorage.setItem('theme', 'dark');
      } else {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        moon.classList.add('hidden');
        sun.classList.remove('hidden');
        localStorage.setItem('theme', 'light');
      }
    }

    // 初始化主题
    if (localStorage.getItem('theme') === 'dark') {
      toggleTheme();
    }

    // 显示弹窗提示
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.remove(isError ? 'bg-green-500' : 'bg-red-500');
      toast.classList.add(isError ? 'bg-red-500' : 'bg-green-500');
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    // 复制文本的通用函数
    function copyToClipboard(text) {
      // 尝试使用 navigator.clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(err => {
          console.error('Clipboard API failed:', err);
          return false;
        });
      }
      // 后备方案：使用 document.execCommand
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        return successful ? Promise.resolve() : Promise.reject(new Error('Copy command failed'));
      } catch (err) {
        document.body.removeChild(textarea);
        return Promise.reject(err);
      }
    }

    // GitHub 链接转换
    let githubAcceleratedUrl = '';
    function convertGithubUrl() {
      const input = document.getElementById('github-url').value.trim();
      const result = document.getElementById('github-result');
      const buttons = document.getElementById('github-buttons');
      if (!input) {
        showToast('请输入有效的 GitHub 链接', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }
      if (!input.startsWith('https://')) {
        showToast('链接必须以 https:// 开头', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }

      // 保持现有格式：域名/https://原始链接
      githubAcceleratedUrl = 'https://' + currentDomain + '/https://' + input.substring(8);
      result.textContent = '加速链接: ' + githubAcceleratedUrl;
      result.classList.remove('hidden');
      buttons.classList.remove('hidden');
      copyToClipboard(githubAcceleratedUrl).then(() => {
        showToast('已复制到剪贴板');
      }).catch(err => {
        showToast('复制失败: ' + err.message, true);
      });
    }

    function copyGithubUrl() {
      copyToClipboard(githubAcceleratedUrl).then(() => {
        showToast('已手动复制到剪贴板');
      }).catch(err => {
        showToast('手动复制失败: ' + err.message, true);
      });
    }

    function openGithubUrl() {
      window.open(githubAcceleratedUrl, '_blank');
    }

    // Docker 镜像转换
    let dockerCommand = '';
    function convertDockerImage() {
      const input = document.getElementById('docker-image').value.trim();
      const result = document.getElementById('docker-result');
      const buttons = document.getElementById('docker-buttons');
      if (!input) {
        showToast('请输入有效的镜像地址', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }
      dockerCommand = 'docker pull ' + currentDomain + '/' + input;
      result.textContent = '加速命令: ' + dockerCommand;
      result.classList.remove('hidden');
      buttons.classList.remove('hidden');
      copyToClipboard(dockerCommand).then(() => {
        showToast('已复制到剪贴板');
      }).catch(err => {
        showToast('复制失败: ' + err.message, true);
      });
    }

    function copyDockerCommand() {
      copyToClipboard(dockerCommand).then(() => {
        showToast('已手动复制到剪贴板');
      }).catch(err => {
        showToast('手动复制失败: ' + err.message, true);
      });
    }
  </script>
</body>
</html>
`;

// 1.js 辅助函数开始 =================================
async function handleToken(realm, service, scope) {
  const tokenUrl = `${realm}?service=${service}&scope=${scope}`;
  console.log(`Fetching token from: ${tokenUrl}`);
  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!tokenResponse.ok) {
      console.log(`Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
      return null;
    }
    const tokenData = await tokenResponse.json();
    const token = tokenData.token || tokenData.access_token;
    if (!token) {
      console.log('No token found in response');
      return null;
    }
    console.log('Token acquired successfully');
    return token;
  } catch (error) {
    console.log(`Error fetching token: ${error.message}`);
    return null;
  }
}

function isAmazonS3(url) {
  try {
    return new URL(url).hostname.includes('amazonaws.com');
  } catch {
    return false;
  }
}

// 计算请求体的 SHA256 哈希值
async function calculateSHA256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 获取空请求体的 SHA256 哈希值
function getEmptyBodySHA256() {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}

// 1.js 主处理函数
async function handleRequest1js(request, redirectCount = 0) {
  const MAX_REDIRECTS = 5; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

  // 首页路由
  if (path === '/' || path === '') {
    return new Response(HOMEPAGE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // 处理 Docker V2 API 或 GitHub 代理请求
  let isV2Request = false;
  let v2RequestType = null; // 'manifests' or 'blobs'
  let v2RequestTag = null;  // tag or digest
  if (path.startsWith('/v2/')) {
    isV2Request = true;
    path = path.replace('/v2/', '');

    // 解析 V2 API 请求类型和标签/摘要
    const pathSegments = path.split('/').filter(part => part);
    if (pathSegments.length >= 3) {
      // 格式如: nginx/manifests/latest 或 nginx/blobs/sha256:xxx
      v2RequestType = pathSegments[pathSegments.length - 2];
      v2RequestTag = pathSegments[pathSegments.length - 1];
      // 提取镜像名称部分（去掉 manifests/tag 或 blobs/digest 部分）
      path = pathSegments.slice(0, pathSegments.length - 2).join('/');
    }
  }

  // 提取目标域名和路径
  const pathParts = path.split('/').filter(part => part);
  if (pathParts.length < 1) {
    return new Response('Invalid request: target domain or path required\n', { status: 400 });
  }

  let targetDomain, targetPath, isDockerRequest = false;

  // 检查路径是否以 https:// 或 http:// 开头
  const fullPath = path.startsWith('/') ? path.substring(1) : path;

  if (fullPath.startsWith('https://') || fullPath.startsWith('http://')) {
    // 处理 /https://domain.com/... 或 /http://domain.com/... 格式
    const urlObj = new URL(fullPath);
    targetDomain = urlObj.hostname;
    targetPath = urlObj.pathname.substring(1) + urlObj.search; // 移除开头的斜杠

    // 检查是否为 Docker 请求
    isDockerRequest = ['quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io', 'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io', 'docker.io'].includes(targetDomain);

    // 处理 docker.io 域名，转换为 registry-1.docker.io
    if (targetDomain === 'docker.io') {
      targetDomain = 'registry-1.docker.io';
    }
  } else {
    // 处理 Docker 镜像路径的多种格式
    if (pathParts[0] === 'docker.io') {
      // 处理 docker.io/library/nginx 或 docker.io/amilys/embyserver 格式
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';

      if (pathParts.length === 2) {
        // 处理 docker.io/nginx 格式，添加 library 命名空间
        targetPath = `library/${pathParts[1]}`;
      } else {
        // 处理 docker.io/amilys/embyserver 或 docker.io/library/nginx 格式
        targetPath = pathParts.slice(1).join('/');
      }
    } else if (ALLOWED_HOSTS.includes(pathParts[0])) {
      // Docker 镜像仓库（如 ghcr.io）或 GitHub 域名（如 github.com）
      targetDomain = pathParts[0];
      targetPath = pathParts.slice(1).join('/') + url.search;
      isDockerRequest = ['quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io', 'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io'].includes(targetDomain);
    } else if (pathParts.length >= 1 && pathParts[0] === 'library') {
      // 处理 library/nginx 格式
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = pathParts.join('/');
    } else if (pathParts.length >= 2) {
      // 处理 amilys/embyserver 格式（带命名空间但不是 library）
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = pathParts.join('/');
    } else {
      // 处理单个镜像名称，如 nginx
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = `library/${pathParts.join('/')}`;
    }
  }

  // 默认白名单检查：只允许 ALLOWED_HOSTS 中的域名
  if (!ALLOWED_HOSTS.includes(targetDomain)) {
    console.log(`Blocked: Domain ${targetDomain} not in allowed list`);
    return new Response(`Error: Invalid target domain.\n`, { status: 400 });
  }

  // 路径白名单检查（仅当 RESTRICT_PATHS = true 时）
  if (RESTRICT_PATHS) {
    const checkPath = isDockerRequest ? targetPath : path;
    console.log(`Checking whitelist against path: ${checkPath}`);
    const isPathAllowed = ALLOWED_PATHS.some(pathString =>
      checkPath.toLowerCase().includes(pathString.toLowerCase())
    );
    if (!isPathAllowed) {
      console.log(`Blocked: Path ${checkPath} not in allowed paths`);
      return new Response(`Error: The path is not in the allowed paths.\n`, { status: 403 });
    }
  }

  // 构建目标 URL
  let targetUrl;
  if (isDockerRequest) {
    if (isV2Request && v2RequestType && v2RequestTag) {
      // 重构 V2 API URL
      targetUrl = `https://${targetDomain}/v2/${targetPath}/${v2RequestType}/${v2RequestTag}`;
    } else {
      targetUrl = `https://${targetDomain}/${isV2Request ? 'v2/' : ''}${targetPath}`;
    }
  } else {
    targetUrl = `https://${targetDomain}/${targetPath}`;
  }

  const newRequestHeaders = new Headers(request.headers);
  newRequestHeaders.set('Host', targetDomain);
  newRequestHeaders.delete('x-amz-content-sha256');
  newRequestHeaders.delete('x-amz-date');
  newRequestHeaders.delete('x-amz-security-token');
  newRequestHeaders.delete('x-amz-user-agent');

  if (isAmazonS3(targetUrl)) {
    newRequestHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
    newRequestHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
  }

  try {
    // 尝试直接请求（注意：使用 manual 重定向以便我们能拦截到 307 并自己请求 S3）
    let response = await fetch(targetUrl, {
      method: request.method,
      headers: newRequestHeaders,
      body: request.body,
      redirect: 'manual'
    });
    console.log(`Initial response: ${response.status} ${response.statusText}`);

    // 处理 Docker 认证挑战
    if (isDockerRequest && response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        const authMatch = wwwAuth.match(/Bearer realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/);
        if (authMatch) {
          const [, realm, service, scope] = authMatch;
          console.log(`Auth challenge: realm=${realm}, service=${service || targetDomain}, scope=${scope}`);

          const token = await handleToken(realm, service || targetDomain, scope);
          if (token) {
            const authHeaders = new Headers(request.headers);
            authHeaders.set('Authorization', `Bearer ${token}`);
            authHeaders.set('Host', targetDomain);
            // 如果目标是 S3，添加必要的 x-amz 头；否则删除可能干扰的头部
            if (isAmazonS3(targetUrl)) {
              authHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
              authHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
            } else {
              authHeaders.delete('x-amz-content-sha256');
              authHeaders.delete('x-amz-date');
              authHeaders.delete('x-amz-security-token');
              authHeaders.delete('x-amz-user-agent');
            }

            const authRequest = new Request(targetUrl, {
              method: request.method,
              headers: authHeaders,
              body: request.body,
              redirect: 'manual'
            });
            console.log('Retrying with token');
            response = await fetch(authRequest);
            console.log(`Token response: ${response.status} ${response.statusText}`);
          } else {
            console.log('No token acquired, falling back to anonymous request');
            const anonHeaders = new Headers(request.headers);
            anonHeaders.delete('Authorization');
            anonHeaders.set('Host', targetDomain);
            // 如果目标是 S3，添加必要的 x-amz 头；否则删除可能干扰的头部
            if (isAmazonS3(targetUrl)) {
              anonHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
              anonHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
            } else {
              anonHeaders.delete('x-amz-content-sha256');
              anonHeaders.delete('x-amz-date');
              anonHeaders.delete('x-amz-security-token');
              anonHeaders.delete('x-amz-user-agent');
            }

            const anonRequest = new Request(targetUrl, {
              method: request.method,
              headers: anonHeaders,
              body: request.body,
              redirect: 'manual'
            });
            response = await fetch(anonRequest);
            console.log(`Anonymous response: ${response.status} ${response.statusText}`);
          }
        } else {
          console.log('Invalid WWW-Authenticate header');
        }
      } else {
        console.log('No WWW-Authenticate header in 401 response');
      }
    }

    // 处理 S3 重定向（Docker 镜像层）
    if (isDockerRequest && (response.status === 307 || response.status === 302)) {
      const redirectUrl = response.headers.get('Location');
      if (redirectUrl) {
        console.log(`Redirect detected: ${redirectUrl}`);
        const EMPTY_BODY_SHA256 = getEmptyBodySHA256();
        const redirectHeaders = new Headers(request.headers);
        redirectHeaders.set('Host', new URL(redirectUrl).hostname);
        
        // 对于任何重定向，都添加必要的AWS头（如果需要）
        if (isAmazonS3(redirectUrl)) {
          redirectHeaders.set('x-amz-content-sha256', EMPTY_BODY_SHA256);
          redirectHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
        }
        
        if (response.headers.get('Authorization')) {
          redirectHeaders.set('Authorization', response.headers.get('Authorization'));
        }

        const redirectRequest = new Request(redirectUrl, {
          method: request.method,
          headers: redirectHeaders,
          body: request.body,
          redirect: 'manual'
        });
        response = await fetch(redirectRequest);
        console.log(`Redirect response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          console.log('Redirect request failed, returning original redirect response');
          return new Response(response.body, {
            status: response.status,
            headers: response.headers
          });
        }
      }
    }

    // 复制响应并添加 CORS 头
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    if (isDockerRequest) {
      newResponse.headers.set('Docker-Distribution-API-Version', 'registry/2.0');
      // 删除可能存在的重定向头，确保所有请求都通过Worker处理
      newResponse.headers.delete('Location');
    }
    return newResponse;
  } catch (error) {
    console.log(`Fetch error: ${error.message}`);
    return new Response(`Error fetching from ${targetDomain}: ${error.message}\n`, { status: 500 });
  }
}
// 1.js 辅助函数结束 =================================


// 由白名单自动生成映射
const domain_mappings = Object.fromEntries(
  domain_whitelist.map(domain => [domain, domain.replace(/\./g, '-')])
);


// 需要重定向的路径
const redirect_paths = ['/login', '/signup', '/copilot', '/search/custom_scopes', '/session'];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  // 统一转小写
  const current_host = url.host.toLowerCase();
  const host_header = request.headers.get('Host');
  const effective_host = (host_header || current_host).toLowerCase();
  
  // 检查是否是 1.js 相关的请求（首页或加速下载请求）
  // 如果不是以 -github. 开头的域名，或者路径是加速下载相关路径，则使用 1.js 的功能
  const host_prefix = getProxyPrefix(effective_host);
  if (!host_prefix || url.pathname.startsWith('/https://') || url.pathname.startsWith('/v2/')) {
    return handleRequest1js(request);
  }
  
  // 对于 -github. 后缀的域名，即使路径是根路径，也应该进入 GitHub 网站
  
  // 检查特殊路径，返回正常错误
  if (redirect_paths.includes(url.pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  // 强制使用 HTTPS
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.href);
  }

  // 根据前缀找到对应的原始域名
  let target_host = null;
  
  // 解析 *-github. 模式
  if (host_prefix && host_prefix.endsWith('-github.')) {
    const prefix_part = host_prefix.slice(0, -8); // 移除 -github.
    // 尝试找到对应的原始域名
    for (const original of Object.keys(domain_mappings)) {
      const normalized_original = original.trim().toLowerCase();
      if (normalized_original.replace(/\./g, '-') === prefix_part) {
        target_host = original;
        break;
      }
    }
  }

  if (!target_host) {
    return new Response(`Domain not configured for proxy. Host: ${effective_host}, Prefix: ${host_prefix}, Target lookup failed`, { status: 404 });
  }

  // 直接使用正则表达式处理最常见的嵌套URL问题
  let pathname = url.pathname;
  
  // 修复特定的嵌套URL模式 - 直接移除嵌套URL部分
  // 匹配 /xxx/xxx/latest-commit/main/https%3A//gh.xxx.xxx/ 或 /xxx/xxx/tree-commit-info/main/https%3A//gh.xxx.xxx/
  pathname = pathname.replace(/(\/[^\/]+\/[^\/]+\/(?:latest-commit|tree-commit-info)\/[^\/]+)\/https%3A\/\/[^\/]+\/.*/, '$1');
  
  // 同样处理非编码版本
  pathname = pathname.replace(/(\/[^\/]+\/[^\/]+\/(?:latest-commit|tree-commit-info)\/[^\/]+)\/https:\/\/[^\/]+\/.*/, '$1');

  // 构建新的请求URL
  const new_url = new URL(url);
  new_url.host = target_host;
  new_url.pathname = pathname;
  new_url.protocol = 'https:';

  // 设置新的请求头
  const new_headers = new Headers(request.headers);
  new_headers.set('Host', target_host);
  new_headers.set('Referer', new_url.href);
  
  try {
    // 发起请求
    const response = await fetch(new_url.href, {
      method: request.method,
      headers: new_headers,
      body: request.method !== 'GET' ? request.body : undefined
    });

    // 克隆响应以便处理内容
    const response_clone = response.clone();
    
    // 设置新的响应头
    const new_response_headers = new Headers(response.headers);
    new_response_headers.set('access-control-allow-origin', '*');
    new_response_headers.set('access-control-allow-credentials', 'true');
    new_response_headers.set('cache-control', 'public, max-age=14400');
    new_response_headers.delete('content-security-policy');
    new_response_headers.delete('content-security-policy-report-only');
    new_response_headers.delete('clear-site-data');
    
    // 处理响应内容，替换域名引用，使用有效主机名来决定域名后缀
    const modified_body = await modifyResponse(response_clone, host_prefix, effective_host);

    return new Response(modified_body, {
      status: response.status,
      headers: new_response_headers
    });
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}

// 获取当前主机名的前缀，用于匹配反向映射
function getProxyPrefix(host) {
  // 检查 *-github. 模式
  const ghMatch = host.match(/^([a-z0-9-]+-github\.)/);
  if (ghMatch) {
    return ghMatch[1];
  }

  return null;
}

async function modifyResponse(response, host_prefix, effective_hostname) {
  // 只处理文本内容
  const content_type = response.headers.get('content-type') || '';
  if (!content_type.includes('text/') && !content_type.includes('application/json') && 
      !content_type.includes('application/javascript') && !content_type.includes('application/xml')) {
    return response.body;
  }

  let text = await response.text();
  
  // 使用有效主机名获取域名后缀部分（用于构建完整的代理域名）
  const domain_suffix = effective_hostname.substring(host_prefix.length);
  
  // 替换所有域名引用
  for (const [original_domain, mapped_prefix] of Object.entries(domain_mappings)) {
    const escaped_domain = original_domain.replace(/\./g, '\\.');
    
    // 统一为 [原生域名]-github.072103.xyz
    const current_prefix = mapped_prefix + '-github.';
    const full_proxy_domain = `${current_prefix}${domain_suffix}`;
    
    // 替换完整URLs
    text = text.replace(
      new RegExp(`https?://${escaped_domain}(?=/|"|'|\\s|$)`, 'g'),
      `https://${full_proxy_domain}`
    );
    
    // 替换协议相对URLs
    text = text.replace(
      new RegExp(`//${escaped_domain}(?=/|"|'|\\s|$)`, 'g'),
      `//${full_proxy_domain}`
    );
  }

  // 处理相对路径，使用有效主机名
  // 所有模式下都生效
  // 注意：这个替换可能会导致问题，因为它会匹配所有以 / 开头的路径
  // 许多 JS/CSS 引用可能是相对路径，但也可能是根路径
  // 如果这里强制替换为绝对路径，可能会导致 URL 拼接错误
  // 例如：如果原文本是 "/assets/foo.js"，它会被替换为 "https://github-githubassets-com-gh.xxx.com/assets/foo.js"
  // 如果原文本已经是 "https://github-githubassets-com-gh.xxx.com/assets/foo.js" (被上面的循环替换了)，这里不会再匹配（因为前面的 http... 不符合 (?<=["'])）
  // 但是，如果原文本是相对路径，如 "/assets/foo.js"，并且当前页面已经是代理页面
  // 浏览器会自动将其解析为当前域名下的路径，通常不需要我们手动替换
  // 手动替换反而可能导致像 `https://domain.com/assetshttps://domain.com/foo.js` 这种奇怪的 URL
  // 除非是为了处理某些特定的动态加载脚本，否则应该谨慎使用
  
  // 暂时注释掉这段代码，看看是否解决 "URL 拼接" 问题
  /*
  text = text.replace(
    /(?<=["'])\/(?!\/|[a-zA-Z]+:)/g,
    `https://${effective_hostname}/`
  );
  */

  return text;
}
