/* 数据层：本地演示 / GitHub 仓库（tasks.json）两种数据源。
 *
 * 为什么用 GitHub 当后端：不要服务器、不要数据库、免费。
 * 读：公开仓库的 contents API 不需要 token；
 * 写：抢单/提交要改仓库里的 tasks.json，需要一个只对该仓库有 contents:write 的 PAT。
 * 未配置仓库时走本地模式，数据只存在手机上，用来先跑通流程。
 */
(function (global) {
  'use strict';

  var CFG_KEY = 'trp_tasks_cfg_v1';
  var CACHE_KEY = 'trp_tasks_cache_v1';
  var LOCAL_KEY = 'trp_tasks_local_v1';

  var DEFAULT_CONFIG = {
    mode: 'local',       // local | github
    owner: 'Toriesta',
    repo: 'trplink',
    branch: 'main',
    path: 'tasks.json',
    usersPath: 'users.json',
    ratingsPath: 'ratings.json',
    token: '',
    wechat: '',          // 微信号：登录身份，接单归属按它算
    name: '',            // 显示名（可填真实姓名）
    trusted: false,      // 可信成员：能看并接 B 级任务
    craft_max: 10        // 我能做的最高制作水平（0–10）
  };

  // 保密等级：A 只留在管理员本机（不进共享池），B 仅可信成员，C 任何人可接
  var LEVELS = { A: 'A 级 · 仅本人', B: 'B 级 · 可信成员', C: 'C 级 · 可外包' };

  function craftOf(task) {
    var v = Number(task && task.craft);
    if (!isFinite(v)) return 5;
    return Math.max(0, Math.min(10, Math.round(v)));
  }

  function craftLabel(v) {
    var n = Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
    if (n <= 2) return '基础';
    if (n <= 4) return '偏低';
    if (n <= 6) return '中等';
    if (n <= 8) return '较高';
    return '高难';
  }

  // 统一编码：保密等级 + 制作水平，例如 A5 / B1
  function codeOf(task) {
    return levelOf(task) + craftOf(task);
  }

  var STATUS = {
    open: '待接',
    claimed: '进行中',
    submitted: '待验收',
    done: '已完成'
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isoNow() {
    var d = new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var oh = pad(Math.floor(Math.abs(off) / 60));
    var om = pad(Math.abs(off) % 60);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + oh + ':' + om;
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 容量满或隐私模式，忽略 */ }
  }

  /* ------------------------------------------------------------ 任务池
   * 正经软件不放假任务：空池就显示空状态，任务只能由管理员发布。
   */
  function demoTasks() { return []; }

  /* ------------------------------------------------------------ GitHub */
  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function apiUrl(cfg, path) {
    var p = path || cfg.path;
    return 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) + '/' +
      encodeURIComponent(cfg.repo) + '/contents/' + p.split('/').map(encodeURIComponent).join('/') +
      '?ref=' + encodeURIComponent(cfg.branch || 'main') + '&t=' + Date.now();
  }

  function headers(cfg) {
    var h = { Accept: 'application/vnd.github+json' };
    if (cfg.token) h.Authorization = 'Bearer ' + cfg.token;
    return h;
  }

  async function githubRead(cfg, path) {
    var res = await fetch(apiUrl(cfg, path), { headers: headers(cfg), cache: 'no-store' });
    if (res.status === 404) {
      throw new Error('仓库里还没有 ' + cfg.path + '，先在网页上创建这个文件');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('没有读取权限：检查仓库是否公开，或 token 是否有效');
    }
    if (!res.ok) throw new Error('GitHub 读取失败（' + res.status + '）');
    var json = await res.json();
    var text = b64decode(json.content || '');
    var data = JSON.parse(text);
    return { data: data, sha: json.sha };
  }

  async function githubWrite(cfg, data, sha, message, path) {
    if (!cfg.token) throw new Error('写入需要 token：设置里填入该仓库的 PAT');
    var body = {
      message: message,
      content: b64encode(JSON.stringify(data, null, 2) + '\n'),
      branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;
    var res = await fetch(apiUrl(cfg, path), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers(cfg)),
      body: JSON.stringify(body)
    });
    if (res.status === 409) throw new Error('刚有人改过任务，先下拉刷新再试');
    if (res.status === 401 || res.status === 403) {
      throw new Error('token 没有写权限：需要 contents: write');
    }
    if (!res.ok) throw new Error('GitHub 写入失败（' + res.status + '）');
    var json = await res.json();
    return json.content && json.content.sha;
  }

  function normalize(data) {
    var tasks = Array.isArray(data) ? data : (data && data.tasks) || [];
    return {
      updated: (data && data.updated) || '',
      tasks: tasks.map(function (t) {
        var row = Object.assign({
          status: 'open', priority: 2, tags: [], checklist: [], secret: 'C',
          claimedBy: '', claimedName: '', assignedTo: '',
          claimedAt: '', submittedAt: '', desc: '', brief: ''
        }, t);
        row.secret = String(row.secret || 'C').toUpperCase();
        if (['A', 'B', 'C'].indexOf(row.secret) < 0) row.secret = 'C';
        row.craft = craftOf(row);
        return row;
      })
    };
  }

  /* ------------------------------------------------------------ 读取 */
  function sanitize(data, cfg) {
    data.tasks = visible(data.tasks, cfg);
    return data;
  }

  async function load(opts) {
    var cfg = await refreshTrust(getConfig());
    var force = !!(opts && opts.force);

    if (cfg.mode !== 'github' || !gitReady(cfg)) {
      var local = readJSON(LOCAL_KEY, null);
      if (!local) {
        local = { updated: isoNow(), tasks: demoTasks() };
        writeJSON(LOCAL_KEY, local);
      }
      return { data: sanitize(normalize(local), cfg), source: 'local',
               sha: '', offline: false, error: '' };
    }

    var cache = readJSON(CACHE_KEY, null);
    if (!force && cache && cache.data) {
      // 先给缓存，网络在后台刷新；这一层由 app.js 决定是否 await
    }
    try {
      var got = await githubRead(cfg);
      writeJSON(CACHE_KEY, { data: got.data, sha: got.sha, at: Date.now() });
      return { data: sanitize(normalize(got.data), cfg), source: 'github',
               sha: got.sha, offline: false, error: '' };
    } catch (e) {
      if (cache && cache.data) {
        return {
          data: sanitize(normalize(cache.data), cfg), source: 'github', sha: cache.sha || '',
          offline: true, error: (e && e.message) || '网络不可用，显示上次缓存'
        };
      }
      throw e;
    }
  }

  /* ------------------------------------------------------------ 写入 */
  async function mutate(mutator, message) {
    var cfg = getConfig();

    if (cfg.mode !== 'github' || !gitReady(cfg)) {
      var local = readJSON(LOCAL_KEY, null) || { updated: isoNow(), tasks: demoTasks() };
      mutator(local.tasks);
      local.updated = isoNow();
      writeJSON(LOCAL_KEY, local);
      return { data: sanitize(normalize(local), cfg), source: 'local', sha: '', offline: false };
    }

    var got = await githubRead(cfg);   // 始终拿最新 sha，降低冲突
    var payload = got.data && Array.isArray(got.data.tasks) ? got.data : { tasks: [] };
    mutator(payload.tasks);
    payload.updated = isoNow();
    var sha = await githubWrite(cfg, payload, got.sha, message || 'update tasks');
    writeJSON(CACHE_KEY, { data: payload, sha: sha, at: Date.now() });
    return { data: sanitize(normalize(payload), cfg), source: 'github', sha: sha, offline: false };
  }

  /* ------------------------------------------------------------ 客户评分
   * 由接单的一线成员打分：1–5 星 + 标签。烂客户的低分会被桌面端折算进
   * 「可持续性」，进而影响是否值得为他升级模型、是否优先排期。
   */
  var RATINGS_KEY = 'trp_ratings_v1';

  function localRatings() {
    return readJSON(RATINGS_KEY, { ratings: [] });
  }

  async function readRatings() {
    var cfg = getConfig();
    if (cfg.mode === 'github' && gitReady(cfg)) {
      try {
        var got = await githubRead(cfg, cfg.ratingsPath || 'ratings.json');
        var data = got.data || { ratings: [] };
        if (!Array.isArray(data.ratings)) data.ratings = [];
        writeJSON(RATINGS_KEY, data);
        return { data: data, sha: got.sha, source: 'github' };
      } catch (e) {
        var cached = localRatings();
        return { data: cached, sha: '', source: 'cache', error: (e && e.message) || '' };
      }
    }
    return { data: localRatings(), sha: '', source: 'local' };
  }

  async function rateClient(client, stars, tags, note) {
    var me = requireWechat();
    var name = String(client || '').trim();
    if (!name) throw new Error('这条任务没标客户名，没法评价');
    var s = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
    var got = await readRatings();
    var row = {
      client: name,
      wechat: me.wx,
      name: me.name,
      stars: s,
      tags: (tags || []).slice(0, 5),
      note: String(note || '').slice(0, 200),
      at: todayISO(),
    };
    // 同一个人对同一客户只保留最新一票
    var list = got.data.ratings.filter(function (r) {
      return !(r.client === name && r.wechat === me.wx);
    });
    list.push(row);
    var payload = { updated: isoNow(), ratings: list };

    var cfg = getConfig();
    if (cfg.mode === 'github' && gitReady(cfg)) {
      try {
        await githubWrite(cfg, payload, got.sha, 'rate ' + name + ' by ' + me.wx,
                          cfg.ratingsPath || 'ratings.json');
      } catch (e) {
        writeJSON(RATINGS_KEY, payload);
        return { row: row, localOnly: true, error: (e && e.message) || '' };
      }
    }
    writeJSON(RATINGS_KEY, payload);
    return { row: row, localOnly: false };
  }

  function clientStats(ratings, client) {
    var rows = (ratings || []).filter(function (r) { return r.client === client; });
    if (!rows.length) return null;
    var sum = 0;
    var tagCount = {};
    rows.forEach(function (r) {
      sum += Number(r.stars) || 0;
      (r.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; });
    });
    var tags = Object.keys(tagCount).sort(function (a, b) { return tagCount[b] - tagCount[a]; });
    return {
      count: rows.length,
      avg: Math.round(sum / rows.length * 10) / 10,
      tags: tags.slice(0, 3),
      rows: rows,
    };
  }

  function find(tasks, id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
    return null;
  }

  function requireWechat() {
    var cfg = getConfig();
    var wx = String(cfg.wechat || '').trim();
    if (!wx) throw new Error('先用微信号登录，再接单');
    return {
      wx: wx,
      name: String(cfg.name || wx).trim(),
      trusted: !!cfg.trusted,
      craftMax: Number(cfg.craft_max != null ? cfg.craft_max : 10),
    };
  }

  async function claim(id, who) {
    var me = requireWechat();
    return mutate(function (tasks) {
      var t = find(tasks, id);
      if (!t) throw new Error('任务不存在，刷新试试');
      var lv = levelOf(t);
      if (lv === 'A') throw new Error('A 级任务不进共享池，只能由管理员本机处理');
      if (lv === 'B' && !me.trusted) throw new Error('B 级任务只对可信成员开放');
      if (craftOf(t) > me.craftMax) {
        throw new Error('这单制作水平 ' + craftOf(t) + '，超过你登记的 '
          + me.craftMax + '；先升级能力，或让管理员直接指派');
      }
      if (t.status !== 'open') throw new Error('这单已经被接走了');
      var assigned = String(t.assignedTo || '').trim();
      if (assigned && assigned !== me.wx) {
        throw new Error('这单指定给了 ' + assigned + '，不能抢');
      }
      t.status = 'claimed';
      t.claimedBy = me.wx;
      t.claimedName = me.name;
      t.claimedAt = todayISO();
    }, 'claim ' + id + ' by ' + me.wx);
  }

  async function release(id) {
    var me = requireWechat();
    return mutate(function (tasks) {
      var t = find(tasks, id);
      if (!t) throw new Error('任务不存在，刷新试试');
      if (t.status !== 'claimed') throw new Error('当前状态不能撤回');
      if (String(t.claimedBy || '') !== me.wx) throw new Error('这单不是你接的');
      t.status = 'open';
      t.claimedBy = '';
      t.claimedName = '';
      t.claimedAt = '';
    }, 'release ' + id + ' by ' + me.wx);
  }

  async function submit(id, note) {
    var me = requireWechat();
    return mutate(function (tasks) {
      var t = find(tasks, id);
      if (!t) throw new Error('任务不存在，刷新试试');
      if (t.status !== 'claimed') throw new Error('先接单才能提交');
      if (String(t.claimedBy || '') !== me.wx) throw new Error('这单不是你接的');
      t.status = 'submitted';
      t.submittedAt = todayISO();
      if (note) t.deliveryNote = String(note).slice(0, 500);
    }, 'submit ' + id + ' by ' + me.wx);
  }

  async function syncFromGitHub() {
    var cfg = getConfig();
    if (cfg.mode !== 'github' || !gitReady(cfg)) throw new Error('还没配置 GitHub 仓库');
    var got = await githubRead(cfg);
    writeJSON(CACHE_KEY, { data: got.data, sha: got.sha, at: Date.now() });
    return { data: normalize(got.data), sha: got.sha };
  }

  /* ------------------------------------------------------------ 辅助 */
  function daysLeft(deadline) {
    if (!deadline) return null;
    var parts = String(deadline).slice(0, 10).split('-');
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 按自然日算：今天=0、明天=1、昨天=-1，避免时刻差把「逾期」算成「今天截止」
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }

  function deadlineText(deadline) {
    var n = daysLeft(deadline);
    if (n === null) return '无期限';
    if (n < 0) return '已逾期 ' + Math.abs(n) + ' 天';
    if (n === 0) return '今天截止';
    if (n === 1) return '明天截止';
    return '剩 ' + n + ' 天';
  }

  function isMine(task, ident) {
    var s = String(ident || '').trim();
    if (!s) return false;
    if (String(task.claimedBy || '').trim() === s) return true;
    return String(task.claimedName || '').trim() === s;   // 兼容旧数据只写了名字的记录
  }

  function stats(tasks, name) {
    var mine = tasks.filter(function (t) { return isMine(t, name); });
    var doing = mine.filter(function (t) { return t.status === 'claimed'; }).length;
    var submitted = mine.filter(function (t) { return t.status === 'submitted'; }).length;
    var earned = mine.filter(function (t) { return t.status === 'done'; })
      .reduce(function (s, t) { return s + (Number(t.reward) || 0); }, 0);
    var open = tasks.filter(function (t) { return t.status === 'open'; }).length;
    return { mine: mine.length, doing: doing, submitted: submitted, earned: earned, open: open };
  }

  function money(v) {
    var n = Number(v || 0);
    return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  global.Store = {
    STATUS: STATUS,
    LEVELS: LEVELS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    levelOf: levelOf,
    craftOf: craftOf,
    craftLabel: craftLabel,
    codeOf: codeOf,
    canSee: canSee,
    demo: demoTasks,
    getConfig: getConfig,
    saveConfig: saveConfig,
    gitReady: gitReady,
    login: login,
    readUsers: readUsers,
    readRatings: readRatings,
    rateClient: rateClient,
    clientStats: clientStats,
    load: load,
    claim: claim,
    release: release,
    submit: submit,
    sync: syncFromGitHub,
    daysLeft: daysLeft,
    deadlineText: deadlineText,
    isMine: isMine,
    stats: stats,
    money: money,
    isoNow: isoNow,
    todayISO: todayISO
  };
})(window);
