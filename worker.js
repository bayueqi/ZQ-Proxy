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

// KV空间绑定（需要在Cloudflare Worker设置中配置）
// 绑定名称：Proxy

// 从KV获取域名白名单
async function getDomainWhitelist() {
  try {
    // 检查KV空间是否存在
    if (typeof Proxy !== 'undefined') {
      const whitelist = await Proxy.get('domain_whitelist');
      if (whitelist) {
        return JSON.parse(whitelist);
      }
    }
  } catch (error) {
    console.error('Error getting domain whitelist from KV:', error);
  }
  // 默认白名单作为回退
  return domain_whitelist;
}

// 保存域名白名单到KV
async function saveDomainWhitelist(whitelist) {
  try {
    if (typeof Proxy !== 'undefined') {
      await Proxy.put('domain_whitelist', JSON.stringify(whitelist));
      // 更新内存中的domain_whitelist变量
      domain_whitelist.length = 0;
      whitelist.forEach(domain => domain_whitelist.push(domain));
      return true;
    }
  } catch (error) {
    console.error('Error saving domain whitelist to KV:', error);
  }
  return false;
}

// 由白名单自动生成映射
async function getDomainMappings() {
  const whitelist = await getDomainWhitelist();
  return Object.fromEntries(
    whitelist.map(domain => [domain, domain.replace(/\./g, '-')])
  );
}

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

// 管理员页面 HTML
const ADMIN_PAGE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员页面 - 域名白名单管理</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      min-height: 100vh;
      background: linear-gradient(to bottom right, #e6f0ff, #f0f8ff);
      color: #1a365d;
    }
    .container {
      max-width: 1000px;
    }
    .card {
      background: white;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(59, 130, 246, 0.15);
      border: 1px solid #dbeafe;
    }
    .table-responsive {
      overflow-x: auto;
    }
    .domain-item {
      transition: all 0.2s;
    }
    .domain-item:hover {
      background-color: #ebf8ff;
    }
    h1, h2, h3 {
      color: #1a365d;
    }
    .bg-blue-500 {
      background-color: #3182ce;
    }
    .bg-blue-500:hover {
      background-color: #2b6cb0;
    }
  </style>
</head>
<body>
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-6 text-center text-gray-800">ZQ-Proxy 管理员</h1>
    
    <!-- 添加域名表单 -->
    <div class="card p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4 text-gray-700">添加新域名</h2>
      <form method="POST" class="flex flex-col sm:flex-row gap-3">
        <input type="text" name="domain" placeholder="输入域名（例如：github.com）" 
               class="flex-grow p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <input type="hidden" name="action" value="add">
        <button type="submit" class="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition">
          添加域名
        </button>
      </form>
    </div>
    
    <!-- 域名管理 -->
    <div class="card p-6">
      <h2 class="text-xl font-semibold mb-4 text-gray-700">域名管理</h2>
      
      <!-- 当前白名单域名 -->
      <div>
        <h3 class="text-lg font-medium mb-3 text-gray-600">当前白名单域名</h3>
        <div class="space-y-2">
          {{domains_list}}
        </div>
      </div>
    </div>
    
  </div>
</body>
</html>
`;

// 首页 HTML
const HOMEPAGE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZQ-Proxy</title>
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
      background: linear-gradient(to bottom right, #e6f0ff, #f0f8ff);
      color: #1a365d;
    }
    .dark-mode {
      background: linear-gradient(to bottom right, #1a365d, #2a4365);
      color: #e2e8f0;
    }
    .container {
      width: 100%;
      max-width: 800px;
      padding: 1.5rem;
      border-radius: 0.75rem;
      border: 1px solid #bfdbfe;
      box-shadow: 0 8px 16px rgba(59, 130, 246, 0.15);
    }
    .light-mode .container {
      background: #ffffff;
    }
    .dark-mode .container {
      background: #2a4365;
    }
    .section-box {
      background: linear-gradient(to bottom, #ffffff, #f0f8ff);
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 8px rgba(59, 130, 246, 0.1);
      border: 1px solid #dbeafe;
    }
    .dark-mode .section-box {
      background: linear-gradient(to bottom, #3182ce, #2c5282);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      border: 1px solid #4299e1;
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
      background: #3182ce;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);
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
      background: #ebf8ff;
    }
    .dark-mode .result-text {
      background: #2c5282;
    }

    input[type="text"] {
      background-color: white !important;
      color: #1a365d !important;
    }
    .dark-mode input[type="text"] {
      background-color: #2c5282 !important;
      color: #e2e8f0 !important;
    }

    h1, h2 {
      color: #1a365d;
    }
    .dark-mode h1, .dark-mode h2 {
      color: #ebf8ff;
    }

    button {
      transition: all 0.3s ease;
    }

    .bg-blue-500 {
      background-color: #3182ce;
    }
    .bg-blue-500:hover {
      background-color: #2b6cb0;
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
  <button onclick="toggleTheme()" class="theme-toggle bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100 rounded-full hover:bg-blue-200 dark:hover:bg-blue-700 transition">
    <span class="sun">☀️</span>
    <span class="moon hidden">🌙</span>
  </button>
  <a href="/admin" target="_blank" class="theme-toggle bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100 rounded-full hover:bg-blue-200 dark:hover:bg-blue-700 transition" style="right: 4rem;">
    🔧
  </a>
  <div class="container mx-auto">
    <h1 class="text-3xl font-bold text-center mb-8">ZQ-Proxy</h1>

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

    <!-- 当前白名单域名 -->
    <div class="section-box">
      <h2 class="text-xl font-semibold mb-2">📋 当前白名单域名</h2>
      <p class="text-gray-600 dark:text-gray-300 mb-4">以下域名已添加到白名单，可通过代理访问</p>
      <div class="space-y-3">
        {{domains_list}}
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

async function handleRequest1js(request, redirectCount = 0) {
  const MAX_REDIRECTS = 5; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

  // 首页路由
  if (path === '/' || path === '') {
    // 获取域名白名单
    const domains = await getDomainWhitelist();
    // 生成域名列表（不包含删除按钮）
    const domainsList = domains.map(domain => {
      const proxyDomain = domain.replace(/\./g, '-') + '-proxy.vpnjacky.dpdns.org';
      return `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-gray-200 rounded-lg">
          <div class="flex-1 mb-2 sm:mb-0">
            <div class="text-gray-700 font-medium">${domain}</div>
            <div class="text-gray-500 text-sm mt-1">
              代理域名: <a href="https://${proxyDomain}" target="_blank" class="text-blue-500 hover:underline">${proxyDomain}</a>
            </div>
          </div>
        </div>
      `;
    }).join('');
    // 替换模板中的占位符
    const homepageHtml = HOMEPAGE_HTML.replace('{{domains_list}}', domainsList);
    return new Response(homepageHtml, {
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
  const domainWhitelist = await getDomainWhitelist();
  if (!ALLOWED_HOSTS.includes(targetDomain) && !domainWhitelist.includes(targetDomain)) {
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


// 需要重定向的路径
const redirect_paths = ['/login', '/signup', '/copilot', '/search/custom_scopes', '/session'];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// 从KV获取管理员密码
async function getAdminPassword() {
  try {
    if (typeof Proxy !== 'undefined') {
      const password = await Proxy.get('admin_password');
      return password;
    }
  } catch (error) {
    console.error('Error getting admin password from KV:', error);
  }
  return null;
}

// 保存管理员密码到KV
async function saveAdminPassword(password) {
  try {
    if (typeof Proxy !== 'undefined') {
      await Proxy.put('admin_password', password);
      return true;
    }
  } catch (error) {
    console.error('Error saving admin password to KV:', error);
  }
  return false;
}

// 管理员认证检查
async function isAdminAuthenticated(request) {
  // 从KV获取密码
  const savedPassword = await getAdminPassword();
  
  // 如果没有设置密码，返回false，需要设置密码
  if (!savedPassword) {
    return false;
  }
  
  // 验证密码
  const url = new URL(request.url);
  const password = url.searchParams.get('pwd');
  return password === savedPassword;
}

// 渲染管理员页面
function renderAdminPage(domains) {
  // 生成域名列表
  const domainsList = domains.map(domain => {
    const proxyDomain = domain.replace(/\./g, '-') + '-proxy.vpnjacky.dpdns.org';
    return `
      <div class="domain-item flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-gray-200 rounded-lg mb-3">
        <div class="flex-1 mb-2 sm:mb-0">
          <div class="text-gray-700 font-medium">${domain}</div>
          <div class="text-gray-500 text-sm mt-1">
            代理域名: <a href="https://${proxyDomain}" target="_blank" class="text-blue-500 hover:underline">${proxyDomain}</a>
          </div>
        </div>
        <form method="POST" class="inline">
          <input type="hidden" name="domain" value="${domain}">
          <input type="hidden" name="action" value="remove">
          <button type="submit" class="text-red-500 hover:text-red-700 px-3 py-1 rounded hover:bg-red-50">
            删除
          </button>
        </form>
      </div>
    `;
  }).join('');
  
  // 替换模板中的占位符
  return ADMIN_PAGE_HTML
    .replace('{{domains_list}}', domainsList);
}

// 渲染密码设置页面
function renderPasswordSetupPage() {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>设置管理员密码 - ZQ-Proxy</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body {
          min-height: 100vh;
          background: linear-gradient(to bottom right, #e6f0ff, #f0f8ff);
          color: #1a365d;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Inter', sans-serif;
          padding: 1rem;
        }
        .container {
          max-width: 500px;
          width: 100%;
          padding: 2rem;
          background: white;
          border-radius: 0.75rem;
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.15);
          border: 1px solid #dbeafe;
        }
        h1 {
          color: #1a365d;
          margin-bottom: 1.5rem;
        }
        .bg-blue-500 {
          background-color: #3182ce;
        }
        .bg-blue-500:hover {
          background-color: #2b6cb0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 class="text-2xl font-bold text-center mb-6">设置管理员密码</h1>
        <p class="text-gray-600 mb-4">首次访问管理员界面，请设置一个安全的密码。</p>
        <form method="POST">
          <input type="hidden" name="action" value="set_password">
          <div class="mb-4">
            <label for="password" class="block text-gray-700 mb-2">管理员密码</label>
            <input type="password" id="password" name="password" placeholder="请输入密码" 
                   class="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="mb-6">
            <label for="confirm_password" class="block text-gray-700 mb-2">确认密码</label>
            <input type="password" id="confirm_password" name="confirm_password" placeholder="请再次输入密码" 
                   class="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition">
            设置密码
          </button>
        </form>
      </div>
    </body>
    </html>
  `;
}

// 渲染登录页面
function renderLoginPage() {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>管理员登录 - ZQ-Proxy</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body {
          min-height: 100vh;
          background: linear-gradient(to bottom right, #e6f0ff, #f0f8ff);
          color: #1a365d;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Inter', sans-serif;
          padding: 1rem;
        }
        .container {
          max-width: 500px;
          width: 100%;
          padding: 2rem;
          background: white;
          border-radius: 0.75rem;
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.15);
          border: 1px solid #dbeafe;
        }
        h1 {
          color: #1a365d;
          margin-bottom: 1.5rem;
        }
        .bg-blue-500 {
          background-color: #3182ce;
        }
        .bg-blue-500:hover {
          background-color: #2b6cb0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 class="text-2xl font-bold text-center mb-6">管理员登录</h1>
        <p class="text-gray-600 mb-4">请输入管理员密码以访问管理界面。</p>
        <form method="GET" action="/admin">
          <div class="mb-6">
            <label for="pwd" class="block text-gray-700 mb-2">管理员密码</label>
            <input type="password" id="pwd" name="pwd" placeholder="请输入密码" 
                   class="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition">
            登录
          </button>
        </form>
      </div>
    </body>
    </html>
  `;
}

// 管理员页面处理函数
async function handleAdminRequest(request) {
  const url = new URL(request.url);
  
  // 检查是否已设置密码
  const savedPassword = await getAdminPassword();
  
  // 如果没有设置密码，显示密码设置页面
  if (!savedPassword) {
    if (request.method === 'GET') {
      return new Response(renderPasswordSetupPage(), {
        headers: { 'Content-Type': 'text/html' }
      });
    } else if (request.method === 'POST') {
      // 处理密码设置
      const formData = await request.formData();
      const action = formData.get('action');
      
      if (action === 'set_password') {
        const password = formData.get('password');
        const confirmPassword = formData.get('confirm_password');
        
        if (!password || password.length < 6) {
          return new Response('密码长度至少6位', { status: 400 });
        }
        
        if (password !== confirmPassword) {
          return new Response('两次输入的密码不一致', { status: 400 });
        }
        
        // 保存密码
        const success = await saveAdminPassword(password);
        if (success) {
          // 密码设置成功，重定向到管理员页面
          return Response.redirect('/admin?pwd=' + password, 302);
        } else {
          return new Response('密码设置失败', { status: 500 });
        }
      }
    }
  } else {
    // 密码已设置，检查是否提供了密码
    const providedPassword = url.searchParams.get('pwd');
    if (!providedPassword) {
      // 没有提供密码，显示登录页面
      return new Response(renderLoginPage(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }
  
  // 管理员认证
  if (!await isAdminAuthenticated(request)) {
    // 认证失败，显示登录页面
    return new Response(renderLoginPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  if (request.method === 'GET') {
    // 显示管理员页面
    const domains = await getDomainWhitelist();
    return new Response(renderAdminPage(domains), {
      headers: { 'Content-Type': 'text/html' }
    });
  } else if (request.method === 'POST') {
    // 处理域名更新
    try {
      const formData = await request.formData();
      const action = formData.get('action');
      const domain = formData.get('domain');
      
      const currentWhitelist = await getDomainWhitelist();
      let updatedWhitelist = [...currentWhitelist];
      
      if (action === 'add' && domain) {
        // 添加域名
        if (!updatedWhitelist.includes(domain)) {
          updatedWhitelist.push(domain);
        }
      } else if (action === 'remove' && domain) {
        // 删除域名
        updatedWhitelist = updatedWhitelist.filter(d => d !== domain);
      }
      
      // 保存到KV
      await saveDomainWhitelist(updatedWhitelist);
      
      // 重定向回管理员页面
      return Response.redirect(url.origin + '/admin?pwd=' + url.searchParams.get('pwd'), 302);
    } catch (error) {
      console.error('Error processing admin request:', error);
      return new Response('Error processing request', { status: 500 });
    }
  }
  
  return new Response('Method not allowed', { status: 405 });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 管理员页面路由
  if (url.pathname.startsWith('/admin')) {
    return handleAdminRequest(request);
  }
  
  // 统一转小写
  const current_host = url.host.toLowerCase();
  const host_header = request.headers.get('Host');
  const effective_host = (host_header || current_host).toLowerCase();
  
  const host_prefix = getProxyPrefix(effective_host);
  if (!host_prefix || url.pathname.startsWith('/https://') || url.pathname.startsWith('/v2/')) {
    return handleRequest1js(request);
  }
  
  // 对于 -proxy. 后缀的域名，即使路径是根路径，也应该进入 GitHub 网站
  
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
  
  // 获取动态域名映射
  const domain_mappings = await getDomainMappings();
  
  // 解析 *-proxy. 模式
  if (host_prefix && host_prefix.endsWith('-proxy.')) {
    const prefix_part = host_prefix.slice(0, -7); // 移除 -proxy.
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
    const modified_body = await modifyResponse(response_clone, host_prefix, effective_host, domain_mappings);

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
  // 检查 *-proxy. 模式
  const ghMatch = host.match(/^([a-z0-9-]+-proxy\.)/);
  if (ghMatch) {
    return ghMatch[1];
  }

  return null;
}

async function modifyResponse(response, host_prefix, effective_hostname, domain_mappings) {
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
    
    const current_prefix = mapped_prefix + '-proxy.';
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


  return text;
}
