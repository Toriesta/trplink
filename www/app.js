/* 界面层：三个 tab（任务 / 我的 / 设置）+ 任务详情抽屉。
 * 纯原生 DOM，无框架 —— 包进 Capacitor 后体积小、启动快，改动也不用重新装依赖。
 */
(function () {
  'use strict';

  var S = window.Store;
  var view = document.getElementById('view');
  var sheet = document.getElementById('sheet');
  var sheetBody = document.getElementById('sheetBody');
  var toastEl = document.getElementById('toast');
  var refreshBtn = document.getElementById('btnRefresh');

  var state = {
    tab: 'tasks',
    rate: null,             // 当前正在打分的任务 {id, stars, tags}
    filter: 'all',          // all | open | mine
    tasks: [],
    updated: '',
    source: 'local',
    offline: false,
    error: '',
    loading: true,
    busy: false,
    sheetId: null,
    cfg: S.getConfig()
  };

  /* ------------------------------------------------------------ 工具 */
  function esc(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dateLine() {
    var d = new Date();
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + WEEK[d.getDay()];
  }

  function greeting() {
    var h = new Date().getHours();
    if (h < 6) return '还在忙';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function toast(msg) {
    if (!msg) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2300);
  }

  function sortTasks(list) {
    var order = { open: 0, claimed: 1, submitted: 2, done: 3 };
    return list.slice().sort(function (a, b) {
      var d = (order[a.status] || 0) - (order[b.status] || 0);
      if (d) return d;
      var pa = Number(a.priority) || 2, pb = Number(b.priority) || 2;
      if (pa !== pb) return pa - pb;
      return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
    });
  }

  function filtered() {
    var list = state.tasks;
    if (state.filter === 'open') list = list.filter(function (t) { return t.status === 'open'; });
    if (state.filter === 'mine') list = list.filter(function (t) { return S.isMine(t, state.cfg.wechat || state.cfg.name); });
    return sortTasks(list);
  }

  /* ------------------------------------------------------------ 卡片 */
  function cardHTML(t, i) {
    var mine = S.isMine(t, state.cfg.wechat || state.cfg.name);
    var left = S.daysLeft(t.deadline);
    var urgent = left !== null && left <= 2;
    var meta = [S.deadlineText(t.deadline)];
    var tags = (t.tags || []).slice(0, t.assignedTo ? 1 : 2);
    tags.forEach(function (g) { if (g) meta.push(g); });
    if (t.assignedTo) {
      meta.push('指定给 ' + (S.isMine(t, state.cfg.wechat || state.cfg.name) ? '你' : t.assignedTo));
    }

    var action = '';
    if (t.status === 'open') {
      action = '<button class="btn" type="button" data-act="claim" data-id="' + esc(t.id) + '">抢单</button>';
    } else if (t.status === 'claimed' && mine) {
      action = '<span class="badge claimed">我的</span>';
    } else if (t.status === 'claimed') {
      action = '<span class="meta">' + esc(t.claimedBy || '已接') + '</span>';
    }

    return '' +
      '<article class="card p' + (Number(t.priority) || 2) + '" data-act="detail" data-id="' + esc(t.id) + '" ' +
      'style="--i:' + i + '" role="button" tabindex="0">' +
        '<div class="card-top">' +
          '<div class="card-title">' + esc(t.title) + '</div>' +
          '<div class="card-price"><small>¥</small>' + esc(S.money(t.reward)) + '</div>' +
        '</div>' +
        (t.brief ? '<p class="card-brief">' + esc(t.brief) + '</p>' : '') +
        '<div class="card-foot">' +
          '<span class="lv lv-' + esc(t.secret) + '" title="' +
            esc((S.LEVELS[t.secret] || '') + ' · 制作水平 ' + t.craft + '/10（'
              + S.craftLabel(t.craft) + '）') + '">' + esc(S.codeOf(t)) + '</span>' +
          '<span class="meta' + (urgent ? ' urgent' : '') + '">' + esc(meta[0]) + '</span>' +
          meta.slice(1).map(function (m) {
            return '<i class="dot-sep"></i><span class="meta">' + esc(m) + '</span>';
          }).join('') +
          '<span class="spacer"></span>' +
          '<span class="badge ' + esc(t.status) + '">' + esc(S.STATUS[t.status] || t.status) + '</span>' +
          action +
        '</div>' +
      '</article>';
  }

  function emptyHTML(title, sub) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true">' +
        '<rect x="12" y="16" width="40" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<rect x="12" y="30" width="40" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<rect x="12" y="44" width="24" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '</svg>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(sub) + '</p></div>';
  }

  function skeletonHTML() {
    return '<div class="skeleton">' + new Array(3).join().split(',').map(function () {
      return '<div class="sk"></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------ 页面 */
  function renderTasks() {
    var st = S.stats(state.tasks, state.cfg.name);
    var list = filtered();
    var chips = [
      ['all', '全部 ' + state.tasks.length],
      ['open', '可接 ' + st.open],
      ['mine', '我的 ' + st.mine]
    ];

    var body;
    if (state.loading && !state.tasks.length) {
      body = skeletonHTML();
    } else if (!list.length) {
      body = emptyHTML(
        state.filter === 'mine' ? '还没有接单' : '暂时没有可接的任务',
        state.filter === 'mine' ? '去「任务」里抢一单，接下的活会出现在这里' : '任务发布后会出现在这里，下拉或点右上角刷新'
      );
    } else {
      body = '<div class="list">' + list.map(cardHTML).join('') + '</div>';
    }

    view.innerHTML = '' +
      '<section class="hero">' +
        '<div class="hero-row">' +
          '<h1>' + esc(greeting()) + (state.cfg.name ? '，' + esc(state.cfg.name) : '') + '</h1>' +
          (st.open ? '<span class="count-pill">' + st.open + ' 单待接</span>' : '') +
        '</div>' +
        '<p>' + esc(dateLine()) +
        (state.cfg.wechat ? ' · ' + esc(state.cfg.wechat) : ' · 未登录，接单前先登录') +
        (state.source === 'github' ? (state.offline ? ' · 离线缓存' : ' · 已连仓库') : ' · 读取中') +
        (state.offline ? ' · 离线缓存' : '') + '</p>' +
      '</section>' +
      '<div class="chips">' + chips.map(function (c) {
        return '<button class="chip' + (state.filter === c[0] ? ' is-on' : '') +
          '" type="button" data-act="filter" data-filter="' + c[0] + '">' + esc(c[1]) + '</button>';
      }).join('') + '</div>' +
      body +
      (state.error ? '<p class="hint" style="margin-top:14px">⚠️ ' + esc(state.error) + '</p>' : '');
  }

  function renderMine() {
    var st = S.stats(state.tasks, state.cfg.name);
    var mine = sortTasks(state.tasks.filter(function (t) { return S.isMine(t, state.cfg.wechat || state.cfg.name); }));
    var doing = mine.filter(function (t) { return t.status === 'claimed'; });

    var body = mine.length
      ? '<div class="list">' + mine.map(cardHTML).join('') + '</div>'
      : emptyHTML('这里还空着', '接下的任务会按「进行中 / 待验收 / 已完成」分组显示');

    view.innerHTML = '' +
      '<section class="hero">' +
        '<div class="hero-row"><h1>我的任务</h1>' +
        (st.mine ? '<span class="count-pill">' + st.mine + ' 单</span>' : '') + '</div>' +
        '<p>' + (state.cfg.wechat ? esc(state.cfg.wechat) : '还没用微信号登录，去设置里登录') +
        ' · 手上 ' + st.doing + ' 单要做</p>' +
      '</section>' +
      '<div class="stats">' +
        '<div class="stat"><div class="stat-label">进行中</div><div class="stat-value">' +
          '<span data-count="' + st.doing + '">0</span><small>单</small></div></div>' +
        '<div class="stat"><div class="stat-label">待验收</div><div class="stat-value">' +
          '<span data-count="' + st.submitted + '">0</span><small>单</small></div></div>' +
        '<div class="stat accent"><div class="stat-label">已结算</div><div class="stat-value">' +
          '<span data-count="' + st.earned + '" data-money="1">¥0</span></div></div>' +
      '</div>' +
      (doing.length ? '<div class="section-title">要做完的</div>' : '') +
      (doing.length ? '<div class="list">' + doing.map(cardHTML).join('') + '</div>' : '') +
      '<div class="section-title">全部记录</div>' +
      body;
  }

  function fieldHTML(label, key, value, ph, hint, type) {
    return '<div class="field">' +
      '<div class="field-label">' + esc(label) + '</div>' +
      '<input data-set="' + esc(key) + '" type="' + (type || 'text') + '" value="' + esc(value) +
        '" placeholder="' + esc(ph || '') + '" spellcheck="false" autocapitalize="off" autocomplete="off">' +
      (hint ? '<p class="hint">' + hint + '</p>' : '') +
      '</div>';
  }

  function renderSettings() {
    var c = state.cfg;

    view.innerHTML = '' +
      '<section class="hero"><div class="hero-row"><h1>设置</h1></div>' +
      '<p>数字工号登录 · 仓库随 App 固定</p></section>' +

      '<div class="section-title">账号</div>' +
      '<div class="panel">' +
        (c.wechat
          ? '<div class="field">' +
              '<div class="field-label">已登录 · 接单身份</div>' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                '<span style="font-size:16px;font-weight:700">' + esc(c.name || c.wechat) + '</span>' +
                '<span class="meta">' + esc(c.wechat) + '</span>' +
                '<span class="badge ' + (c.trusted ? 'claimed' : 'muted') + '">' +
                  (c.trusted ? '可信成员 · 可见 B 级' : '普通成员 · 仅 C 级') + '</span>' +
                '<span class="badge muted">可做到 ' + esc(c.craft_max) + '/10</span>' +
                '<span style="flex:1"></span>' +
                '<button class="btn ghost" type="button" data-act="logout">退出</button>' +
              '</div>' +
              '<p class="hint">身份由人才库同步，名字与微信号不能在这里改。</p>' +
            '</div>'
          : fieldHTML('工号', 'code', '', '4 位数字工号',
              '工号由管理员在人才库分配；不能点名字冒名登录。') +
            '<div class="field"><button class="btn ink block" type="button" data-act="login">登录</button></div>') +
      '</div>' +

      '<div class="section-title">连接</div>' +
      '<div class="panel">' +
        '<div class="field">' +
          '<div class="field-label">仓库（随 App 固定）</div>' +
          '<p class="hint">' + esc(c.owner + '/' + c.repo + ' · ' + c.branch) + '</p>' +
          '<p class="hint">断网时只读本机缓存，不会出现假任务；换仓库由管理员重打包。</p>' +
        '</div>' +
        fieldHTML('访问令牌', 'token', c.token, 'github_pat_…',
          '接单、交付、评分需要写仓库时才用到；填一次存在本机，不会上传。', 'password') +
      '</div>' +

      '<div class="actions" style="margin:0 0 16px">' +
        '<button class="btn ink block" type="button" data-act="save">保存令牌</button>' +
      '</div>' +

      '<div class="section-title">发布任务</div>' +
      '<div class="panel"><div class="field">' +
        '<p class="hint">任务写在仓库的 <code>tasks.json</code> 里。用 <code>python tools/publish_task.py</code> ' +
        '在电脑上发布，或在 GitHub 网页直接编辑这个文件；手机端刷新即可看到。' +
        '状态：<code>open</code> 待接 · <code>claimed</code> 进行中 · <code>submitted</code> 待验收 · ' +
        '<code>done</code> 已完成。</p>' +
      '</div></div>' +

      '<div class="about">' +
        '<b>TRP 任务台</b> · v1.0.0 · 天枢架构内部工具<br>' +
        '仓库：' + esc(c.owner + '/' + c.repo) + '（随 App 固定）' +
        (state.updated ? '<br>任务更新时间：' + esc(String(state.updated).replace('T', ' ').slice(0, 16)) : '') +
        '<br>象牙白 / 深紫 / 珊瑚 · 与 TRP Link 同一套色板' +
      '</div>';
  }

  function render() {
    if (state.tab === 'tasks') renderTasks();
    else if (state.tab === 'mine') renderMine();
    else renderSettings();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === state.tab);
    });

    moveTabIndicator();
    if (state.tab !== prevTab) {
      prevTab = state.tab;
      reflowAnim();
      animateNumbers(view);
    }
  }

  /* ------------------------------------------------------------ 详情 */
  var RATE_TAGS = ['钱多', '事少', '回款快', '需求乱', '拖延', '返修多'];

  function ratingBlock(t) {
    var s = state.rate && state.rate.id === t.id ? state.rate : { stars: 0, tags: [] };
    var stars = [1, 2, 3, 4, 5].map(function (n) {
      return '<button class="star' + (n <= s.stars ? ' is-on' : '') +
        '" type="button" data-act="star" data-v="' + n + '" data-id="' + esc(t.id) + '">★</button>';
    }).join('');
    var tags = RATE_TAGS.map(function (tag) {
      return '<button class="rate-tag' + (s.tags.indexOf(tag) >= 0 ? ' is-on' : '') +
        '" type="button" data-act="rtag" data-tag="' + tag + '" data-id="' + esc(t.id) + '">' +
        tag + '</button>';
    }).join('');
    return '<div class="rate">' +
      '<div class="field-label">客户评价 · ' + esc(t.client) + '<span>一线成员打分，影响后面派单</span></div>' +
      '<div class="stars">' + stars + '</div>' +
      '<div class="rate-tags">' + tags + '</div>' +
      '<button class="btn ink block" type="button" data-act="rate" data-id="' + esc(t.id) + '">' +
      '提交评价' + (s.stars ? '（' + s.stars + ' 星）' : '') + '</button>' +
      '</div>';
  }

  function openSheet(id) {
    var t = null;
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) t = state.tasks[i];
    if (!t) return;
    state.sheetId = id;

    var mine = S.isMine(t, state.cfg.wechat || state.cfg.name);
    var left = S.daysLeft(t.deadline);
    var actions = '';

    if (t.status === 'open') {
      actions = '<button class="btn" type="button" data-act="claim" data-id="' + esc(t.id) + '">抢这单</button>' +
                '<button class="btn ghost" type="button" data-act="close">再想想</button>';
    } else if (t.status === 'claimed' && mine) {
      actions = '<button class="btn" type="button" data-act="submit" data-id="' + esc(t.id) + '">提交完成</button>' +
                '<button class="btn ghost" type="button" data-act="release" data-id="' + esc(t.id) + '">撤回</button>';
    } else if (t.status === 'claimed') {
      actions = '<button class="btn ghost" type="button" data-act="close">已被人接走</button>';
    } else if (t.status === 'submitted') {
      actions = '<button class="btn ghost" type="button" data-act="close">等待验收</button>';
    } else {
      actions = '<button class="btn ghost" type="button" data-act="close">已完成</button>';
    }

    var checklist = (t.checklist || []).length
      ? '<div class="section-title" style="margin-top:18px">交付清单</div><ul class="check">' +
        t.checklist.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
      : '';

    sheetBody.innerHTML = '' +
      '<div class="row">' +
        '<span class="badge ' + esc(t.status) + '">' + esc(S.STATUS[t.status] || t.status) + '</span>' +
        '<span class="lv lv-' + esc(t.secret) + '">' + esc(S.codeOf(t)) + '</span>' +
        '<span class="meta">' + esc(S.LEVELS[t.secret] || '') + ' · 制作水平 ' +
          esc(t.craft) + '/10（' + esc(S.craftLabel(t.craft)) + '）</span>' +
        '<span class="meta">' + esc(t.id) + '</span>' +
        (left !== null && left <= 2 && t.status === 'open'
          ? '<span class="meta urgent">' + esc(S.deadlineText(t.deadline)) + '</span>' : '') +
      '</div>' +
      '<h2>' + esc(t.title) + '</h2>' +
      '<div class="price"><small>¥</small>' + esc(S.money(t.reward)) + '</div>' +
      (t.brief ? '<p class="desc">' + esc(t.brief) + '</p>' : '') +
      '<div style="margin-top:12px">' +
        '<div class="kv"><span>截止</span><span>' + esc(t.deadline || '不限') + '</span></div>' +
        '<div class="kv"><span>优先级</span><span>' + (Number(t.priority) === 1 ? '高' :
          Number(t.priority) === 3 ? '低' : '中') + '</span></div>' +
        '<div class="kv"><span>标签</span><span>' + esc((t.tags || []).join(' · ') || '—') + '</span></div>' +
        '<div class="kv"><span>指派给</span><span>' + esc(t.assignedTo || '任何人') + '</span></div>' +
        '<div class="kv"><span>接单人</span><span>' + esc(t.claimedBy || '未接') + '</span></div>' +
        (t.client ? ratingBlock(t) : '') +
      '</div>' +
      (t.desc ? '<div class="section-title" style="margin-top:18px">要求</div><p class="desc" style="margin-top:0">' +
        esc(t.desc) + '</p>' : '') +
      checklist +
      (t.status === 'claimed' && mine
        ? '<div class="section-title" style="margin-top:18px">交付说明</div>' +
          '<div class="field" style="padding-top:0;border:0">' +
          '<textarea id="deliveryNote" placeholder="一句话说明交付内容或链接，例：已上传网盘，见群公告">' +
          esc(t.deliveryNote || '') + '</textarea></div>' : '') +
      '<div class="actions">' + actions + '</div>';

    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('is-open'); });
  }

  function closeSheet() {
    state.sheetId = null;
    sheet.classList.remove('is-open');
    setTimeout(function () { sheet.hidden = true; }, 340);
  }

  /* ------------------------------------------------------------ 数据动作 */
  async function load(force) {
    state.loading = true;
    if (state.tab === 'tasks') render();
    try {
      var r = await S.load({ force: !!force });
      state.tasks = r.data.tasks;
      state.updated = r.data.updated;
      state.source = r.source;
      state.offline = !!r.offline;
      state.error = r.error || '';
    } catch (e) {
      state.error = (e && e.message) || '读取失败';
    }
    state.loading = false;
    render();
  }

  function applyResult(r) {
    if (r && r.data) {
      state.tasks = r.data.tasks;
      state.updated = r.data.updated;
      state.source = r.source;
      state.offline = !!r.offline;
    }
    render();
  }

  async function doClaim(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      applyResult(await S.claim(id));
      haptic('MEDIUM');
      toast('已接下这单');
      if (state.sheetId === id) closeSheet();
    } catch (e) {
      toast((e && e.message) || '抢单失败');
    } finally {
      state.busy = false;
    }
  }

  async function doRelease(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      applyResult(await S.release(id));
      toast('已撤回');
      if (state.sheetId === id) closeSheet();
    } catch (e) {
      toast((e && e.message) || '撤回失败');
    } finally {
      state.busy = false;
    }
  }

  async function doSubmit(id) {
    if (state.busy) return;
    state.busy = true;
    var noteEl = document.getElementById('deliveryNote');
    try {
      applyResult(await S.submit(id, noteEl ? noteEl.value : ''));
      haptic('MEDIUM');
      toast('已提交，等验收');
      closeSheet();
    } catch (e) {
      toast((e && e.message) || '提交失败');
    } finally {
      state.busy = false;
    }
  }

  async function doRefresh() {
    refreshBtn.classList.add('is-spinning');
    await load(true);
    // 人才库和任务池是两个文件：只刷任务会导致刚加的人「刷新了也登不了」
    try { await S.readUsers(); } catch (e) { /* 离线时沿用缓存 */ }
    refreshBtn.classList.remove('is-spinning');
    if (!state.error) toast('已同步任务与人才库');
  }

  /* ------------------------------------------------------------ 事件 */
  async function doLogin(code) {
    code = String(code || '').trim();
    if (!/^\d{4}$/.test(code)) {
      toast('工号是 4 位数字，请切数字键盘输入');
      return;
    }
    try {
      var user = await S.login(code);
      state.cfg = S.getConfig();
      toast('已登录：' + (user.name || user.wechat));
      state.tab = 'tasks';
      // 登录后必须重拉：B 级可见性依赖 trusted
      await load(true);
    } catch (e) {
      var msg = (e && e.message) || '登录失败';
      toast(msg.indexOf('人才库') >= 0
        ? '工号不在人才库；刚加人的话点右上角刷新再试' : msg);
    }
  }

  document.addEventListener('click', async function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    if (act === 'login') {
      var codeEl = view.querySelector('[data-set="code"]');
      await doLogin(codeEl ? codeEl.value : '');
      return;
    }
    if (act === 'logout') {
      S.saveConfig({ wechat: '', name: '', trusted: false });
      state.cfg = S.getConfig();
      toast('已退出');
      await load(true);
      return;
    }

    if (act === 'star') {
      ev.stopPropagation();
      var v = Number(el.getAttribute('data-v')) || 0;
      if (!state.rate || state.rate.id !== id) state.rate = { id: id, stars: 0, tags: [] };
      state.rate.stars = v;
      var siblings = el.parentElement.querySelectorAll('.star');
      Array.prototype.forEach.call(siblings, function (b) {
        b.classList.toggle('is-on', Number(b.getAttribute('data-v')) <= v);
      });
      var submit = view.querySelector('[data-act="rate"]');
      if (submit) submit.textContent = '提交评价（' + v + ' 星）';
      return;
    }
    if (act === 'rtag') {
      ev.stopPropagation();
      var tag = el.getAttribute('data-tag');
      if (!state.rate || state.rate.id !== id) state.rate = { id: id, stars: 0, tags: [] };
      var at = state.rate.tags.indexOf(tag);
      if (at >= 0) state.rate.tags.splice(at, 1); else state.rate.tags.push(tag);
      el.classList.toggle('is-on', state.rate.tags.indexOf(tag) >= 0);
      return;
    }
    if (act === 'rate') {
      ev.stopPropagation();
      var task = state.tasks.filter(function (x) { return x.id === id; })[0];
      if (!task || !task.client) { toast('这条任务没标客户名'); return; }
      if (!state.rate || state.rate.id !== id || !state.rate.stars) {
        toast('先点星星再提交');
        return;
      }
      try {
        var res = await S.rateClient(task.client, state.rate.stars, state.rate.tags);
        toast(res.localOnly ? '已记在本机（没写回仓库）' : '评价已提交，谢谢你');
        state.rate = null;
        closeSheet();
      } catch (e) {
        toast((e && e.message) || '提交失败');
      }
      return;
    }

    if (act === 'claim') { ev.stopPropagation(); doClaim(id); return; }
    if (act === 'release') { doRelease(id); return; }
    if (act === 'submit') { doSubmit(id); return; }
    if (act === 'detail') { openSheet(id); return; }
    if (act === 'close') { closeSheet(); return; }
    if (act === 'filter') { state.filter = el.getAttribute('data-filter'); render(); return; }

    if (act === 'save') {
      // 只允许改令牌；仓库、身份都由管理员与 App 决定
      var tokenInput = view.querySelector('[data-set="token"]');
      state.cfg = S.saveConfig({ token: tokenInput ? tokenInput.value.trim() : '' });
      toast('令牌已保存，正在同步…');
      doRefresh();
      return;
    }
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.tab') : null;
    if (!b) return;
    state.tab = b.getAttribute('data-tab');
    render();
  });

  sheet.addEventListener('click', function (ev) {
    if (ev.target.getAttribute && ev.target.getAttribute('data-close')) closeSheet();
  });

  refreshBtn.addEventListener('click', doRefresh);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  /* ------------------------------------------------------------ 动效与质感 */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var topbarEl = document.getElementById('topbar');
  var pullEl = document.getElementById('pull');
  var tabIndicator = document.getElementById('tabIndicator');
  var prevTab = '';

  function haptic(style) {
    try {
      var cap = window.Capacitor;
      if (cap && cap.Plugins && cap.Plugins.Haptics) {
        cap.Plugins.Haptics.impact({ style: style || 'LIGHT' });
      } else if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    } catch (e) { /* 浏览器里没有插件，忽略 */ }
  }

  function moveTabIndicator() {
    var active = document.querySelector('.tab.is-active');
    if (!tabIndicator || !active) return;
    // 指示器只包住图标，别做成横跨整个 tab 的大色块
    var w = 56;
    tabIndicator.style.width = w + 'px';
    tabIndicator.style.transform =
      'translateX(' + Math.round(active.offsetLeft + (active.offsetWidth - w) / 2) + 'px)';
  }

  function fmtNum(v, o) {
    var n = Math.round(v);
    return o && o.money ? '¥' + n.toLocaleString('zh-CN') : String(n);
  }

  function countUp(el, value, opts) {
    if (!el) return;
    var o = opts || {};
    var to = Number(value) || 0;
    if (reduceMotion) { el.textContent = fmtNum(to, o); return; }
    var start = 0;
    var dur = o.duration || 720;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtNum(to * eased, o);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function animateNumbers(root) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-count]'), function (el) {
      countUp(el, el.getAttribute('data-count'), {
        money: el.getAttribute('data-money') === '1',
        duration: 680,
      });
    });
  }

  function reflowAnim() {
    if (reduceMotion) return;
    view.classList.remove('view-anim');
    void view.offsetWidth;          // 强制 reflow，重放页面进入动画
    view.classList.add('view-anim');
  }

  function boot() {
    var splash = document.getElementById('splash');
    var appEl = document.getElementById('app');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (splash) {
        splash.classList.add('is-done');
        setTimeout(function () { splash.remove(); }, 800);
      }
      if (appEl) appEl.classList.add('is-ready');
      setTimeout(moveTabIndicator, 80);
      setTimeout(function () { animateNumbers(view); }, 460);
    }
    if (!splash || reduceMotion) { finish(); return; }
    splash.addEventListener('click', finish);
    setTimeout(finish, 1950);
  }

  document.addEventListener('pointerdown', function (ev) {
    if (reduceMotion) return;
    var el = ev.target.closest ? ev.target.closest('.btn, .chip, .tab') : null;
    if (!el) return;
    var r = el.getBoundingClientRect();
    var size = Math.max(r.width, r.height) * 1.2;
    var s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = s.style.height = size + 'px';
    s.style.left = (ev.clientX - r.left - size / 2) + 'px';
    s.style.top = (ev.clientY - r.top - size / 2) + 'px';
    el.appendChild(s);
    setTimeout(function () { s.remove(); }, 640);
  }, { passive: true });

  window.addEventListener('scroll', function () {
    if (topbarEl) topbarEl.classList.toggle('is-scrolled', window.scrollY > 8);
  }, { passive: true });

  /* 下拉刷新：只在任务页、且已经滚到顶部时接管 */
  var pullStart = 0;
  var pulling = false;

  window.addEventListener('touchstart', function (e) {
    if (state.tab !== 'tasks' || window.scrollY > 0 || state.loading || !pullEl) return;
    pullStart = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  window.addEventListener('touchmove', function (e) {
    if (!pulling || !pullEl) return;
    var dy = e.touches[0].clientY - pullStart;
    if (dy <= 0) {
      pullEl.classList.remove('is-on', 'is-hot');
      pullEl.style.transform = '';
      return;
    }
    var d = Math.min(dy * 0.55, 62);
    pullEl.classList.add('is-on');
    pullEl.classList.toggle('is-hot', dy >= 72);
    pullEl.style.transform = 'translate(-50%, ' + (d - 58) + 'px)';
    var label = pullEl.querySelector('.pull-text');
    if (label) label.textContent = dy >= 72 ? '松开刷新' : '下拉刷新';
    var ring = pullEl.querySelector('.pull-ring');
    if (ring) ring.style.transform = 'rotate(' + Math.round(dy * 2.2) + 'deg)';
  }, { passive: true });

  window.addEventListener('touchend', function () {
    if (!pulling || !pullEl) return;
    pulling = false;
    var hot = pullEl.classList.contains('is-hot');
    pullEl.classList.remove('is-hot');
    if (!hot) {
      pullEl.classList.remove('is-on');
      pullEl.style.transform = '';
      return;
    }
    pullEl.classList.add('is-loading', 'is-on');
    pullEl.style.transform = 'translate(-50%, -6px)';
    var label = pullEl.querySelector('.pull-text');
    if (label) label.textContent = '正在刷新';
    haptic('LIGHT');
    doRefresh().then(function () {
      pullEl.classList.remove('is-loading', 'is-on');
      pullEl.style.transform = '';
    });
  }, { passive: true });

  /* ------------------------------------------------------------ 原生壳 */
  function initNative() {
    var cap = window.Capacitor;
    if (!cap || !cap.Plugins) return;
    try {
      if (cap.Plugins.StatusBar) {
        cap.Plugins.StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {});
        cap.Plugins.StatusBar.setBackgroundColor({ color: '#F4F0E6' }).catch(function () {});
      }
      if (cap.Plugins.App) {
        cap.Plugins.App.addListener('backButton', function () {
          if (!sheet.hidden) { closeSheet(); return; }
          if (state.tab !== 'tasks') { state.tab = 'tasks'; render(); return; }
          cap.Plugins.App.exitApp();
        });
      }
    } catch (e) { /* Web 预览下没有插件，忽略 */ }
  }

  initNative();
  boot();
  render();
  load(false);
  window.addEventListener('resize', moveTabIndicator);
})();
