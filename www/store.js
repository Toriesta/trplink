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
    token: '',
    wechat: '',          // 微信号：登录身份，接单归属按它算
    name: ''             // 显示名（可填真实姓名）
  };

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

  /* ------------------------------------------------------------ 演示数据 */
  function demoTasks() {
    var t = todayISO();
    function day(offset) {
      var d = new Date();
      d.setDate(d.getDate() + offset);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    return [
      {
        id: 'T-2611-01',
        title: '《一念永恒》第 12–15 集粗剪',
        brief: '4 集粗剪，交付 mp4 + 对白字幕 srt，按现有 SOP 出片。',
        desc: '沿用 1–11 集的节奏模板。每集 18–24 分钟，片头片尾用现成包装，' +
              '字幕按现有术语表校对。交付前自检一遍跳帧与口型。',
        reward: 1200,
        deadline: day(3),
        priority: 1,
        tags: ['剪辑', 'ODSUS'],
        status: 'open',
        claimedBy: '',
        claimedAt: '',
        submittedAt: '',
        checklist: ['对白字幕与术语一致', '音效不压过人声', '片头片尾时长对齐']
      },
      {
        id: 'T-2611-02',
        title: '厦门文旅 30 秒宣传片分镜',
        brief: '按脚本拆 12–16 个分镜，出 Shot Card 与参考图。',
        desc: '甲方向要求突出「海丝」与「骑楼」两个意象。分镜需要标注镜头运动、' +
              '景别与单镜时长，参考图可用 ODSUS 生成，不必精修。',
        reward: 800,
        deadline: day(6),
        priority: 2,
        tags: ['分镜', '文旅'],
        status: 'open',
        claimedBy: '',
        claimedAt: '',
        submittedAt: '',
        checklist: ['分镜数 12–16', '每镜标时长', '附参考图']
      },
      {
        id: 'T-2611-03',
        title: 'Torie 群聊话术复盘（20 群）',
        brief: '整理近两周触达记录，输出命中率与三条改进建议。',
        desc: '需要翻开聊天记录做人工标注：哪些是有效需求信号、哪些被当成广告。' +
              '结果整理成一页 markdown，附 3 条可执行建议。',
        reward: 300,
        deadline: day(-1),
        priority: 1,
        tags: ['运营', 'Torie'],
        status: 'open',
        claimedBy: '',
        claimedAt: '',
        submittedAt: '',
        checklist: ['覆盖 20 个群', '标注命中与误判', '给 3 条建议']
      },
      {
        id: 'T-2611-04',
        title: '海外白标样片（15 秒 × 3）',
        brief: '三条不同行业的 15 秒样片，英文文案，用于代理渠道。',
        desc: '面向新加坡与槟城代理，行业分别为咖啡连锁、瑜伽馆、跨境电商。' +
              '英文文案需母语者可读，不必配音，先出画面与字幕。',
        reward: 1500,
        deadline: day(9),
        priority: 2,
        tags: ['海外', '英文'],
        status: 'claimed',
        claimedBy: '陈成方',
        claimedAt: day(-2),
        submittedAt: '',
        checklist: ['三条不同行业', '英文字幕无语法错', '1080p 竖版']
      }
    ];
  }

  /* ------------------------------------------------------------ 配置 */
  function getConfig() {
    var cfg = readJSON(CFG_KEY, null) || {};
    var out = {};
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      out[k] = cfg[k] !== undefined && cfg[k] !== null ? cfg[k] : DEFAULT_CONFIG[k];
    });
    return out;
  }

  function saveConfig(patch) {
    var cfg = getConfig();
    Object.keys(patch || {}).forEach(function (k) { cfg[k] = patch[k]; });
    writeJSON(CFG_KEY, cfg);
    return cfg;
  }

  function gitReady(cfg) {
    return !!(cfg.owner && cfg.repo && cfg.path);
  }

  /* ------------------------------------------------------------ 用户 / 微信号
   * 手机端只做「输入微信号登录或注册」；发布与指派留给管理员在本机脚本完成。
   * 普通用户没有发布入口，写入时也会校验状态流转与接单归属。
   */
  var USERS_KEY = 'trp_users_v1';

  function localUsers() {
    return readJSON(USERS_KEY, { users: [] });
  }

  function saveLocalUser(user) {
    var all = localUsers();
    var found = false;
    all.users = all.users.map(function (u) {
      if (u.wechat === user.wechat) { found = true; return user; }
      return u;
    });
    if (!found) all.users.push(user);
    all.updated = isoNow();
    writeJSON(USERS_KEY, all);
  }

  async function readUsers() {
    var cfg = getConfig();
    if (cfg.mode === 'github' && gitReady(cfg)) {
      try {
        var got = await githubRead(cfg, cfg.usersPath || 'users.json');
        var data = got.data || { users: [] };
        if (!Array.isArray(data.users)) data.users = [];
        writeJSON(USERS_KEY, data);   // 缓存一份，离线也能登录
        return { data: data, sha: got.sha, source: 'github' };
      } catch (e) {
        var cached = localUsers();
        return { data: cached, sha: '', source: 'cache', error: (e && e.message) || '' };
      }
    }
    return { data: localUsers(), sha: '', source: 'local' };
  }

  async function login(wechat, name) {
    var wx = String(wechat || '').trim();
    if (!wx) throw new Error('请填微信号');
    var got = await readUsers();
    var hit = null;
    got.data.users.forEach(function (u) {
      if (String(u.wechat || '').trim() === wx) hit = u;
    });
    if (hit && hit.role === 'admin') {
      throw new Error('管理员账号不在这里登录；请用发布脚本');
    }
    if (!hit) {
      hit = { wechat: wx, name: String(name || wx).trim(), role: 'worker',
              registeredAt: todayISO() };
      try {
        var updated = { users: got.data.users.concat([hit]), updated: isoNow() };
        await githubWrite(getConfig(), updated, got.sha, 'register ' + wx,
                          getConfig().usersPath || 'users.json');
      } catch (e) {
        // 没有写 token 时只在本机登记：接单仍按微信号归属，管理员也能按微信号指派
        saveLocalUser(hit);
        hit._localOnly = true;
      }
    }
    saveConfig({ wechat: wx, name: hit.name || name || wx });
    return hit;
  }

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
        return Object.assign({
          status: 'open', priority: 2, tags: [], checklist: [],
          claimedBy: '', claimedName: '', assignedTo: '',
          claimedAt: '', submittedAt: '', desc: '', brief: ''
        }, t);
      })
    };
  }

  /* ------------------------------------------------------------ 读取 */
  async function load(opts) {
    var cfg = getConfig();
    var force = !!(opts && opts.force);

    if (cfg.mode !== 'github' || !gitReady(cfg)) {
      var local = readJSON(LOCAL_KEY, null);
      if (!local) {
        local = { updated: isoNow(), tasks: demoTasks() };
        writeJSON(LOCAL_KEY, local);
      }
      return { data: normalize(local), source: 'local', sha: '', offline: false, error: '' };
    }

    var cache = readJSON(CACHE_KEY, null);
    if (!force && cache && cache.data) {
      // 先给缓存，网络在后台刷新；这一层由 app.js 决定是否 await
    }
    try {
      var got = await githubRead(cfg);
      writeJSON(CACHE_KEY, { data: got.data, sha: got.sha, at: Date.now() });
      return { data: normalize(got.data), source: 'github', sha: got.sha, offline: false, error: '' };
    } catch (e) {
      if (cache && cache.data) {
        return {
          data: normalize(cache.data), source: 'github', sha: cache.sha || '',
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
      return { data: normalize(local), source: 'local', sha: '', offline: false };
    }

    var got = await githubRead(cfg);   // 始终拿最新 sha，降低冲突
    var payload = got.data && Array.isArray(got.data.tasks) ? got.data : { tasks: [] };
    mutator(payload.tasks);
    payload.updated = isoNow();
    var sha = await githubWrite(cfg, payload, got.sha, message || 'update tasks');
    writeJSON(CACHE_KEY, { data: payload, sha: sha, at: Date.now() });
    return { data: normalize(payload), source: 'github', sha: sha, offline: false };
  }

  function find(tasks, id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
    return null;
  }

  function requireWechat() {
    var cfg = getConfig();
    var wx = String(cfg.wechat || '').trim();
    if (!wx) throw new Error('先用微信号登录，再接单');
    return { wx: wx, name: String(cfg.name || wx).trim() };
  }

  async function claim(id, who) {
    var me = requireWechat();
    return mutate(function (tasks) {
      var t = find(tasks, id);
      if (!t) throw new Error('任务不存在，刷新试试');
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
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    demo: demoTasks,
    getConfig: getConfig,
    saveConfig: saveConfig,
    gitReady: gitReady,
    login: login,
    readUsers: readUsers,
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
