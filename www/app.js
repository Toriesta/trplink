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
        (state.source === 'github' ? ' · 已连仓库' : ' · 演示数据') +
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
          st.doing + '<small>单</small></div></div>' +
        '<div class="stat"><div class="stat-label">待验收</div><div class="stat-value">' +
          st.submitted + '<small>单</small></div></div>' +
        '<div class="stat accent"><div class="stat-label">已结算</div><div class="stat-value">' +
          '¥' + esc(S.money(st.earned)) + '</div></div>' +
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
    var github = c.mode === 'github';

    view.innerHTML = '' +
      '<section class="hero"><div class="hero-row"><h1>设置</h1></div>' +
      '<p>微信号登录 · 改完点下面保存</p></section>' +

      '<div class="section-title">账号</div>' +
      '<div class="panel">' +
        (c.wechat
          ? '<div class="field">' +
              '<div class="field-label">已登录 · 接单身份</div>' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<span style="font-size:16px;font-weight:700">' + esc(c.wechat) + '</span>' +
                '<span class="badge done">已登录</span>' +
                '<span style="flex:1"></span>' +
                '<button class="btn ghost" type="button" data-act="logout">退出</button>' +
              '</div>' +
            '</div>'
          : fieldHTML('微信号', 'wechat', '', '输入微信号登录 / 注册',
              '第一次输入即注册；已有的微信号直接登录。登录后才能接单。') +
            '<div class="field"><button class="btn ink block" type="button" data-act="login">登录 / 注册</button></div>') +
        fieldHTML('显示名', 'name', c.name, '例：陈成方', '展示用；任务归属按微信号算') +
      '</div>' +

      '<div class="section-title">数据源</div>' +
      '<div class="panel">' +
        '<div class="field">' +
          '<div class="seg">' +
            '<button type="button" data-act="mode" data-mode="local" class="' +
              (!github ? 'is-on' : '') + '">演示数据</button>' +
            '<button type="button" data-act="mode" data-mode="github" class="' +
              (github ? 'is-on' : '') + '">GitHub 仓库</button>' +
          '</div>' +
          '<p class="hint">演示数据只存在手机上；GitHub 模式让手机和电脑共用一份任务。</p>' +
        '</div>' +
        (github ? (
          fieldHTML('仓库 owner', 'owner', c.owner, '你的 GitHub 用户名 / 组织名') +
          fieldHTML('仓库名', 'repo', c.repo, '例：trp-tasks') +
          fieldHTML('分支', 'branch', c.branch, 'main') +
          fieldHTML('任务文件路径', 'path', c.path, 'tasks.json') +
          fieldHTML('访问令牌（可选）', 'token', c.token,
            'github_pat_…', '读公开仓库不需要 token；抢单、提交要改文件，需要 contents: write 的 token。' +
            '只存在本机，不会上传到别处。', 'password')
        ) : '') +
      '</div>' +

      '<div class="actions" style="display:flex;gap:9px;margin:0 0 16px">' +
        '<button class="btn ink block" type="button" data-act="save">保存' + (github ? '并同步' : '') + '</button>' +
        '<button class="btn ghost block" type="button" data-act="reset">重置演示</button>' +
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
        '数据源：' + (github ? 'GitHub · ' + esc(c.owner + '/' + c.repo) : '本机演示数据') +
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
  }

  /* ------------------------------------------------------------ 详情 */
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
    refreshBtn.classList.remove('is-spinning');
    if (!state.error) toast('已是最新');
  }

  /* ------------------------------------------------------------ 事件 */
  document.addEventListener('click', async function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    if (act === 'login') {
      var wxEl = view.querySelector('[data-set="wechat"]');
      var nmEl = view.querySelector('[data-set="name"]');
      if (!wxEl || !wxEl.value.trim()) { toast('先填微信号'); return; }
      try {
        var user = await S.login(wxEl.value, nmEl ? nmEl.value : '');
        state.cfg = S.getConfig();
        toast((user._localOnly ? '已在本机注册 ' : '已登录 ') + user.wechat);
        state.tab = 'tasks';
        render();
      } catch (e) {
        toast((e && e.message) || '登录失败');
      }
      return;
    }
    if (act === 'logout') {
      S.saveConfig({ wechat: '', name: '' });
      state.cfg = S.getConfig();
      toast('已退出');
      render();
      return;
    }

    if (act === 'claim') { ev.stopPropagation(); doClaim(id); return; }
    if (act === 'release') { doRelease(id); return; }
    if (act === 'submit') { doSubmit(id); return; }
    if (act === 'detail') { openSheet(id); return; }
    if (act === 'close') { closeSheet(); return; }
    if (act === 'filter') { state.filter = el.getAttribute('data-filter'); render(); return; }

    if (act === 'mode') {
      state.cfg = S.saveConfig({ mode: el.getAttribute('data-mode') });
      render();
      return;
    }

    if (act === 'save') {
      var patch = {};
      Array.prototype.forEach.call(view.querySelectorAll('[data-set]'), function (input) {
        patch[input.getAttribute('data-set')] = input.value.trim();
      });
      state.cfg = S.saveConfig(patch);
      if (state.cfg.mode === 'github') {
        toast('已保存，正在同步…');
        doRefresh();
      } else {
        toast('已保存');
        state.tab = 'tasks';
        load(true);
      }
      return;
    }

    if (act === 'reset') {
      try {
        localStorage.removeItem('trp_tasks_local_v1');
        localStorage.removeItem('trp_tasks_cache_v1');
      } catch (e) { /* ignore */ }
      S.saveConfig({ mode: 'local' });
      state.cfg = S.getConfig();
      state.filter = 'all';
      toast('已重置为演示数据');
      load(true);
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
  render();
  load(false);
})();
