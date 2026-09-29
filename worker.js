// 白名单存储结构（KV key = site_groups）：
//   [{ name: 'GitHub', domains: ['github.com', ...] }, ...]
// 这里不再内置任何放行域名 —— 白名单完全由管理页面录入决定，KV 里没有数据就是空白名单。
// 唯一的例外是下面的 ALLOWED_HOSTS（Docker 仓库 + GitHub 几个主干域名，代码级基础设施）。

// 「服务包」：输入域名后用来「连带找出所有需要的域名」的映射知识。
// 只用于查找和预填，不会自动放行；是否加入白名单由管理页面上勾选确认。
const SERVICE_BUNDLES = {
  'github.com': [
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
  ]
};

// KV空间绑定（需要在Cloudflare Worker设置中配置）
// 绑定名称：Proxy。面板 → 设置 → 绑定 → KV 命名空间，变量名必须填 Proxy，没有别名。

// KV 绑定名，只有一个：Proxy。
//
// 关键点：绝对不要用 `typeof Proxy !== 'undefined'` 判断绑定是否存在 ——
// Proxy 是 JS 内置构造器，这个判断恒为真。绑定没注入时就会在 Proxy.get(...) 直接抛异常，
// 于是**每个请求都抛一次并写一条 error 日志**，既白费 CPU，又把 Workers Logs 免费额度（20 万事件/天）吃掉一半。
// 所以这里改成特性检测：内置 Proxy 构造器上只有 revocable，没有 get/put，天然被排除掉；
// 只有面板真的把 KV 命名空间注入到 globalThis.Proxy 上，它才会被认出来。
const KV_BINDING_NAME = 'Proxy';

function getKV() {
  let candidate;
  try {
    // 先读注入到全局的绑定（service worker 格式的常规位置），
    // 再读 env 上的同名绑定（只是同一个名字的另一个注入位置，不是别名）。
    candidate = globalThis[KV_BINDING_NAME];
    if (!isKVNamespace(candidate) && globalThis.env) {
      candidate = globalThis.env[KV_BINDING_NAME];
    }
  } catch {
    candidate = undefined;
  }
  return isKVNamespace(candidate) ? candidate : null;
}

// 必须同时有 get / put 才算真的 KV 命名空间。
// 内置 Proxy 构造器没有这两个方法，所以「绑定没配」时这里一定返回 false，不会误判。
function isKVNamespace(obj) {
  return !!obj && typeof obj.get === 'function' && typeof obj.put === 'function';
}

// 站点分组内存缓存：KV 免费额度只有 10 万读/天，而本服务每个请求都要查白名单，
// 不缓存的话光是这一项就会顶到配额上限。
let cachedGroups = null;
let cachedGroupsAt = 0;
const GROUPS_TTL_MS = 60000;

// 从KV获取站点分组
async function getSiteGroups() {
  const now = Date.now();
  if (cachedGroups && now - cachedGroupsAt < GROUPS_TTL_MS) {
    return cachedGroups;
  }

  const kv = getKV();
  if (kv) {
    try {
      const raw = await kv.get('site_groups');
      if (raw) {
        const parsed = JSON.parse(raw);
        cachedGroups = Array.isArray(parsed) ? parsed : [];
        cachedGroupsAt = now;
        return cachedGroups;
      }
    } catch (error) {
      // 只记 message，别记整个对象，日志体积也要省
      console.error('Error getting site groups from KV:', error && error.message ? error.message : String(error));
    }
  }

  // KV 里没有 site_groups（全新部署或读取失败）就是空白名单，不再有内置域名兜底
  cachedGroups = [];
  cachedGroupsAt = now;
  return cachedGroups;
}

// 放行判断和正文域名替换都只吃扁平域名列表，这里把分组压平
async function getDomainWhitelist() {
  const groups = await getSiteGroups();
  return groups.flatMap(group => (Array.isArray(group.domains) ? group.domains : []));
}

// 保存站点分组到KV
async function saveSiteGroups(groups) {
  const kv = getKV();
  if (!kv) {
    console.error('KV binding missing: 站点分组无法保存（面板 → 设置 → 绑定，KV 命名空间的变量名填 Proxy）');
    return false;
  }
  try {
    await kv.put('site_groups', JSON.stringify(groups));
    cachedGroups = groups;
    cachedGroupsAt = Date.now();
    return true;
  } catch (error) {
    console.error('Error saving site groups to KV:', error && error.message ? error.message : String(error));
  }
  return false;
}

// 注册域名（eTLD+1）。不能一律取后两段：douyin.com.cn 的注册域名是 douyin.com.cn 而不是 com.cn。
// 这里只列常见的两段式公共后缀，够用且不用引整个公共后缀表。
const TWO_LEVEL_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'org.hk', 'edu.hk', 'gov.hk', 'com.tw', 'org.tw', 'edu.tw', 'com.mo', 'edu.mo',
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp',
  'com.au', 'net.au', 'org.au', 'com.sg', 'com.br', 'com.mx', 'co.kr', 'co.in',
  'com.my', 'com.tr', 'co.za', 'com.ar', 'com.sa', 'com.pk'
]);

function registrableDomain(host) {
  const parts = String(host).toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

// 按输入域名找出「这个站点需要的所有域名」。
// 1) 先查预置服务包（输入 github.com，或输入包里的某个域名，如 api.github.com，都命中同一个包）
// 2) 没命中就扫描首页 + 首页引用的同站 JS/CSS，按「出现在几类来源里、出现多少次」排序
// 入口域名本身永远排在最前：首页 HTML 大多写相对路径，只扫 HTML 的话输入域名根本不会出现在结果里。
// source 会如实告诉调用方结果是从哪来的，页面要如实展示。
async function findRelatedDomains(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) {
    return { source: 'none', domains: [], message: '请输入域名' };
  }
  // 允许直接粘贴完整 URL
  const domain = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0];
  if (!domain) {
    return { source: 'none', domains: [], message: '请输入域名' };
  }

  let source;
  let items;
  let scanned = 0;
  let errorMessage = '';

  if (SERVICE_BUNDLES[domain]) {
    source = 'bundle';
    items = SERVICE_BUNDLES[domain].map(d => ({ domain: d, count: 0 }));
  } else {
    const bundleKey = Object.keys(SERVICE_BUNDLES).find(key => SERVICE_BUNDLES[key].includes(domain));
    if (bundleKey) {
      source = 'bundle';
      items = SERVICE_BUNDLES[bundleKey].map(d => ({ domain: d, count: 0 }));
    } else {
      const scan = await scanHomepageDomains(domain);
      source = scan.error ? 'error' : 'scan';
      // 扫描失败也把入口域名给出来 —— 至少让人能先把输入的那个域名加进白名单
      items = scan.error ? [] : scan.domains;
      scanned = scan.scanned || 0;
      errorMessage = scan.error || '';
    }
  }

  // 入口域名 + 它的注册域名，无论扫描到什么都排在最前面
  const lead = [{ domain, count: 0, entry: true, sources: [] }];
  const registrable = registrableDomain(domain);
  if (registrable && registrable !== domain) {
    lead.push({ domain: registrable, count: 0, entry: true, sources: [] });
  }
  items = lead.filter(item => !items.some(exist => exist.domain === item.domain)).concat(items);

  // 标注每个域名当前已经在哪个分组里，页面好显示
  const groups = await getSiteGroups();
  items.forEach(item => {
    const owner = groups.find(group => Array.isArray(group.domains) && group.domains.includes(item.domain));
    item.group = owner ? owner.name : null;
  });

  return { source, domains: items, scanned, message: errorMessage };
}

// 扫描用的 UA / 超时 / 抓几个同站脚本
const SCAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const SCAN_TIMEOUT_MS = 6000;
// 接口和 CDN 域名多半藏在首页引用的 JS 里，所以脚本也要扫；但得有个上限，不能把整站拉下来
const SCAN_SUBRESOURCE_LIMIT = 6;
// 单个脚本文本的上限，避免把几十 MB 的 bundle 全读进内存
const SCAN_TEXT_LIMIT = 3 * 1024 * 1024;

// 命名空间 / 规范类域名（连它们的子域一起）：出现在 xmlns、$schema、示例里，不是网络请求，
// 抓进来只会干扰判断。只影响「扫描结果」，不影响服务包和用户自己勾选的域名。
const NON_NETWORK_HOSTS = [
  'w3.org', 'schema.org', 'json-schema.org',
  'example.com', 'example.org', 'example.net', 'localhost'
];

function isNonNetworkHost(host) {
  for (const blocked of NON_NETWORK_HOSTS) {
    if (host === blocked || host.endsWith('.' + blocked)) return true;
  }
  return false;
}

// 裸 host（脚本里写死的 "api.example.com" 这种字符串）才需要这张表：
// 用它把 index.html / jquery.min.js 这类文件名挡掉 —— 它们的「TLD」位置是 html / js，不在表里。
// 带协议或 // 的写法不需要它，那种形式本身就是明确的 URL。
const COMMON_TLDS = new Set([
  'com', 'cn', 'net', 'org', 'io', 'co', 'me', 'dev', 'app', 'ai', 'tv', 'cc', 'info', 'biz',
  'xyz', 'top', 'site', 'online', 'tech', 'cloud', 'live', 'space', 'website', 'store', 'shop',
  'club', 'vip', 'art', 'fun', 'wiki', 'pro', 'mobi', 'asia', 'name', 'ltd', 'group',
  'us', 'uk', 'jp', 'kr', 'de', 'fr', 'ru', 'in', 'br', 'au', 'ca', 'hk', 'tw', 'sg', 'mo',
  'edu', 'gov', 'int', 'id', 'my', 'ph', 'th', 'vn', 'es', 'it', 'nl', 'se', 'no', 'dk', 'fi',
  'pl', 'ch', 'at', 'be', 'cz', 'pt', 'gr', 'ie', 'nz', 'za', 'mx', 'ar', 'cl', 'tr', 'il',
  'ae', 'sa', 'pk', 'ua', 'ro', 'hu', 'sk', 'si', 'rs', 'lv', 'lt', 'ee', 'by', 'kz'
]);

// 往结果表里记一个候选域名：host -> { count, sources:Set }
function addHost(map, raw, source, requireKnownTld) {
  const host = String(raw || '').toLowerCase().replace(/\.$/, '');
  if (!host || isNonNetworkHost(host)) return;
  if (requireKnownTld && !COMMON_TLDS.has(host.slice(host.lastIndexOf('.') + 1))) return;

  const entry = map.get(host) || { count: 0, sources: new Set() };
  entry.count += 1;
  entry.sources.add(source);
  map.set(host, entry);
}

// 从一段文本里抽 host。bare=true 时才额外认「引号包起来的裸 host」（只对 JS/CSS 这么干）。
function collectHosts(text, map, source, bare) {
  const urlRe = /(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[/:?#"'\s]|$)/gi;
  let match;
  while ((match = urlRe.exec(text)) !== null) addHost(map, match[1], source, false);

  if (!bare) return;
  // 裸 host 至少要有两段子域（a.b.c），只有一段的话跟属性名、文件名太像了
  const bareRe = /["'`]([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+){2,})["'`]/gi;
  while ((match = bareRe.exec(text)) !== null) addHost(map, match[1], source, true);
}

// CSP 头里经常会列出这个站要用的全部域名（带协议、带 *. 通配、或只写裸 host 三种写法都有），
// 是准确度最高的一类来源
function collectCspHosts(csp, map) {
  const re = /(?:^|[\s;])(?:(?:https?:)?\/\/)?(?:\*\.)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[\s;,]|$)/gi;
  let match;
  while ((match = re.exec(csp)) !== null) addHost(map, match[1], 'CSP', false);
}

// 从首页 HTML 里找出「值得跟着抓」的同站 JS/CSS：跨站的只记 host，不跟着跳过去抓
function collectSameSiteAssets(html, baseUrl, baseHost) {
  const urls = [];
  const seen = new Set();
  const tagRe = /<(script|link)\b([^>]*)>/gi;
  let match;

  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    // link 只认真正要加载的资源，别把 icon / manifest 也拉一遍
    if (tag === 'link' && !/rel\s*=\s*["'][^"']*(?:stylesheet|modulepreload|preload)[^"']*["']/i.test(attrs)) continue;

    const urlMatch = attrs.match(/(?:src|href)\s*=\s*["']([^"']+)["']/i);
    if (!urlMatch) continue;

    let resolved;
    try {
      resolved = new URL(urlMatch[1], baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
    // 只抓同站：绝不因为首页里写了一行第三方地址就去把第三方站点抓一遍
    if (registrableDomain(resolved.hostname) !== registrableDomain(baseHost)) continue;
    if (seen.has(resolved.href)) continue;

    seen.add(resolved.href);
    urls.push(resolved.href);
    if (urls.length >= SCAN_SUBRESOURCE_LIMIT) break;
  }

  return urls;
}

async function fetchTextWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': SCAN_UA }, signal: controller.signal });
    if (!res.ok) return '';
    const text = await res.text();
    return text.length > SCAN_TEXT_LIMIT ? text.slice(0, SCAN_TEXT_LIMIT) : text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// 扫描首页：首页 HTML + CSP 头 + 首页引用的同站 JS/CSS，三处一起抽 host。
// 仍然抓不到「只在运行时才请求」的域名（点开某个功能才出现的接口），这点页面必须如实说明。
async function scanHomepageDomains(domain) {
  const baseUrl = `https://${domain}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  let html;
  let headers;
  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': SCAN_UA, 'Accept': 'text/html,application/xhtml+xml' },
      signal: controller.signal
    });
    if (!res.ok) {
      return { error: `抓取 ${baseUrl} 返回 ${res.status}，无法扫描关联域名` };
    }
    headers = res.headers;
    html = await res.text();
  } catch (error) {
    return { error: `抓取 ${baseUrl} 失败：${error && error.message ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }

  const map = new Map();
  collectHosts(html, map, '首页', false);

  const csp = (headers.get('content-security-policy') || '') + ' ' +
    (headers.get('content-security-policy-report-only') || '');
  if (csp.trim()) collectCspHosts(csp, map);

  const assets = collectSameSiteAssets(html, baseUrl, domain);
  const texts = await Promise.all(assets.map(fetchTextWithTimeout));
  let scanned = 0;
  texts.forEach(text => {
    if (!text) return;
    scanned += 1;
    collectHosts(text, map, '脚本', true);
  });

  const domains = [...map.entries()]
    .sort((a, b) => b[1].sources.size - a[1].sources.size || b[1].count - a[1].count)
    .slice(0, 40)
    .map(([host, info]) => ({ domain: host, count: info.count, sources: [...info.sources] }));

  return { domains, scanned };
}

// 统一 JSON 响应；默认 no-store，只有明确要缓存的（如镜像搜索）才带 public 缓存头
function jsonResponse(obj, status = 200, cacheable = false) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheable && status === 200 ? 'public, max-age=600' : 'no-store'
    }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
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

// 浏览器端缓存策略：分级设置，回访时少发请求才是真正降低请求数的办法
const STATIC_CACHE = 'public, max-age=31536000, immutable'; // 带指纹的图片/字体/媒体
const ASSET_CACHE = 'public, max-age=86400, stale-while-revalidate=86400'; // 无指纹的 js/css
const HTML_CACHE = 'public, max-age=14400'; // 保持原有行为
const JSON_CACHE = 'public, max-age=300';

// DOCKER_BLOB_DIRECT: Docker 镜像层（blob）是否改成 302 直连源站 CDN。
// 一次 docker pull 的每个 layer 都是一次独立的 Worker 请求，现在是全部由 Worker 转发；
// 打开后客户端自己去 CDN 下载，Worker 只保留兜底，请求数能降一大截。
// 前提是客户端所在网络能直连该 CDN（Docker Hub 的分发域名多为 Cloudflare 系）。
// 打开前请先本机 docker pull 验证一次；不通就保持 false。
const DOCKER_BLOB_DIRECT = false;

// 排查用（临时）：只给这几个目标站打一行「来源指纹」。
// Workers Logs 免费只有 20 万事件/天，不能全量打；查清楚 gist 的请求方是谁之后这段可以整块删掉。
const TRACE_HOSTS = [
  'gist.github.com',
  'gist.githubusercontent.com',
  'raw.githubusercontent.com'
];

function logOriginFingerprint(targetHost, request) {
  if (!TRACE_HOSTS.includes(targetHost)) return;
  const ua = (request.headers.get('User-Agent') || '-').slice(0, 90);
  const ref = (request.headers.get('Referer') || '-').slice(0, 80);
  console.log(`ORIGIN host=${targetHost} ua=${ua} ref=${ref}`);
}

// 闪电 SVG 图标（Base64 编码）
const LIGHTNING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
</svg>`;

// 统一界面 HTML：密码通过后才渲染。GitHub 文件加速 / Docker 镜像 / 站点分组都在这一页，
// 没有独立的管理页入口，右上角也没有任何按钮。
const APP_PAGE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZQ-Proxy</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(LIGHTNING_SVG)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html {
      /* 手机横竖屏切换时别让 Safari 自动放大字号 */
      -webkit-text-size-adjust: 100%;
    }
    body {
      min-height: 100vh;
      /* 移动端地址栏收放时 100vh 会跳，dvh 更稳；不支持的浏览器忽略这行 */
      min-height: 100dvh;
      background: linear-gradient(to bottom right, #e6f0ff, #f0f8ff);
      color: #1a365d;
      /* 结果里的长命令/长域名一律换行，不许把页面撑出横向滚动条 */
      overflow-x: hidden;
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
    code {
      background: #eff6ff;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .result-text {
      word-break: break-all;
      overflow-wrap: break-word;
      padding: 0.5rem;
      border-radius: 0.25rem;
      background: #ebf8ff;
      color: #1d4ed8;
      font-size: 0.95rem;
    }
    /* 一条结果（镜像 / 搜索结果）：文字占满，按钮在右边；按钮太长或屏幕太窄时整体换行，
       而不是把按钮顶出视口。padding 用 JS 里的行内样式给。 */
    .res-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    /* 关键：flex 子项默认 min-width:auto，长命令不肯收缩，会把同一行的按钮挤出屏幕 */
    .res-line > .res-main {
      flex: 1 1 200px;
      min-width: 0;
    }
    .res-btn {
      flex: none;
      margin-left: auto;
    }
    .res-cmd {
      display: block;
      margin-top: 4px;
      color: #1d4ed8;
      font-family: monospace;
      font-size: 12px;
      /* 长命令按字符断行，否则会把行撑宽 */
      word-break: break-all;
      overflow-wrap: anywhere;
    }
    .tag-chip {
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 220px;
      overflow-y: auto;
      margin-top: 10px;
    }

    /* 手机端：收窄留白、字号降一档，触控目标保持够大 */
    @media (max-width: 640px) {
      .card {
        padding: 1rem;
        border-radius: 0.5rem;
      }
      h1 {
        font-size: 1.5rem;
      }
      h2 {
        font-size: 1.125rem;
      }
      .res-line {
        padding: 8px 0;
      }
      .res-btn {
        padding: 8px 14px;
      }
      .tag-chip {
        padding: 6px 10px;
        font-size: 13px;
      }
      /* 手机上让 tag 列表用视口高度，别被 220px 卡得太矮 */
      .tag-list {
        max-height: 45vh;
      }
    }
  </style>
</head>
<body>
  <div class="container mx-auto px-3 sm:px-4 py-6 sm:py-8">
    <h1 class="text-2xl sm:text-3xl font-bold mb-5 sm:mb-6 text-center text-gray-800">ZQ-Proxy</h1>

    <!-- GitHub 文件加速：域名 + 文件。密码用的是登录进来的那个，不再单独填 -->
    <div class="card p-4 sm:p-6 mb-4 sm:mb-6">
      <h2 class="text-lg sm:text-xl font-semibold mb-2 text-gray-700">GitHub 文件加速</h2>
      <p class="text-sm text-gray-500 mb-4">
        填域名和文件，拼出来的链接形如 <code>https://本站域名/密码/github.com/文件</code>；
        密码就是你现在登录用的这个，别人拿到链接直接就能下。
      </p>
      <div class="flex flex-col sm:flex-row gap-3">
        <input type="text" id="gh-domain" placeholder="域名（例如 github.com）"
               class="sm:w-56 sm:flex-none p-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <input type="text" id="gh-file" placeholder="文件（例如 user/repo/releases/download/v1/a.zip）"
               class="flex-grow p-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <button type="button" id="gh-btn" class="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition">
          生成
        </button>
      </div>
      <div id="gh-status" class="text-sm text-gray-500 mt-3"></div>
      <div id="gh-out" class="mt-3" style="display:none;">
        <div id="gh-link" class="result-text"></div>
        <div class="flex gap-2 mt-2">
          <button type="button" id="gh-copy" class="bg-gray-200 text-gray-800 px-3 py-1 rounded-lg hover:bg-gray-300 transition">复制链接</button>
          <button type="button" id="gh-open" class="bg-gray-200 text-gray-800 px-3 py-1 rounded-lg hover:bg-gray-300 transition">打开链接</button>
        </div>
      </div>
    </div>

    <!-- 镜像查询 -->
    <div class="card p-4 sm:p-6 mb-4 sm:mb-6">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <h2 class="text-lg sm:text-xl font-semibold text-gray-700" style="margin:0;">Docker 镜像查询</h2>
        <button type="button" id="cred-btn"
                style="padding:4px 12px;border:1px solid #93c5fd;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:13px;cursor:pointer;">
          Docker Hub 凭据
        </button>
      </div>
      <p class="text-sm text-gray-500 mb-4">
        输入镜像名 → 直接去镜像仓库取真实 tag 列表，再用下面的命令走本代理拉取。
        官方镜像写名字即可（<code>nginx</code>）；组织镜像必须写全 <code>组织/镜像</code>（如 <code>openlistteam/openlist</code>）；
        其他仓库写主机名（如 <code>ghcr.io/用户名/镜像</code>）。
        查不到时可以配置凭据，按关键词模糊搜（见旁边的「Docker Hub 凭据」）。
      </p>
      <div class="flex flex-col sm:flex-row gap-3">
        <input type="text" id="image-query" placeholder="镜像名（例如：nginx / bitnami/nginx / openlistteam/openlist）"
               class="flex-grow p-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <button type="button" id="image-btn" class="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition">
          查询
        </button>
      </div>
      <div id="image-status" class="text-sm text-gray-500 mt-3"></div>
      <div id="image-results" class="mt-3"></div>
    </div>

    <!-- 添加站点：填名称和域名，域名会自动带出关联域名 -->
    <div class="card p-4 sm:p-6 mb-4 sm:mb-6">
      <h2 class="text-lg sm:text-xl font-semibold mb-4 text-gray-700">添加站点</h2>
      <div class="flex flex-col sm:flex-row gap-3">
        <input type="text" id="site-name" placeholder="名称（例如：GitHub）"
               class="flex-grow p-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <input type="text" id="site-domain" placeholder="入口域名（例如：github.com）"
               class="flex-grow p-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
        <button type="button" id="find-btn" class="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition">
          查找关联域名
        </button>
      </div>
      <div id="find-status" class="text-sm text-gray-500 mt-3"></div>
      <form method="POST" id="add-form" class="mt-3" style="display:none;">
        <input type="hidden" name="action" value="add_site">
        <input type="hidden" name="name" id="add-name">
        <div id="find-results" class="border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto"></div>
        <button type="submit" class="mt-4 bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition">
          添加勾选的域名
        </button>
      </form>
    </div>

    <!-- 站点分组：每组一个折叠栏，默认折叠 -->
    <div class="card p-4 sm:p-6">
      <h2 class="text-lg sm:text-xl font-semibold mb-4 text-gray-700">站点分组</h2>
      <div class="space-y-2">
        {{groups_list}}
      </div>
    </div>

  </div>

  <!-- Docker Hub 凭据弹窗（默认隐藏，点标题旁的按钮才出现） -->
  <div id="cred-modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:50;align-items:center;justify-content:center;padding:16px;">
    <div style="background:#ffffff;border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:20px;box-shadow:0 20px 40px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <h3 style="margin:0;font-size:17px;font-weight:600;color:#374151;">Docker Hub 凭据</h3>
        <button type="button" id="cred-close"
                style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;color:#6b7280;font-size:13px;cursor:pointer;">
          关闭
        </button>
      </div>
      <p style="margin:12px 0;font-size:13px;color:#6b7280;line-height:1.6;">
        只影响关键词模糊搜索，不影响按镜像名查询 tag。
        未带凭据时 Docker Hub 的搜索接口按出口 IP 限流，而 Cloudflare Worker 的出口 IP 是共享的，
        所以搜索必然返回 429 —— 填上你自己的账号，这份额度才算你的。
      </p>
      <div id="cred-status" style="margin-bottom:14px;padding:10px;border-radius:8px;background:#f9fafb;font-size:13px;"></div>
      <form id="cred-form">
        <label for="cred-username" style="display:block;font-size:13px;color:#374151;margin-bottom:6px;">Docker Hub 用户名</label>
        <input type="text" id="cred-username" autocomplete="off" placeholder="登录 Docker Hub 的那个用户名"
               style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
        <label for="cred-token" style="display:block;font-size:13px;color:#374151;margin-bottom:6px;">Personal Access Token</label>
        <input type="password" id="cred-token" autocomplete="off" placeholder="dckr_pat_…"
               style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
        <p style="margin:8px 0 14px;font-size:12px;color:#9ca3af;line-height:1.6;">
          Token 在 Docker Hub → Account settings → Personal access tokens 里创建，权限给 Read-only 就够。
          它明文存在 KV 里（Workers 除了 KV 没有别的密钥存储），只有通过管理页认证才读得到；保存后不回显。
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" id="cred-clear"
                  style="padding:8px 14px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:13px;cursor:pointer;">
            清除凭据
          </button>
          <button type="submit" id="cred-save"
                  style="padding:8px 18px;border:none;border-radius:8px;background:#3b82f6;color:#ffffff;font-size:13px;cursor:pointer;">
            保存
          </button>
        </div>
      </form>
      <div id="cred-msg" style="margin-top:12px;font-size:13px;color:#374151;"></div>
    </div>
  </div>

  <script>
    const PWD = new URLSearchParams(location.search).get('pwd') || '';
    const SUFFIX = '{{proxy_suffix}}';

    // 注意：这段脚本整体是 JS 模板字符串，里面的 \. 会被 JS 当无效转义吞掉、变成「任意字符」，
    // 所以点要写成字符类 [.]。（同理所有正则都别用 \/ 转义，见下面两处。）
    function proxyOf(domain) {
      return domain.replace(/[.]/g, '-') + '-proxy.' + SUFFIX;
    }

    function makeLine() {
      const div = document.createElement('div');
      div.className = 'res-line';
      return div;
    }

    function makeText(value, style) {
      const span = document.createElement('span');
      span.textContent = value;
      span.style.cssText = style;
      return span;
    }

    async function findRelated() {
      const domain = document.getElementById('site-domain').value.trim();
      const status = document.getElementById('find-status');
      const box = document.getElementById('find-results');
      const form = document.getElementById('add-form');

      form.style.display = 'none';
      box.replaceChildren();

      if (!domain) {
        status.textContent = '请先输入入口域名';
        return;
      }

      status.textContent = '查找中…';
      let data;
      try {
        const res = await fetch('/api/find-domains?domain=' + encodeURIComponent(domain) + '&pwd=' + encodeURIComponent(PWD));
        data = await res.json();
        if (!res.ok) {
          status.textContent = '查找失败：' + (data.error || ('HTTP ' + res.status));
          return;
        }
      } catch (error) {
        status.textContent = '查找失败：' + error.message;
        return;
      }

      if (data.source === 'error') {
        // 扫描失败也照样把入口域名列出来，能加的先加上
        status.textContent = data.message;
      } else {
        status.textContent = data.source === 'bundle'
          ? '命中预置服务包，共 ' + data.domains.length + ' 个域名'
          : '扫描结果，共 ' + data.domains.length + ' 个 —— 已扫首页 + CSP 头 + ' + (data.scanned || 0) +
            ' 个同站脚本；只在操作时才请求的接口域名仍然抓不到';
      }

      data.domains.forEach(item => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'domains';
        checkbox.value = item.domain;
        checkbox.checked = true;
        checkbox.style.cssText = 'margin-top:3px;flex:none;';

        const info = document.createElement('span');
        info.appendChild(makeText(item.domain, 'display:block;color:#374151;font-weight:500;'));
        if (item.entry) {
          info.appendChild(makeText('入口域名', 'display:block;color:#6b7280;font-size:12px;'));
        } else if (item.group) {
          info.appendChild(makeText('已在「' + item.group + '」分组里', 'display:block;color:#6b7280;font-size:12px;'));
        } else {
          info.appendChild(makeText(proxyOf(item.domain), 'display:block;color:#6b7280;font-size:12px;'));
        }
        if (item.count) {
          const from = item.sources && item.sources.length ? '（来自 ' + item.sources.join('、') + '）' : '';
          info.appendChild(makeText('出现 ' + item.count + ' 次' + from, 'display:block;color:#9ca3af;font-size:12px;'));
        }

        const label = document.createElement('label');
        label.style.cssText = 'display:flex;gap:10px;align-items:flex-start;flex:1;cursor:pointer;';
        label.appendChild(checkbox);
        label.appendChild(info);

        const line = makeLine();
        line.appendChild(label);
        box.appendChild(line);
      });

      document.getElementById('add-name').value = document.getElementById('site-name').value.trim() || domain;
      form.style.display = 'block';
    }

    // 拉取命令 / 加速链接的公共前缀：本站域名 + 对外密码。
    // 两者都是「密码写在收件人拿到的链接里」，所以密码段必须在这里，不能只放在页面上。
    function pullPrefix() {
      return location.hostname + '/' + encodeURIComponent(PWD) + '/';
    }

    // ── GitHub 文件加速：域名 + 文件（密码取自当前登录，不再单独填） ──
    let githubUrl = '';

    function makeGithubUrl() {
      const domain = document.getElementById('gh-domain').value.trim()
        .replace(/^https?:[/]{2}/i, '').replace(/[/]+$/, '');
      const file = document.getElementById('gh-file').value.trim().replace(/^[/]+/, '');
      const status = document.getElementById('gh-status');
      const out = document.getElementById('gh-out');

      if (!domain || !file) {
        status.textContent = '域名和文件都要填';
        out.style.display = 'none';
        return;
      }

      githubUrl = 'https://' + pullPrefix() + domain + '/' + file;
      status.textContent = '链接已生成，格式：本站域名/密码/域名/文件';
      document.getElementById('gh-link').textContent = githubUrl;
      out.style.display = 'block';
      copyWithFeedback(githubUrl, document.getElementById('gh-copy'));
    }

    let imageBusy = false;

    function makeButton(label, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = 'res-btn';
      button.style.cssText = 'padding:6px 12px;border:1px solid #93c5fd;border-radius:8px;color:#1d4ed8;background:#eff6ff;cursor:pointer;';
      button.onclick = onClick;
      return button;
    }

    function copyWithFeedback(text, button) {
      const label = button.textContent;
      navigator.clipboard.writeText(text).then(
        () => {
          button.textContent = '已复制';
          setTimeout(() => { button.textContent = label; }, 1500);
        },
        () => { button.textContent = '复制失败'; }
      );
    }

    // 拉取命令里的镜像部分：Docker Hub 官方镜像在仓库里带 library/ 前缀，去掉；
    // 其他仓库（ghcr.io/… 等）必须留主机名，否则 docker 会跑去 Hub 找一个不存在的名字。
    function pullTarget(host, repo) {
      const short = repo.indexOf('library/') === 0 ? repo.slice(8) : repo;
      return (host === 'registry-1.docker.io' ? '' : host + '/') + short;
    }

    // 镜像名查询的结果：一条命令 + 真实 tag 折叠栏（默认折叠）
    function renderImage(box, data) {
      const target = pullTarget(data.host, data.repo);
      const isOfficial = data.host === 'registry-1.docker.io' && data.repo.indexOf('library/') === 0;
      const tags = data.tags || [];
      // 用户自己写的 tag 优先（nginx:1.25 这种别被换成 latest），其次 latest，最后取上游第一个
      let tag = (data.requestedTag && tags.indexOf(data.requestedTag) >= 0) ? data.requestedTag
        : (tags.indexOf('latest') >= 0 ? 'latest' : (tags[0] || 'latest'));

      const command = makeText('', '');
      command.className = 'res-cmd';
      const refresh = () => { command.textContent = 'docker pull ' + pullPrefix() + target + ':' + tag; };
      refresh();

      const info = document.createElement('div');
      info.className = 'res-main';
      info.appendChild(makeText(target + (isOfficial ? ' · 官方镜像' : ''),
        'display:block;color:#374151;font-weight:500;'));
      info.appendChild(makeText('来源仓库 ' + data.host + ' · 可用 tag ' + tags.length + ' 个'
        + (data.truncated ? '（上游还有更多，这里只取了前 500 个）' : ''),
        'display:block;color:#9ca3af;font-size:12px;'));
      info.appendChild(command);

      const copy = makeButton('复制命令', () => copyWithFeedback(command.textContent, copy));

      const line = makeLine();
      line.appendChild(info);
      line.appendChild(copy);
      box.appendChild(line);

      if (tags.length === 0) return;

      const details = document.createElement('details');
      details.style.cssText = 'margin-top:8px;border:1px solid #e5e7eb;border-radius:8px;padding:10px;';
      const summary = document.createElement('summary');
      summary.textContent = '可用 tag（' + tags.length + ' 个）';
      summary.style.cssText = 'cursor:pointer;color:#374151;font-size:14px;';
      details.appendChild(summary);

      const list = document.createElement('div');
      list.className = 'tag-list';

      tags.forEach(name => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = name;
        const active = name === tag;
        chip.className = 'tag-chip';
        chip.style.cssText = 'border:1px solid ' + (active ? '#1d4ed8' : '#e5e7eb') +
          ';background:' + (active ? '#eff6ff' : '#ffffff') + ';color:#374151;';
        chip.onclick = () => {
          tag = name;
          refresh();
          Array.prototype.forEach.call(list.children, child => {
            child.style.borderColor = '#e5e7eb';
            child.style.background = '#ffffff';
          });
          chip.style.borderColor = '#1d4ed8';
          chip.style.background = '#eff6ff';
        };
        list.appendChild(chip);
      });

      details.appendChild(list);
      box.appendChild(details);
    }

    // 关键词模糊搜的结果。每条都给一条能直接用的 pull 命令，
    // 「查 tag」会拿这个名字再走一次精确查询（走的是 registry，不是搜索）。
    function renderList(box, data) {
      data.results.forEach(item => {
        const command = 'docker pull ' + pullPrefix() +
          pullTarget('registry-1.docker.io', item.name) + ':latest';

        const info = document.createElement('div');
        info.className = 'res-main';
        info.appendChild(makeText(item.name + (item.official ? ' · 官方镜像' : ''),
          'display:block;color:#374151;font-weight:500;'));
        if (item.desc) {
          info.appendChild(makeText(item.desc, 'display:block;color:#6b7280;font-size:12px;'));
        }
        info.appendChild(makeText('★ ' + item.stars + (item.pulls ? ' · 拉取 ' + item.pulls : ''),
          'display:block;color:#9ca3af;font-size:12px;'));
        const commandText = makeText(command, '');
        commandText.className = 'res-cmd';
        info.appendChild(commandText);

        const tagsButton = makeButton('查 tag', () => {
          document.getElementById('image-query').value = item.name;
          searchImage();
        });
        const copy = makeButton('复制命令', () => copyWithFeedback(command, copy));

        const line = makeLine();
        line.appendChild(info);
        line.appendChild(tagsButton);
        line.appendChild(copy);
        box.appendChild(line);
      });
    }

    async function searchImage() {
      if (imageBusy) return;

      const query = document.getElementById('image-query').value.trim();
      const status = document.getElementById('image-status');
      const box = document.getElementById('image-results');
      const button = document.getElementById('image-btn');

      box.replaceChildren();
      if (!query) {
        status.textContent = '请输入镜像名';
        return;
      }

      // 请求在飞的时候禁止再发一次：上游对连续请求不友好，这里防一手
      imageBusy = true;
      button.disabled = true;
      status.textContent = '查询中…';

      let data;
      let httpStatus = 0;
      try {
        const res = await fetch('/api/image-search?q=' + encodeURIComponent(query) +
          '&pwd=' + encodeURIComponent(PWD));
        httpStatus = res.status;
        data = await res.json();
      } catch (error) {
        status.textContent = '查询失败：' + error.message;
        return;
      } finally {
        imageBusy = false;
        button.disabled = false;
      }

      if (httpStatus !== 200) {
        // 错误要分行：主因、说明、上游原文各自一行，别挤成一句读不出来
        status.replaceChildren();
        status.appendChild(makeText('查询失败：' + (data.error || ('HTTP ' + httpStatus)),
          'display:block;color:#b91c1c;'));
        if (data.detail) {
          status.appendChild(makeText(data.detail, 'display:block;color:#6b7280;margin-top:4px;'));
        }
        if (data.failures && data.failures.length) {
          status.appendChild(makeText('上游返回：' + data.failures.join('；'),
            'display:block;color:#9ca3af;font-size:12px;margin-top:4px;'));
        }
        return;
      }

      if (data.kind === 'image') {
        status.textContent = '镜像存在，下面是仓库里的真实 tag';
        renderImage(box, data);
        return;
      }

      if (data.kind === 'list') {
        status.textContent = '按关键词「' + data.query + '」搜到 ' + data.count + ' 个，显示前 '
          + data.results.length + ' 个 —— 点「查 tag」能看到某个镜像的真实 tag';
        renderList(box, data);
        return;
      }

      status.textContent = '没有结果';
    }

    document.getElementById('find-btn').addEventListener('click', findRelated);
    document.getElementById('site-domain').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); findRelated(); }
    });
    document.getElementById('image-btn').addEventListener('click', searchImage);
    document.getElementById('image-query').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); searchImage(); }
    });

    // GitHub 文件加速。密码用的是 URL 里的 PWD（确认一下确实带着，缺了就说是没登录）
    document.getElementById('gh-btn').addEventListener('click', makeGithubUrl);
    document.getElementById('gh-copy').addEventListener('click', () => {
      copyWithFeedback(githubUrl, document.getElementById('gh-copy'));
    });
    document.getElementById('gh-open').addEventListener('click', () => {
      if (githubUrl) window.open(githubUrl, '_blank');
    });
    document.getElementById('gh-file').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); makeGithubUrl(); }
    });

    // ── Docker Hub 凭据弹窗 ──
    // 认证只认 URL 里的 pwd，所以这几个请求都得把 PWD 带上
    const CRED_URL = '/api/docker-credential?pwd=' + encodeURIComponent(PWD);
    const credModal = document.getElementById('cred-modal');
    const credMsg = document.getElementById('cred-msg');
    let credState = { configured: false, username: '' };

    function renderCredState() {
      const box = document.getElementById('cred-status');
      box.replaceChildren();
      box.appendChild(makeText(credState.configured
        ? '已配置：' + credState.username + '（关键词模糊搜已启用）'
        : '未配置（只能按镜像名查询 tag，查不到时不会去搜索）',
        'display:block;font-weight:500;color:' + (credState.configured ? '#15803d' : '#b45309') + ';'));
    }

    async function loadCredState() {
      try {
        const res = await fetch(CRED_URL);
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.configured !== 'boolean') return;
        credState = data;
        renderCredState();
        // 只回填用户名，PAT 一律不回显
        document.getElementById('cred-username').value = data.configured ? data.username : '';
      } catch (error) {
        // 拉不到状态不影响用，保持默认文案即可，不弹错
      }
    }

    function openCredModal() {
      credMsg.textContent = '';
      credModal.style.display = 'flex';
      renderCredState();
      loadCredState();
      document.getElementById('cred-username').focus();
    }

    function closeCredModal() {
      credModal.style.display = 'none';
      document.getElementById('cred-token').value = '';
    }

    document.getElementById('cred-btn').addEventListener('click', openCredModal);
    document.getElementById('cred-close').addEventListener('click', closeCredModal);
    credModal.addEventListener('click', event => { if (event.target === credModal) closeCredModal(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && credModal.style.display !== 'none') closeCredModal();
    });

    document.getElementById('cred-form').addEventListener('submit', async event => {
      event.preventDefault();
      const username = document.getElementById('cred-username').value.trim();
      const token = document.getElementById('cred-token').value.trim();
      if (!username || !token) {
        credMsg.textContent = '用户名和 Personal Access Token 都要填';
        return;
      }

      const save = document.getElementById('cred-save');
      save.disabled = true;
      credMsg.textContent = '保存中…';
      try {
        const res = await fetch(CRED_URL, {
          method: 'POST',
          body: new URLSearchParams({ action: 'save', username, token })
        });
        const data = await res.json();
        if (!res.ok) {
          credMsg.textContent = '保存失败：' + (data.error || ('HTTP ' + res.status));
          return;
        }
        credState = data;
        renderCredState();
        document.getElementById('cred-token').value = '';   // 存完就把 PAT 从输入框里清掉
        credMsg.textContent = '已保存，现在可以直接输关键词搜了';
      } catch (error) {
        credMsg.textContent = '保存失败：' + error.message;
      } finally {
        save.disabled = false;
      }
    });

    document.getElementById('cred-clear').addEventListener('click', async () => {
      credMsg.textContent = '清除中…';
      try {
        const res = await fetch(CRED_URL, {
          method: 'POST',
          body: new URLSearchParams({ action: 'clear' })
        });
        const data = await res.json();
        if (!res.ok) {
          credMsg.textContent = '清除失败：' + (data.error || ('HTTP ' + res.status));
          return;
        }
        credState = data;
        renderCredState();
        document.getElementById('cred-username').value = '';
        credMsg.textContent = '已清除，关键词模糊搜已关闭';
      } catch (error) {
        credMsg.textContent = '清除失败：' + error.message;
      }
    });
  </script>
</body>
</html>
`;

// Docker registry 匿名 token 缓存（isolate 级，尽力而为）。
// 不加这个的话，每次 401 都要额外往返一次 realm 换 token，容器拉取时会被放大很多次。
const tokenCache = new Map();

async function handleToken(realm, service, scope) {
  const cacheKey = `${realm}|${service}|${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30000) {
    return cached.token;
  }

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
    const ttlSeconds = Number(tokenData.expires_in) || 300;
    // 简单容量保护，避免 isolate 长时间存活时无限增长
    if (tokenCache.size > 200) {
      tokenCache.clear();
    }
    tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
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

// 从代理路径里剥掉第一段密码：
//   <密码>/github.com/user/repo/...  → /github.com/user/repo/...
//   <密码>/nginx（docker 短名）       → /nginx
// 路径里没有段（docker 的 /v2/ 版本探测）就原样放行，交给后面的解析去处理。
function stripPassword(path, savedPassword) {
  const segments = path.split('/').filter(part => part);
  if (segments.length === 0) return { ok: true, path };

  const raw = segments.shift();
  let provided;
  try {
    provided = decodeURIComponent(raw);
  } catch {
    provided = raw;
  }

  if (!savedPassword || provided !== savedPassword) return { ok: false };
  return { ok: true, path: '/' + segments.join('/') };
}

async function handleRequest1js(request, redirectCount = 0) {
  const MAX_REDIRECTS = 5; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

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

  // registry 版本探测：docker pull 之前客户端会先打 /v2/，这一步没有路径段、也不该带密码，
  // 按 registry 规范回 200，否则 docker 在握手阶段就报错，根本走不到真正的拉取。
  if (isV2Request && !path) {
    return new Response('{}', {
      status: 200,
      headers: { 'Docker-Distribution-API-Version': 'registry/2.0', 'Content-Type': 'application/json' }
    });
  }

  // 路径第一段必须是对外密码：/<密码>/<目标域名>/<文件>、/v2/<密码>/<镜像>/...
  // 密码就是进界面的那个，所以「拿得到链接」等于「被允许用这个代理」。
  const stripped = stripPassword(path, await getAdminPassword());
  if (!stripped.ok) {
    return isV2Request
      ? new Response('unauthorized: authentication required\n', { status: 401 })
      : new Response('密码不正确或缺失。加速链接的格式是 https://<本站域名>/<密码>/<目标域名>/<文件>\n', { status: 401 });
  }
  path = stripped.path;

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

  // 排查用：记录目标站请求的来源指纹
  logOriginFingerprint(targetDomain, request);

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

        // 直连模式：blob 不再由 Worker 转发，直接把 302 交回客户端去源站 CDN 下载。
        // 一次 pull 的每个 layer 都是一次独立 Worker 请求，打开后能省掉绝大部分。
        if (DOCKER_BLOB_DIRECT) {
          console.log('Blob direct mode: handing redirect back to client');
          return new Response(null, {
            status: 302,
            headers: {
              'Location': redirectUrl,
              'Cache-Control': 'no-store'
            }
          });
        }

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
  event.respondWith(handleRequest(event.request, event));
});

// 管理员密码的内存缓存。现在每个代理请求都要拿它校验路径里的密码段，
// 不缓存等于每个请求都吃一次 KV 读，10 万读/天的免费额度会被镜像拉取直接打满。
let cachedAdminPassword;
let cachedAdminPasswordAt = 0;
const ADMIN_PASSWORD_TTL_MS = 60000;

// 从KV获取管理员密码
async function getAdminPassword() {
  const now = Date.now();
  if (cachedAdminPassword !== undefined && now - cachedAdminPasswordAt < ADMIN_PASSWORD_TTL_MS) {
    return cachedAdminPassword;
  }

  let value = null;
  const kv = getKV();
  if (kv) {
    try {
      value = await kv.get('admin_password');
    } catch (error) {
      console.error('Error getting admin password from KV:', error && error.message ? error.message : String(error));
    }
  }

  cachedAdminPassword = value || null;
  cachedAdminPasswordAt = now;
  return cachedAdminPassword;
}

// 保存管理员密码到KV
async function saveAdminPassword(password) {
  const kv = getKV();
  if (!kv) {
    console.error('KV binding missing: 管理员密码无法保存（面板 → 设置 → 绑定，KV 命名空间的变量名填 Proxy）');
    return false;
  }
  try {
    await kv.put('admin_password', password);
    cachedAdminPassword = password;
    cachedAdminPasswordAt = Date.now();
    return true;
  } catch (error) {
    console.error('Error saving admin password to KV:', error && error.message ? error.message : String(error));
  }
  return false;
}

// 认证检查：请求 URL 上的 pwd 必须等于已保存的密码。
// 密码同时是代理链接里的那一段，所以这里校验通过就意味着「这个人知道密码」。
async function isAuthenticated(request) {
  const savedPassword = await getAdminPassword();
  if (!savedPassword) return false;

  const url = new URL(request.url);
  return url.searchParams.get('pwd') === savedPassword;
}

// 渲染主界面
function renderAppPage(groups, proxy_suffix) {
  // 每个分组一个折叠栏（<details> 默认就是收起的），展开才看得到组里的域名
  const groupsList = groups.map(group => {
    const domainsRows = group.domains.map(domain => {
      const proxyDomain = domain.replace(/\./g, '-') + '-proxy.' + proxy_suffix;
      return `
        <div class="domain-item flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-gray-200 rounded-lg">
          <div class="flex-1 mb-2 sm:mb-0">
            <div class="text-gray-700 font-medium">${domain}</div>
            <div class="text-gray-500 text-sm mt-1">
              代理域名: <a href="https://${proxyDomain}" target="_blank" class="text-blue-500 hover:underline">${proxyDomain}</a>
            </div>
          </div>
          <form method="POST" class="inline">
            <input type="hidden" name="domain" value="${domain}">
            <input type="hidden" name="name" value="${group.name}">
            <input type="hidden" name="action" value="remove_domain">
            <button type="submit" class="text-red-500 hover:text-red-700 px-3 py-1 rounded hover:bg-red-50">
              删除
            </button>
          </form>
        </div>
      `;
    }).join('');

    return `
      <details class="border border-gray-200 rounded-lg">
        <summary class="cursor-pointer p-3">
          <span class="text-gray-700 font-medium">${group.name}</span>
          <span class="text-gray-500 text-sm ml-2">${group.domains.length} 个域名</span>
        </summary>
        <div class="p-3 space-y-2 border-t border-gray-200">
          ${domainsRows}
          <form method="POST">
            <input type="hidden" name="name" value="${group.name}">
            <input type="hidden" name="action" value="remove_group">
            <button type="submit" class="text-red-500 hover:text-red-700 px-3 py-1 rounded hover:bg-red-50 text-sm">
              删除整个分组
            </button>
          </form>
        </div>
      </details>
    `;
  }).join('');

  // 替换模板中的占位符
  return APP_PAGE_HTML
    .replace('{{groups_list}}', groupsList)
    .replace('{{proxy_suffix}}', proxy_suffix);
}

// 渲染密码设置页面
function renderPasswordSetupPage() {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>设置访问密码 - ZQ-Proxy</title>
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
        <h1 class="text-2xl font-bold text-center mb-6">设置访问密码</h1>
        <p class="text-gray-600 mb-4">首次使用，请先设一个访问密码。它既是进界面的密码，也是加速链接里的那一段。</p>
        <form method="POST" action="/">
          <input type="hidden" name="action" value="set_password">
          <div class="mb-4">
            <label for="password" class="block text-gray-700 mb-2">访问密码（至少 6 位）</label>
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
      <title>请输入密码 - ZQ-Proxy</title>
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
        <h1 class="text-2xl font-bold text-center mb-6">ZQ-Proxy</h1>
        <p class="text-gray-600 mb-4">请输入访问密码。</p>
        <form method="GET" action="/">
          <div class="mb-6">
            <label for="pwd" class="block text-gray-700 mb-2">访问密码</label>
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

// 主界面处理函数：入口 / 和 /admin 都走这里，没有单独的「管理页」。
// 没设密码先设密码，密码不对只给登录页，认证通过才渲染界面。
async function handleAppRequest(request) {
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
          // 密码设好了，直接带密码进界面
          return Response.redirect('/?pwd=' + encodeURIComponent(password), 302);
        } else {
          return new Response('密码设置失败：KV 没绑定或写入出错（面板 → 设置 → 绑定，变量名填 Proxy）', { status: 500 });
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
  
  // 密码不对：页面给登录页，接口给 401（前端才分得清「密码不对」和「查不到」）
  if (!await isAuthenticated(request)) {
    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: '密码不正确或已失效' }, 401);
    }
    return htmlResponse(renderLoginPage());
  }

  // 查找关联域名（页面 JS 调用）
  if (url.pathname === '/api/find-domains') {
    return jsonResponse(await findRelatedDomains(url.searchParams.get('domain') || ''));
  }

  // Docker Hub 凭据（界面弹窗读写）。
  // 单独走这里并直接 return，不落到下面那次必然发生的 saveSiteGroups ——
  // KV 免费额度只有 1000 写/天，不该为存个凭据白写一次站点分组。
  if (url.pathname === '/api/docker-credential') {
    if (request.method === 'GET') {
      const credential = await getDockerCredential();
      return jsonResponse({ configured: !!credential, username: credential ? credential.username : '' });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: '只支持 GET / POST' }, 405);
    }

    const body = await request.formData();
    if (String(body.get('action') || '') === 'clear') {
      await saveDockerCredential(null);
      return jsonResponse({ configured: false, username: '' });
    }

    const username = String(body.get('username') || '').trim();
    const token = String(body.get('token') || '').trim();
    if (!username || !token) {
      return jsonResponse({ error: '用户名和 Personal Access Token 都需要填写' }, 400);
    }
    if (!await saveDockerCredential({ username, token })) {
      return jsonResponse({ error: '保存失败：KV 没绑定或写入出错（面板 → 设置 → 绑定，变量名填 Proxy）' }, 500);
    }
    return jsonResponse({ configured: true, username });
  }

  if (request.method === 'GET') {
    // 显示主界面
    const groups = await getSiteGroups();
    return htmlResponse(renderAppPage(groups, getProxySuffix(request.headers.get('Host') || url.host)));
  } else if (request.method === 'POST') {
    // 处理站点分组更新
    try {
      const formData = await request.formData();
      const action = formData.get('action');
      const name = formData.get('name');

      const currentGroups = await getSiteGroups();
      let updatedGroups = currentGroups.map(group => ({ name: group.name, domains: group.domains.slice() }));

      if (action === 'add_site') {
        const domains = formData.getAll('domains')
          .map(value => String(value).trim().toLowerCase())
          .filter(Boolean);
        if (!name || domains.length === 0) {
          return new Response('名称和至少一个域名是必填的', { status: 400 });
        }
        const target = updatedGroups.find(group => group.name === name);
        if (target) {
          domains.forEach(domain => {
            if (!target.domains.includes(domain)) target.domains.push(domain);
          });
        } else {
          updatedGroups.push({ name, domains });
        }
      } else if (action === 'remove_domain') {
        const domain = formData.get('domain');
        const target = updatedGroups.find(group => group.name === name);
        if (target) {
          target.domains = target.domains.filter(d => d !== domain);
          if (target.domains.length === 0) {
            updatedGroups = updatedGroups.filter(group => group.name !== name);
          }
        }
      } else if (action === 'remove_group') {
        updatedGroups = updatedGroups.filter(group => group.name !== name);
      }

      // 保存到KV
      await saveSiteGroups(updatedGroups);

      // 重定向回主界面
      return Response.redirect(url.origin + '/?pwd=' + encodeURIComponent(url.searchParams.get('pwd') || ''), 302);
    } catch (error) {
      console.error('Error processing admin request:', error);
      return new Response('Error processing request', { status: 500 });
    }
  }
  
  return new Response('Method not allowed', { status: 405 });
}

// ── 镜像查询 ────────────────────────────────────────────────────────────────
//
// ① 精确镜像名：GET https://<仓库>/v2/<repo>/tags/list
//    上游就是本 Worker 一直在代理的 registry-1.docker.io / ghcr.io / quay.io 等，
//    401 时按 WWW-Authenticate 换匿名 token 即可，不需要任何账号，也不碰 hub.docker.com。
//
// ② 关键词模糊搜（可选）：hub.docker.com 的搜索端点，只有在管理页配了 Docker Hub 凭据时才走。
//    为什么必须配凭据：这两个端点是 Docker Hub 网站自用的未公开接口，未鉴权时按出口 IP 限流，
//    而 Cloudflare Worker 的出口 IP 是共享的 —— 线上实测未带凭据时 v2 与 v4 同时 429
//    （Retry-After: 60，正文 {"detail":"Rate limit exceeded"}），重试和缓存都救不回来。
//    带上账号凭据后，限流桶从「共享 IP」变成「你自己的账号」，这条路才有可能通。
//    换 token 按官方文档：POST https://hub.docker.com/v2/auth/token
//    body {"identifier": 用户名, "secret": PAT} → {"access_token"}（JWT，10 分钟有效），随后用 Bearer 带。

// 允许被查询的仓库主机，写死在这里：用户输入只影响仓库名，不会变成 Worker 去打任意地址
const IMAGE_REGISTRY_HOSTS = ['registry-1.docker.io', 'ghcr.io', 'quay.io', 'gcr.io', 'registry.k8s.io'];

// ── Docker Hub 凭据（用户名 + PAT，存 KV）───────────────────────────────────
// 只用于上面 ② 的关键词搜索；① 的精确镜像名查询不需要它，所以没配也能正常用。
// 注意：KV 里是明文存的（Workers 除了 KV 没有别的密钥存储），这点在管理页弹窗里也写明。
const DOCKER_CREDENTIAL_KEY = 'docker_hub_credential';

// 凭据读缓存（isolate 级 60 秒），别让每次查询都花掉一次 KV 读
let cachedDockerCredential;
let cachedDockerCredentialAt = 0;
const DOCKER_CREDENTIAL_TTL_MS = 60000;

async function getDockerCredential() {
  const now = Date.now();
  if (cachedDockerCredential !== undefined && now - cachedDockerCredentialAt < DOCKER_CREDENTIAL_TTL_MS) {
    return cachedDockerCredential;
  }

  let value = null;
  const kv = getKV();
  if (kv) {
    try {
      const raw = await kv.get(DOCKER_CREDENTIAL_KEY);
      if (raw) value = JSON.parse(raw);
    } catch (error) {
      console.error('读取 Docker Hub 凭据失败:', error && error.message ? error.message : String(error));
    }
  }

  cachedDockerCredential = value;
  cachedDockerCredentialAt = now;
  return value;
}

// credential 传 null 表示清除
async function saveDockerCredential(credential) {
  const kv = getKV();
  if (!kv) {
    console.error('KV binding missing: Docker Hub 凭据无法保存（面板 → 设置 → 绑定，KV 命名空间的变量名填 Proxy）');
    return false;
  }
  try {
    if (credential) await kv.put(DOCKER_CREDENTIAL_KEY, JSON.stringify(credential));
    else await kv.delete(DOCKER_CREDENTIAL_KEY);
    cachedDockerCredential = credential || null;
    cachedDockerCredentialAt = Date.now();
    return true;
  } catch (error) {
    console.error('保存 Docker Hub 凭据失败:', error && error.message ? error.message : String(error));
    return false;
  }
}

// Hub 的 JWT 只有 10 分钟，这里缓存 8 分钟
let cachedHubToken = null;

async function getHubToken(credential) {
  if (cachedHubToken && cachedHubToken.username === credential.username &&
      cachedHubToken.expiresAt > Date.now() + 60000) {
    return { token: cachedHubToken.token };
  }

  let response;
  try {
    response = await fetch('https://hub.docker.com/v2/auth/token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'ZQ-Proxy/1.0' },
      body: JSON.stringify({ identifier: credential.username, secret: credential.token })
    });
  } catch (error) {
    return { error: `请求失败：${error && error.message ? error.message : String(error)}` };
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
    return { error: `被拒（HTTP ${response.status}）${body}` };
  }

  const data = await response.json().catch(() => null);
  const token = data && data.access_token;
  if (!token) return { error: '响应里没有 access_token' };

  cachedHubToken = { username: credential.username, token, expiresAt: Date.now() + 8 * 60 * 1000 };
  return { token };
}

// 关键词搜索端点，按顺序试；两个都失败时把各自的状态一起报出来。
// v4 是 hub.docker.com 前端和 Docker 官方 MCP 在用的 Search API（type=image 挡掉插件/扩展这类
// docker pull 拉不动的结果，不然给出来就是条假命令）；v2 是老端点，留着当第二跳。
const HUB_SEARCH_ENDPOINTS = [
  {
    label: 'search/v4',
    build: query => 'https://hub.docker.com/api/search/v4?custom_boosted_results=true&type=image&query=' +
      encodeURIComponent(query) + '&size=25'
  },
  {
    label: 'search/repositories(v2)',
    build: query => 'https://hub.docker.com/v2/search/repositories/?query=' +
      encodeURIComponent(query) + '&page=1&page_size=25'
  }
];

const HUB_SEARCH_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'ZQ-Proxy/1.0'
};

// 关键词搜索。返回 { results, count } 或 { error }
async function searchHubByKeyword(keyword, credential) {
  const auth = await getHubToken(credential);
  if (auth.error) return { error: `Docker Hub 凭据不可用：${auth.error}` };

  const failures = [];

  for (const endpoint of HUB_SEARCH_ENDPOINTS) {
    let upstream;
    try {
      upstream = await fetch(endpoint.build(keyword), {
        headers: { ...HUB_SEARCH_HEADERS, 'Authorization': `Bearer ${auth.token}` }
      });
    } catch (error) {
      failures.push(`${endpoint.label}: ${error && error.message ? error.message : String(error)}`);
      continue;
    }

    if (!upstream.ok) {
      // 429 时把 Retry-After、限额头和上游正文一起带回去：限流原因要看得见，不静默吞掉
      const retryAfter = upstream.headers.get('retry-after');
      const limit = upstream.headers.get('x-ratelimit-limit');
      const remaining = upstream.headers.get('x-ratelimit-remaining');
      const body = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120);
      failures.push(`${endpoint.label}: HTTP ${upstream.status}` +
        (retryAfter ? `（Retry-After: ${retryAfter}）` : '') +
        (limit ? `（限额 ${limit}/分钟，剩余 ${remaining}）` : '') +
        (body ? ` ${body}` : ''));
      continue;
    }

    const data = await upstream.json().catch(() => null);
    if (!data) { failures.push(`${endpoint.label}: 返回的不是 JSON`); continue; }
    if (data.error) { failures.push(`${endpoint.label}: ${data.error}`); continue; }

    // v4 用 name / badge / pull_count(字符串)，v2 用 repo_name / is_official / pull_count(数字)，两种都认
    const results = (data.results || []).map(item => ({
      name: item.name || item.repo_name || '',
      desc: item.short_description || '',
      stars: Number(item.star_count) || 0,
      pulls: item.pull_count === undefined || item.pull_count === null ? '' : String(item.pull_count),
      official: item.badge === 'official' || item.is_official === true
    })).filter(item => item.name);

    const total = data.total !== undefined && data.total !== null ? data.total : (data.count || 0);
    return { results, count: total };
  }

  return { error: 'Docker Hub 搜索失败（已带凭据）—— ' + failures.join('；') };
}

// 解析用户输入 → { host, repo, repos, tag }；不是合法镜像名时返回 { error }
// tag 是用户自己写的那种（nginx:1.25），返回去是为了让页面预选它，而不是悄悄换成 latest
function parseImageInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { error: '缺少查询词' };
  if (raw.length > 128) return { error: '长度超过 128 字符' };

  // 去掉协议、末尾斜杠、digest，再把最后一个冒号之后的部分当 tag 摘出来
  const stripped = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').split('@')[0];
  const cut = stripped.lastIndexOf(':') > stripped.lastIndexOf('/') ? stripped.lastIndexOf(':') : -1;
  // 仓库名统一小写：镜像仓库里不存在大写仓库名，而 docker pull 见了大写会直接报错，
  // 别生成出一条拉不动的命令。tag 是大小写敏感的，不动它。
  const name = (cut === -1 ? stripped : stripped.slice(0, cut)).toLowerCase();
  const tag = cut === -1 ? '' : stripped.slice(cut + 1);

  // 每段都以字母数字开头，顺带挡掉 .. 和空段（host 是写死的，这里只是别拼出怪路径）
  // searchable：这种失败说明「输入不像镜像名」，那它更可能是个关键词，值得再去模糊搜一次
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name)) {
    return { error: '不是合法镜像名', searchable: true };
  }
  if (tag && !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag)) {
    return { error: '不是合法镜像名', searchable: true };
  }

  const slash = name.indexOf('/');
  const first = slash === -1 ? '' : name.slice(0, slash).toLowerCase();
  let host = 'registry-1.docker.io';
  let repo = name;

  if (first && (first.includes('.') || first.includes(':'))) {
    host = (first === 'docker.io' || first === 'index.docker.io') ? 'registry-1.docker.io' : first;
    repo = name.slice(slash + 1);
  }
  if (!IMAGE_REGISTRY_HOSTS.includes(host)) {
    return { error: `不支持查询 ${host}，只支持 ${IMAGE_REGISTRY_HOSTS.join(' / ')}` };
  }

  // Docker Hub 的官方镜像在仓库里叫 library/xxx，用户写 nginx 或 library/nginx 都认
  const repos = host === 'registry-1.docker.io' && !repo.includes('/')
    ? ['library/' + repo, repo]
    : [repo];
  return { host, repo, repos: [...new Set(repos)], tag };
}

// 取某个仓库的 tag 列表。401 时按 WWW-Authenticate 换匿名 token 再来一次
// （复用容器路径那个 handleToken，它自带 isolate 级缓存）。
// n=500 是上游单页上限，再多它会给 Link 头分页，这里只取第一页并如实标注。
async function fetchRepoTags(host, repo) {
  const target = `https://${host}/v2/${repo}/tags/list?n=500`;
  const headers = { 'Accept': 'application/json', 'User-Agent': 'ZQ-Proxy/1.0' };

  let response;
  try {
    response = await fetch(target, { headers });
  } catch (error) {
    return { error: `请求失败：${error && error.message ? error.message : String(error)}` };
  }

  if (response.status === 401) {
    const challenge = response.headers.get('WWW-Authenticate') || '';
    const match = challenge.match(/realm="([^"]+)"(?:,\s*service="([^"]*)")?(?:,\s*scope="([^"]*)")?/);
    if (!match) return { error: '上游要求鉴权但没有给出 realm' };

    const token = await handleToken(match[1], match[2] || host, match[3] || `repository:${repo}:pull`);
    if (!token) return { error: '换匿名 token 失败' };

    try {
      response = await fetch(target, { headers: { ...headers, 'Authorization': `Bearer ${token}` } });
    } catch (error) {
      return { error: `重试失败：${error && error.message ? error.message : String(error)}` };
    }
  }

  if (response.status === 404) return { missing: true };
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const data = await response.json().catch(() => null);
  if (!data) return { error: '返回的不是 JSON' };

  return {
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    truncated: !!response.headers.get('Link')
  };
}

// 镜像查询入口：按镜像名去 registry 要真实 tag 列表，查不到就给出确切原因。
// 结果用 Cache API 缓存（缓存头由 jsonResponse 的 cacheable 参数给），重复查询不出网，
// 也不占 KV 那 1000 写/天的额度。
async function handleImageSearch(request, ctx) {
  const url = new URL(request.url);

  // 这个接口会拿 Worker 去问 registry，和界面一样要密码
  if (!await isAuthenticated(request)) {
    return jsonResponse({ error: '密码不正确或已失效' }, 401);
  }

  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return jsonResponse({ error: '缺少查询词 q' });

  const parsed = parseImageInput(query);
  const failures = [];

  // ① 精确镜像名：直接问仓库要 tag，完全不碰 hub.docker.com
  if (!parsed.error) {
    const cacheKey = new Request(new URL(
      `/__cache/image-tags?h=${parsed.host}&r=${encodeURIComponent(parsed.repos.join(','))}`, request.url));
    const cache = caches.default;

    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    for (const repo of parsed.repos) {
      const result = await fetchRepoTags(parsed.host, repo);
      if (result.error) { failures.push(`${parsed.host}/${repo}: ${result.error}`); continue; }
      if (result.missing) continue;

      const tags = result.tags || [];
      const response = jsonResponse({
        kind: 'image',
        host: parsed.host,
        repo,
        requestedTag: parsed.tag || '',
        // latest 置顶：tags/list 不给更新时间，上游那串顺序对挑 tag 没帮助
        tags: tags.includes('latest') ? ['latest', ...tags.filter(tag => tag !== 'latest')] : tags,
        truncated: !!result.truncated
      }, 200, true);
      if (ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }
  }

  // ② 关键词模糊搜（可选）。两个前提，缺一个就不发这趟请求：
  //    a. 词得是 Docker Hub 上的 —— 在 ghcr.io 上没找到却去 Docker Hub 搜，搜出来的结果会误导人；
  //    b. 配了凭据 —— 未鉴权搜索按共享出口 IP 限流，发出去也只能换回一个 429。
  const keyword = parsed.error ? query : parsed.repos[0].replace(/^library\//, '');
  const searchable = parsed.error ? !!parsed.searchable : parsed.host === 'registry-1.docker.io';
  const credential = searchable ? await getDockerCredential() : null;

  if (searchable && credential) {
    const searchCacheKey = new Request(new URL(
      '/__cache/image-search?q=' + encodeURIComponent(keyword.toLowerCase()), request.url));
    const cache = caches.default;

    const hit = await cache.match(searchCacheKey);
    if (hit) return hit;

    const found = await searchHubByKeyword(keyword, credential);
    if (found.error) {
      return jsonResponse({ kind: 'none', error: found.error, failures }, 502);
    }

    const response = jsonResponse({
      kind: 'list', query: keyword, count: found.count, results: found.results
    }, 200, true);
    if (ctx) ctx.waitUntil(cache.put(searchCacheKey, response.clone()));
    return response;
  }

  // 没找到，把「为什么」按情况说清楚，别甩一句干巴巴的 404
  const hint = '想按关键词模糊搜，点「Docker 镜像查询」旁边的「凭据」，填 Docker Hub 用户名 + PAT 即可。';
  let error;
  let detail;

  if (parsed.error) {
    error = `“${query}”不是可查询的镜像名`;
    detail = parsed.error + (parsed.searchable ? '　' + hint : '');
  } else {
    error = `没找到镜像 “${query}”`;
    detail = parsed.host === 'registry-1.docker.io'
      // 官方镜像要求不带命名空间，组织镜像必须写全 组织/镜像 —— 这是最常见的踩坑点
      ? 'Docker Hub 上只有官方镜像能只写名字（实际仓库名是 library/<名字>）。' +
        '别的镜像都在某个组织下面，必须写成 组织/镜像 才算完整仓库名 —— 例如 openlistteam/openlist。' +
        (searchable ? '　' + hint : '')
      : `${parsed.host} 上没有这个仓库，Docker Hub 的搜索也不覆盖它。`;
  }

  return jsonResponse({ kind: 'none', error, detail, failures }, parsed.error ? 400 : 404);
}

async function handleRequest(request, ctx) {
  const url = new URL(request.url);

  // 界面与界面自己的接口。入口只有一个 /，/admin 保留为等价入口（旧书签仍然能用），
  // 右上角已经没有任何跳转按钮了。
  if (url.pathname === '/' || url.pathname === '/admin' ||
      url.pathname === '/api/find-domains' || url.pathname === '/api/docker-credential') {
    return handleAppRequest(request);
  }

  // 镜像查询 API。必须挡在 handleRequest1js 之前：那边除 '/' 之外的任何路径都会被
  // 当成 Docker 镜像名解析，/api/image-search 会变成去 registry 拉一个叫这个名字的镜像。
  if (url.pathname === '/api/image-search') {
    return handleImageSearch(request, ctx);
  }

  // 统一转小写
  const current_host = url.host.toLowerCase();
  const host_header = request.headers.get('Host');
  const effective_host = (host_header || current_host).toLowerCase();

  // 哪些主机名能进这个 Worker，由 Cloudflare 的路由决定，代码里不再另外维护白名单：
  //   路由 1：proxy.域名/*          → 加速工具界面 / 管理页（README 里的「添加域名指向 Worker」）
  //   路由 2：*-proxy.域名/*        → GitHub 各子域代理
  // 没命中这两条路由的请求（如随机子域）根本不会到达这个 Worker。
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

  // 排查用：记录目标站请求的来源指纹
  logOriginFingerprint(target_host, request);

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
    new_response_headers.set(
      'cache-control',
      cacheControlFor(response.headers.get('content-type'), pathname)
    );
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

// 从当前请求的主机名推导「代理域名后缀」，页面上展示的代理域名按实际访问用的域名生成，
// 不在代码里写死任何域名：
//   proxy.<后缀>      -> <后缀>   （README 部署第 6 步：加速入口 / 管理页挂在这个主机上）
//   xxx-proxy.<后缀>  -> <后缀>   （GitHub 各子域代理）
//   其它（裸根域名）   -> 原样返回
// 与 modifyResponse 里 `effective_hostname.substring(host_prefix.length)` 的算法保持一致。
function getProxySuffix(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!h) return '';
  const prefix = getProxyPrefix(h);
  if (prefix) return h.slice(prefix.length);
  if (h.startsWith('proxy.')) return h.slice('proxy.'.length);
  return h;
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

// 按响应类型分级设置浏览器缓存。
// 重点在带指纹的静态资源：之前这里被统一压成 4 小时，
// 等于把上游本来一年有效的缓存反复作废，回访时又全部重新找 Worker 要一遍。
function cacheControlFor(contentType, pathname) {
  const ct = (contentType || '').toLowerCase();

  // 页面短缓存：GitHub 的 HTML 里带动态 token，不能长留
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return HTML_CACHE;
  }
  if (ct.includes('json')) {
    return JSON_CACHE;
  }

  const hasFingerprint =
    /\.[0-9a-f]{8,}\./i.test(pathname) || /-[0-9a-f]{8,}\./i.test(pathname);

  if (
    ct.startsWith('image/') ||
    ct.startsWith('font/') ||
    ct.startsWith('video/') ||
    ct.startsWith('audio/') ||
    hasFingerprint
  ) {
    return STATIC_CACHE;
  }

  if (ct.includes('text/css') || ct.includes('javascript') || ct.includes('wasm')) {
    return ASSET_CACHE;
  }

  // 兜底：保持原有行为
  return HTML_CACHE;
}
