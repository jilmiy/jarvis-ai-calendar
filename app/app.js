/**
 * app.js - 小智桌面日历 主逻辑
 * 多清单待办 / 日周月日历 / 四象限 / 倒计时 / AI助手 / 提醒
 */
(function () {
  'use strict';

  var WEEK_CN = ['一', '二', '三', '四', '五', '六', '日']; // 周一开头
  var QUAD_NAMES = { 1: '重要且紧急', 2: '重要不紧急', 3: '不重要但紧急', 4: '不重要不紧急' };

  // ---------- 状态 ----------
  var state = {
    view: 'todos',          // todos | calendar | quadrant | countdown | ai-* | news | status-*
    activeListId: 'default',
    statusFilter: null,     // all | undone | done | deleted
    calMode: 'month',       // day | week | month
    viewYear: 0, viewMonth: 0,
    selected: null,         // 'YYYY-M-D'
    editingTodoId: null,
    editingCountdownId: null,
    hideDone: false,
    aiMode: null,           // report | chat | todo
    aiBusy: false,
    data: {
      lists: [{ id: 'default', name: '默认清单', color: '#4d8dff' }],
      todos: [],   // {id, listId, title, note, date, time, quad, done, deleted, allDay, endDate, endTime, repeat, remind, notifiedOn, createdAt, doneAt}
      countdowns: [],
      aiHistory: { report: [], chat: [], todo: [] },
      statusColors: { active: '#4d8dff', notstarted: '#38bde8', overdue: '#ffb35c', done: '#8b5cf6' },
      wallpaper: 'aurora',
      opacity: 100,
      edgeHide: false,
      pinned: false,
      apiKey: ''
    }
  };

  // ---------- 存储 ----------
  var STORE_KEY = 'xiaozhi-calendar-v2';
  function normalizeData() {
    if (!state.data.lists || !state.data.lists.length) state.data.lists = [{ id: 'default', name: '默认清单' }];
    if (!state.data.lists.some(function (l) { return l.id === 'default'; })) {
      state.data.lists.unshift({ id: 'default', name: '默认清单' });
    }
    state.data.lists.forEach(function (l) { if (!l.color) l.color = '#4d8dff'; });
    if (!state.data.aiHistory || typeof state.data.aiHistory !== 'object') state.data.aiHistory = {};
    ['report', 'chat', 'todo'].forEach(function (k) {
      if (!Array.isArray(state.data.aiHistory[k])) state.data.aiHistory[k] = [];
    });
    // 状态颜色默认值
    var defColors = { active: '#4d8dff', notstarted: '#38bde8', overdue: '#ffb35c', done: '#8b5cf6' };
    if (!state.data.statusColors || typeof state.data.statusColors !== 'object') state.data.statusColors = {};
    Object.keys(defColors).forEach(function (k) {
      if (!/^#[0-9a-fA-F]{6}$/.test(state.data.statusColors[k] || '')) state.data.statusColors[k] = defColors[k];
    });
    // 强制规范布尔标志,防止导入/AI写入的异常值(如字符串"false")污染统计
    state.data.todos.forEach(function (t) {
      t.deleted = t.deleted === true;
      t.done = t.done === true;
    });
  }

  function applyRaw(raw) {
    if (!raw) return;
    try { Object.assign(state.data, JSON.parse(raw)); } catch (e) { /* 损坏则用默认 */ }
  }
  function save() {
    var json = JSON.stringify(state.data);
    localStorage.setItem(STORE_KEY, json);
    // Electron 下同时写入本地数据文件(位置可在设置中修改)
    if (window.electronAPI && window.electronAPI.saveData) window.electronAPI.saveData(json);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- 工具 ----------
  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateKey(y, m, d) { return y + '-' + (m + 1) + '-' + d; }
  function todayKey() { var t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); }
  function keyToDate(k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function toInputDate(k) { var p = k.split('-').map(Number); return p[0] + '-' + pad(p[1]) + '-' + pad(p[2]); }
  function fromInputDate(v) { var p = v.split('-').map(Number); return p[0] + '-' + p[1] + '-' + p[2]; }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }

  function aliveTodos() {
    return state.data.todos.filter(function (t) { return !t.deleted; });
  }
  function findList(id) {
    return state.data.lists.find(function (l) { return l.id === id; });
  }

  // ---------- 视图切换 ----------
  function switchView(view) {
    state.view = view;
    $all('.side-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.view === view ||
        (el.dataset.listId && view === 'todos' && el.dataset.listId === state.activeListId));
    });

    $all('.view').forEach(function (v) { v.classList.add('hidden'); });

    if (view === 'todos' || view.indexOf('status-') === 0) {
      state.statusFilter = view.indexOf('status-') === 0 ? view.slice(7) : null;
      $('#view-todos').classList.remove('hidden');
      renderTodos();
    } else if (view === 'calendar') {
      $('#view-calendar').classList.remove('hidden');
      renderCalendar();
    } else if (view === 'quadrant') {
      $('#view-quadrant').classList.remove('hidden');
      renderQuadrant();
    } else if (view === 'countdown') {
      $('#view-countdown').classList.remove('hidden');
      renderCountdowns();
    } else if (view === 'news') {
      $('#view-news').classList.remove('hidden');
      renderStats();
    } else if (view.indexOf('ai-') === 0) {
      state.aiMode = view.slice(3); // report | chat | todo
      $('#view-ai').classList.remove('hidden');
      setupAiView();
    }
  }

  // ---------- 侧边栏 ----------
  function renderSidebar() {
    var nav = $('#list-nav');
    nav.innerHTML = '';

    // 全部清单(虚拟清单,汇总所有事件)
    var allDiv = document.createElement('div');
    allDiv.className = 'side-item sub';
    if (state.view === 'todos' && !state.statusFilter && state.activeListId === '__all__') allDiv.classList.add('active');
    var allIcon = document.createElement('span');
    allIcon.className = 'si-icon'; allIcon.textContent = '◉';
    allIcon.style.color = '#e8edf5';
    var allName = document.createElement('span');
    allName.className = 'si-name'; allName.textContent = '全部清单';
    var allCnt = document.createElement('span');
    allCnt.className = 'si-count';
    allCnt.textContent = aliveTodos().filter(function (t) { return !t.done; }).length;
    allDiv.appendChild(allIcon); allDiv.appendChild(allName); allDiv.appendChild(allCnt);
    allDiv.addEventListener('click', function () {
      state.activeListId = '__all__';
      switchView('todos');
      renderSidebar();
    });
    nav.appendChild(allDiv);

    state.data.lists.forEach(function (l) {
      var count = aliveTodos().filter(function (t) { return t.listId === l.id && !t.done; }).length;
      var div = document.createElement('div');
      div.className = 'side-item sub';
      div.dataset.listId = l.id;
      if (state.view === 'todos' && !state.statusFilter && state.activeListId === l.id) div.classList.add('active');

      var icon = document.createElement('span'); icon.className = 'si-icon'; icon.textContent = '●';
      icon.style.color = l.color || '#4d8dff';
      var name = document.createElement('span'); name.className = 'si-name'; name.textContent = l.name;
      var cnt = document.createElement('span'); cnt.className = 'si-count'; cnt.textContent = count;
      div.appendChild(icon); div.appendChild(name); div.appendChild(cnt);

      var editBtn = document.createElement('button');
      editBtn.className = 'list-del'; editBtn.textContent = '✎'; editBtn.title = '编辑清单(名称/颜色)';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openListModal(l.id);
      });
      div.appendChild(editBtn);

      if (l.id !== 'default') {
        var del = document.createElement('button');
        del.className = 'list-del'; del.textContent = '✕'; del.title = '删除清单';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('删除清单「' + l.name + '」?清单内待办将移入默认清单')) return;
          state.data.todos.forEach(function (t) { if (t.listId === l.id) t.listId = 'default'; });
          state.data.lists = state.data.lists.filter(function (x) { return x.id !== l.id; });
          if (state.activeListId === l.id) state.activeListId = 'default';
          save(); renderSidebar();
          if (state.view === 'todos') renderTodos();
        });
        div.appendChild(del);
      }

      div.addEventListener('click', function () {
        state.activeListId = l.id;
        switchView('todos');
        renderSidebar();
      });
      // 拖待办到清单名上 → 移动到该清单
      div.addEventListener('dragover', function (e) {
        e.preventDefault();
        div.classList.add('drag-over');
      });
      div.addEventListener('dragleave', function () { div.classList.remove('drag-over'); });
      div.addEventListener('drop', function (e) {
        e.preventDefault();
        div.classList.remove('drag-over');
        var id = e.dataTransfer.getData('text/plain');
        var t = state.data.todos.find(function (x) { return x.id === id; });
        if (t && t.listId !== l.id) {
          t.listId = l.id;
          save(); refreshAll();
          toast('已移至清单「' + l.name + '」');
        }
      });
      nav.appendChild(div);
    });

    // 状态计数
    var all = aliveTodos();
    var todayD = keyToDate(todayKey());
    $('#cnt-all').textContent = all.length;
    $('#cnt-undone').textContent = all.filter(function (t) { return !t.done; }).length;
    $('#cnt-notstarted').textContent = all.filter(function (t) {
      return !t.done && t.date && keyToDate(t.date) > todayD;
    }).length;
    $('#cnt-done').textContent = all.filter(function (t) { return t.done; }).length;
    $('#cnt-deleted').textContent = state.data.todos.filter(function (t) { return t.deleted; }).length;
  }

  // ---------- 待办 ----------
  var REPEAT_CN = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' };
  function metaOf(t) {
    var parts = [];
    if (t.date) {
      var d = keyToDate(t.date);
      var txt = (d.getMonth() + 1) + '月' + d.getDate() + '日';
      if (t.allDay) txt += ' 全天';
      else if (t.time) {
        txt += ' ' + t.time;
        if (t.endTime && (!t.endDate || t.endDate === t.date)) txt += '-' + t.endTime;
      }
      if (t.endDate && t.endDate !== t.date) {
        var e = keyToDate(t.endDate);
        txt += ' ~ ' + (e.getMonth() + 1) + '月' + e.getDate() + '日' + (!t.allDay && t.endTime ? ' ' + t.endTime : '');
      }
      if (t.repeat && t.repeat !== 'never') txt += ' · ' + REPEAT_CN[t.repeat] + '重复';
      var isRepeat = t.repeat && t.repeat !== 'never';
      var endK = t.endDate || t.date;
      parts.push({ text: txt, overdue: !t.done && !isRepeat && keyToDate(endK) - keyToDate(todayKey()) < 0 });
    }
    var l = findList(t.listId);
    if (l && l.id !== 'default') parts.push({ text: l.name });
    if (t.note) parts.push({ text: t.note });
    return parts;
  }

  function buildTodoItem(t, opts) {
    opts = opts || {};
    var li = document.createElement('li');
    li.className = 'todo-item' + (t.done ? ' done' : '');
    li.dataset.id = t.id;

    var qtag = document.createElement('span');
    qtag.className = 'ti-qtag q' + (t.quad || 4);
    li.appendChild(qtag);

    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'todo-check'; cb.checked = !!t.done;
    cb.addEventListener('change', function () {
      t.done = cb.checked;
      t.doneAt = t.done ? Date.now() : null;
      save(); refreshAll();
    });
    li.appendChild(cb);

    var body = document.createElement('div');
    body.className = 'ti-body';
    var title = document.createElement('div');
    title.className = 'ti-title';
    title.textContent = (t.remind && t.date && t.time ? '🔔 ' : '') + t.title;
    body.appendChild(title);
    var meta = metaOf(t);
    if (meta.length) {
      var m = document.createElement('div');
      m.className = 'ti-meta';
      meta.forEach(function (p) {
        var s = document.createElement('span');
        s.textContent = p.text;
        if (p.overdue) { s.classList.add('overdue'); s.textContent = '⚠ ' + p.text; }
        m.appendChild(s);
      });
      body.appendChild(m);
    }
    li.appendChild(body);

    if (t.deleted) {
      var restore = document.createElement('button');
      restore.className = 'icon-btn'; restore.textContent = '↩'; restore.title = '恢复';
      restore.addEventListener('click', function () {
        t.deleted = false; save(); refreshAll();
        toast('已恢复');
      });
      li.appendChild(restore);
      var purge = document.createElement('button');
      purge.className = 'icon-btn'; purge.textContent = '✕'; purge.title = '彻底删除';
      purge.addEventListener('click', function () {
        state.data.todos = state.data.todos.filter(function (x) { return x.id !== t.id; });
        save(); refreshAll();
      });
      li.appendChild(purge);
    } else {
      var edit = document.createElement('button');
      edit.className = 'icon-btn'; edit.textContent = '✎'; edit.title = '编辑';
      edit.addEventListener('click', function () { openTodoModal(t.id); });
      li.appendChild(edit);
      var del = document.createElement('button');
      del.className = 'icon-btn'; del.textContent = '🗑'; del.title = '删除';
      del.addEventListener('click', function () {
        t.deleted = true; save(); refreshAll();
        toast('已移入「已删除」');
      });
      li.appendChild(del);
    }

    // 全部可拖:可拖到侧边栏清单移动归属,四象限内可拖动换象限
    if (!t.deleted) {
      li.draggable = true;
      li.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    return li;
  }

  function renderTodos() {
    var listEl = $('#todos-list');
    listEl.innerHTML = '';

    var items, title;
    if (state.statusFilter) {
      var f = state.statusFilter;
      title = { all: '全部', undone: '未完成', notstarted: '未开始', active: '进行中', overdue: '已逾期', done: '已完成', deleted: '已删除' }[f] || '全部';
      if (f === 'deleted') items = state.data.todos.filter(function (t) { return t.deleted; });
      else {
        items = aliveTodos();
        var tD = keyToDate(todayKey());
        function isNotStarted(t) { return t.date && keyToDate(t.date) > tD; }
        function isOverdue(t) { return t.date && (!t.repeat || t.repeat === 'never') && keyToDate(t.endDate || t.date) < tD; }
        if (f === 'undone') items = items.filter(function (t) { return !t.done; });
        if (f === 'notstarted') items = items.filter(function (t) { return !t.done && isNotStarted(t); });
        if (f === 'overdue') items = items.filter(function (t) { return !t.done && isOverdue(t); });
        if (f === 'active') items = items.filter(function (t) { return !t.done && !isNotStarted(t) && !isOverdue(t); });
        if (f === 'done') items = items.filter(function (t) { return t.done; });
      }
    } else if (state.activeListId === '__all__') {
      title = '全部清单';
      items = aliveTodos();
      if (state.hideDone) items = items.filter(function (t) { return !t.done; });
    } else {
      var l = findList(state.activeListId);
      title = l ? l.name : '默认清单';
      items = aliveTodos().filter(function (t) { return t.listId === state.activeListId; });
      if (state.hideDone) items = items.filter(function (t) { return !t.done; });
    }
    $('#todos-title').textContent = title;
    // 标题圆点跟随清单颜色
    var curList = (!state.statusFilter && state.activeListId !== '__all__') ? findList(state.activeListId) : null;
    $('#view-todos .vh-dot').style.background = curList && curList.color ? curList.color : 'rgba(235,240,248,.62)';
    $('#todo-quick-row').classList.toggle('hidden', !!state.statusFilter);
    $('#btn-purge-all').classList.toggle('hidden', state.statusFilter !== 'deleted' || items.length === 0);

    items = items.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    items.forEach(function (t) { listEl.appendChild(buildTodoItem(t)); });
    $('#todos-empty').classList.toggle('hidden', items.length > 0 || !!state.statusFilter);
  }

  function addQuickTodo(text, extra) {
    var t = {
      id: uid(),
      listId: (!state.activeListId || state.activeListId === '__all__') ? 'default' : state.activeListId,
      title: text, note: '', date: null, time: null,
      quad: 2, done: false, deleted: false,
      allDay: false, endDate: null, endTime: null, repeat: 'never',
      remind: false, notifiedOn: null,
      createdAt: Date.now(), doneAt: null
    };
    if (extra) Object.assign(t, extra);
    state.data.todos.push(t);
    save(); refreshAll();
    return t;
  }

  // ---------- 待办弹窗 ----------
  function openTodoModal(id, preset) {
    state.editingTodoId = id || null;
    var t = id ? state.data.todos.find(function (x) { return x.id === id; }) : null;
    $('#todo-modal-title').textContent = t ? '编辑待办' : '添加待办';

    var sel = $('#td-list');
    sel.innerHTML = '';
    state.data.lists.forEach(function (l) {
      var op = document.createElement('option');
      op.value = l.id; op.textContent = l.name;
      sel.appendChild(op);
    });

    $('#td-title').value = t ? t.title : (preset && preset.title || '');
    sel.value = t ? t.listId : ((!state.activeListId || state.activeListId === '__all__') ? 'default' : state.activeListId);
    $('#td-quad').value = t ? (t.quad || 2) : (preset && preset.quad || 2);
    $('#td-allday').checked = t ? !!t.allDay : false;
    $('#td-date').value = t && t.date ? toInputDate(t.date) : (preset && preset.date ? toInputDate(preset.date) : '');
    $('#td-time').value = t && t.time ? t.time : '';
    $('#td-end-date').value = t && t.endDate ? toInputDate(t.endDate) : '';
    $('#td-end-time').value = t && t.endTime ? t.endTime : '';
    $('#td-repeat').value = t && t.repeat ? t.repeat : 'never';
    $('#td-note').value = t ? (t.note || '') : '';
    $('#td-remind').checked = t ? !!t.remind : false;
    updateTodoModalRows();

    showModal('todo-modal');
    $('#td-title').focus();
  }

  function updateTodoModalRows() {
    var allDay = $('#td-allday').checked;
    $all('.td-time-input').forEach(function (el) {
      el.disabled = allDay;
      el.style.opacity = allDay ? '.4' : '1';
    });
    $('#td-remind').disabled = allDay;
  }

  function saveTodoModal() {
    var title = $('#td-title').value.trim();
    if (!title) { toast('请输入待办内容'); return; }
    var dateV = $('#td-date').value;
    var allDay = $('#td-allday').checked;
    var endDateV = $('#td-end-date').value;
    var patch = {
      title: title,
      listId: $('#td-list').value,
      quad: +$('#td-quad').value,
      allDay: allDay,
      date: dateV ? fromInputDate(dateV) : null,
      time: allDay ? null : ($('#td-time').value || null),
      endDate: dateV && endDateV ? fromInputDate(endDateV) : null,
      endTime: allDay ? null : ($('#td-end-time').value || null),
      repeat: $('#td-repeat').value,
      note: $('#td-note').value.trim(),
      remind: allDay ? false : $('#td-remind').checked,
      notifiedOn: null
    };
    // 结束日期早于开始日期则忽略
    if (patch.endDate && keyToDate(patch.endDate) < keyToDate(patch.date)) patch.endDate = null;
    // 同一天内结束时间早于开始时间则忽略
    if (patch.endTime && patch.time && (!patch.endDate || patch.endDate === patch.date) && patch.endTime < patch.time) patch.endTime = null;
    var savedId;
    if (state.editingTodoId) {
      var t = state.data.todos.find(function (x) { return x.id === state.editingTodoId; });
      if (t) { Object.assign(t, patch); savedId = t.id; }
    } else {
      savedId = addQuickTodo(title, patch).id;
    }
    save(); closeModals(); refreshAll();
    var cfs = findConflicts(patch.date, patch.time, savedId);
    if (cfs.length) toast('已保存(同时段还有:' + conflictText(cfs) + ')');
    else toast('已保存');
  }

  // ---------- 日历 ----------
  function initCalendarHeader() {
    var selY = $('#sel-year'), selM = $('#sel-month');
    for (var y = 1950; y <= 2080; y++) {
      var op = document.createElement('option');
      op.value = y; op.textContent = y + '年';
      selY.appendChild(op);
    }
    for (var m = 0; m < 12; m++) {
      var om = document.createElement('option');
      om.value = m; om.textContent = (m + 1) + '月';
      selM.appendChild(om);
    }
    selY.addEventListener('change', function () { state.viewYear = +selY.value; renderCalendar(); });
    selM.addEventListener('change', function () { state.viewMonth = +selM.value; renderCalendar(); });

    var wd = $('#cal-weekdays');
    WEEK_CN.forEach(function (w, i) {
      var s = document.createElement('span');
      s.textContent = '周' + w;
      if (i >= 5) s.className = 'weekend';
      wd.appendChild(s);
    });
  }

  function changeMonth(delta) {
    if (state.calMode === 'month') {
      var m = state.viewMonth + delta;
      state.viewYear += Math.floor(m / 12);
      state.viewMonth = ((m % 12) + 12) % 12;
    } else {
      // 日/周模式:按天/周移动选中日期
      var d = keyToDate(state.selected || todayKey());
      d.setDate(d.getDate() + delta * (state.calMode === 'week' ? 7 : 1));
      state.selected = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
    }
    if (state.viewYear < 1950) { state.viewYear = 1950; state.viewMonth = 0; }
    if (state.viewYear > 2080) { state.viewYear = 2080; state.viewMonth = 11; }
    renderCalendar();
  }

  // ---- 事件出现日计算(支持重复规则与多天跨度) ----
  // 某天是否是事件的"开始日"(重复事件按规则推算)
  function occStartsOn(t, key) {
    if (!t.date) return false;
    if (t.date === key) return true;
    if (!t.repeat || t.repeat === 'never') return false;
    var d = keyToDate(key), s = keyToDate(t.date);
    if (d < s) return false;
    var diff = Math.round((d - s) / 86400000);
    if (t.repeat === 'daily') return true;
    if (t.repeat === 'weekly') return diff % 7 === 0;
    if (t.repeat === 'monthly') return d.getDate() === s.getDate();
    if (t.repeat === 'yearly') return d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
    return false;
  }
  // 某天是否在事件范围内(含开始~结束的跨天区间)
  function occursOn(t, key) {
    if (!t.date) return false;
    var s = keyToDate(t.date);
    var e = t.endDate ? keyToDate(t.endDate) : s;
    if (e < s) e = s;
    var span = Math.round((e - s) / 86400000);
    var d = keyToDate(key);
    if (d < s) return false;
    if (!t.repeat || t.repeat === 'never') return d <= e;
    for (var i = 0; i <= span; i++) {
      var od = new Date(d);
      od.setDate(d.getDate() - i);
      if (occStartsOn(t, dateKey(od.getFullYear(), od.getMonth(), od.getDate()))) return true;
    }
    return false;
  }
  // 列表排序:全天在前,再按时间
  function timeSortKey(t) { return t.allDay ? '!' : (t.time || '~'); }

  function todosOn(key) {
    return aliveTodos().filter(function (t) { return occursOn(t, key); });
  }

  // ---- 行程冲突检测:同一天且时间相差不到60分钟视为冲突 ----
  function timeToMin(t) { var p = t.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function findConflicts(dateK, time, excludeId) {
    if (!dateK || !time) return [];
    var m = timeToMin(time);
    return aliveTodos().filter(function (t) {
      return t.id !== excludeId && !t.done && !t.allDay && t.time &&
        occStartsOn(t, dateK) &&
        Math.abs(timeToMin(t.time) - m) < 60;
    });
  }
  function conflictText(conflicts) {
    return conflicts.map(function (c) { return '「' + c.title + '」(' + c.time + ')'; }).join('、');
  }

  function buildCell(date, otherMonth) {
    var y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    var key = dateKey(y, m, d);
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.key = key;
    if (otherMonth) cell.classList.add('other');
    if (date.getDay() === 0 || date.getDay() === 6) cell.classList.add('weekend');
    if (key === todayKey()) cell.classList.add('today');
    if (key === state.selected) cell.classList.add('selected');

    var dEl = document.createElement('div');
    dEl.className = 'd'; dEl.textContent = d;
    cell.appendChild(dEl);

    var lunar = Lunar.solar2lunar(date);
    var fests = Holidays.getFestivals(date, lunar);
    var term = Lunar.getTermOfDate(date);
    var sub = document.createElement('div');
    sub.className = 'sub';
    if (fests.length) { sub.textContent = fests[0]; sub.classList.add('fest'); }
    else if (term) { sub.textContent = term; sub.classList.add('fest'); }
    else if (lunar) sub.textContent = lunar.lDay === 1 ? lunar.monthCn : lunar.dayCn;
    cell.appendChild(sub);

    var legal = Holidays.getLegalStatus(date);
    if (legal) {
      var corner = document.createElement('span');
      corner.className = 'corner ' + legal;
      corner.textContent = legal === 'rest' ? '休' : '班';
      cell.appendChild(corner);
    }

    // 事件条:当天的待办直接显示在格子里(全天在前,其余按时间顺序)
    var dayTodos = todosOn(key).slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return timeSortKey(a) < timeSortKey(b) ? -1 : 1;
    });
    if (dayTodos.length) {
      var evs = document.createElement('div');
      evs.className = 'events';
      var maxShow = 2;
      dayTodos.slice(0, maxShow).forEach(function (t) {
        var ev = document.createElement('div');
        ev.className = 'ev' + (t.done ? ' ev-done' : '');
        ev.textContent = (t.allDay ? '全天 ' : (t.time ? t.time + ' ' : '')) + t.title;
        ev.title = ev.textContent;
        ev.addEventListener('click', function (e) {
          e.stopPropagation();
          openTodoModal(t.id);
        });
        evs.appendChild(ev);
      });
      if (dayTodos.length > maxShow) {
        var more = document.createElement('div');
        more.className = 'ev ev-more';
        more.textContent = '+' + (dayTodos.length - maxShow) + ' 更多';
        more.addEventListener('click', function (e) {
          e.stopPropagation();
          state.selected = key;
          renderCalendar();
          openDayModal(key);
        });
        evs.appendChild(more);
      }
      cell.appendChild(evs);
    }

    var tips = [];
    if (lunar) tips.push('农历' + lunar.monthCn + lunar.dayCn);
    if (fests.length) tips.push(fests.join('、'));
    if (term) tips.push(term);
    cell.title = tips.join(' | ');

    cell.addEventListener('click', function () {
      state.selected = key;
      renderCalendar();
      if (state.calMode === 'month') openDayModal(key);
    });
    cell.addEventListener('dblclick', function () {
      openTodoModal(null, { date: key });
    });
    return cell;
  }

  // ---- 日期详情弹窗:点击月视图格子放大查看当天 ----
  function renderDayModal(key) {
    var date = keyToDate(key);
    var lunar = Lunar.solar2lunar(date);
    var fests = Holidays.getFestivals(date, lunar);
    var term = Lunar.getTermOfDate(date);
    var legal = Holidays.getLegalStatus(date);
    var alm = Almanac.getAlmanac(date);
    var weekCn = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];

    $('#day-modal-title').textContent = date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 · 星期' + weekCn +
      (legal === 'rest' ? '(休)' : legal === 'work' ? '(班)' : '');

    var info = $('#day-modal-info');
    info.innerHTML = '';
    var b = document.createElement('b');
    var festText = fests.concat(term ? [term] : []).join('、');
    b.textContent = lunar ? '农历' + lunar.monthCn + lunar.dayCn + ' · ' + lunar.gzYear + lunar.animal + '年 · ' + lunar.gzDay + '日' : '';
    info.appendChild(b);
    if (festText) {
      var f = document.createElement('div');
      f.className = 'fest-tag';
      f.textContent = festText;
      info.appendChild(f);
    }
    info.appendChild(document.createTextNode('宜:' + alm.yi.join(' ') + '  忌:' + alm.ji.join(' ')));

    var ul = $('#day-modal-todos');
    ul.innerHTML = '';
    var items = todosOn(key).slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return timeSortKey(a) < timeSortKey(b) ? -1 : 1;
    });
    items.forEach(function (t) { ul.appendChild(buildTodoItem(t)); });
    $('#day-modal-empty').classList.toggle('hidden', items.length > 0);
  }

  function openDayModal(key) {
    state.dayModalKey = key;
    renderDayModal(key);
    showModal('day-modal');
  }

  function mondayStart(date) {
    var d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function renderCalendar() {
    var mode = state.calMode;
    if (!state.selected) state.selected = todayKey();
    var selDate = keyToDate(state.selected);

    $('#sel-year').value = state.viewYear;
    $('#sel-month').value = state.viewMonth;
    $('#cal-title-label').textContent = state.viewYear + '年' + pad(state.viewMonth + 1) + '月';

    $all('#cal-mode button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    var grid = $('#cal-grid');
    grid.innerHTML = '';
    grid.classList.toggle('week-mode', mode !== 'month');
    $('#cal-weekdays').classList.toggle('hidden', mode === 'day');
    $('#cal-day-panel').classList.toggle('hidden', mode === 'month');

    if (mode === 'month') {
      var first = new Date(state.viewYear, state.viewMonth, 1);
      var startOffset = (first.getDay() + 6) % 7; // 周一开头
      var daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
      var total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
      for (var i = 0; i < total; i++) {
        var date = new Date(state.viewYear, state.viewMonth, i - startOffset + 1);
        grid.appendChild(buildCell(date, date.getMonth() !== state.viewMonth));
      }
    } else if (mode === 'week') {
      var start = mondayStart(selDate);
      state.viewYear = selDate.getFullYear();
      state.viewMonth = selDate.getMonth();
      for (var w = 0; w < 7; w++) {
        var wd = new Date(start);
        wd.setDate(start.getDate() + w);
        grid.appendChild(buildCell(wd, false));
      }
      renderDayPanel(selDate);
    } else {
      // 日视图:不显示网格,只显示当天面板
      state.viewYear = selDate.getFullYear();
      state.viewMonth = selDate.getMonth();
      renderDayPanel(selDate);
    }
    if (mode === 'day') grid.style.display = 'none';
    else grid.style.display = '';
  }

  function renderDayPanel(date) {
    var key = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
    var lunar = Lunar.solar2lunar(date);
    var fests = Holidays.getFestivals(date, lunar);
    var term = Lunar.getTermOfDate(date);
    var alm = Almanac.getAlmanac(date);
    var weekCn = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];

    var info = $('#day-info');
    info.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = (date.getMonth() + 1) + '月' + date.getDate() + '日 星期' + weekCn;
    info.appendChild(b);
    var extras = [];
    if (lunar) extras.push('农历' + lunar.monthCn + lunar.dayCn + ' · ' + lunar.gzYear + lunar.animal + '年');
    if (fests.length) extras.push(fests.join('、'));
    if (term) extras.push(term);
    extras.push('宜:' + alm.yi.slice(0, 3).join(' ') + '  忌:' + alm.ji.slice(0, 3).join(' '));
    info.appendChild(document.createTextNode(extras.join('  |  ')));

    var ul = $('#day-todos');
    ul.innerHTML = '';
    var items = todosOn(key).sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return timeSortKey(a) < timeSortKey(b) ? -1 : 1;
    });
    items.forEach(function (t) { ul.appendChild(buildTodoItem(t)); });
    $('#day-empty').classList.toggle('hidden', items.length > 0);
  }

  // ---------- 四象限 ----------
  function renderQuadrant() {
    [1, 2, 3, 4].forEach(function (q) {
      var ul = document.querySelector('.quad-list[data-q="' + q + '"]');
      ul.innerHTML = '';
      var items = aliveTodos().filter(function (t) { return (t.quad || 4) === q && !t.done; });
      items.forEach(function (t) { ul.appendChild(buildTodoItem(t, { draggable: true })); });
      ul.closest('.quad').classList.toggle('has-items', items.length > 0);
    });
  }

  function bindQuadrant() {
    $all('.quad-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openTodoModal(null, { quad: +btn.dataset.q });
      });
    });
    $all('.quad').forEach(function (quad) {
      quad.addEventListener('dragover', function (e) {
        e.preventDefault();
        quad.classList.add('drag-over');
      });
      quad.addEventListener('dragleave', function () { quad.classList.remove('drag-over'); });
      quad.addEventListener('drop', function (e) {
        e.preventDefault();
        quad.classList.remove('drag-over');
        var id = e.dataTransfer.getData('text/plain');
        var t = state.data.todos.find(function (x) { return x.id === id; });
        if (t) {
          t.quad = +quad.dataset.q;
          save(); renderQuadrant();
          toast('已移至「' + QUAD_NAMES[t.quad] + '」');
        }
      });
    });
  }

  // ---------- 倒计时 ----------
  // 每年重复(公历):今年的 m月d日,已过则取明年
  function nextSolarOccurrence(m, d) {
    var now = keyToDate(todayKey());
    var t = new Date(now.getFullYear(), m - 1, d);
    if (t < now) t = new Date(now.getFullYear() + 1, m - 1, d);
    return t;
  }
  // 每年重复(农历):从今天起找下一个农历 lm月ld日 对应的公历日
  // 某些年份没有三十(小月),回退到廿九
  function nextLunarOccurrence(lm, ld) {
    var now = keyToDate(todayKey());
    for (var tryDay = ld; tryDay >= ld - 1 && tryDay >= 1; tryDay--) {
      for (var i = 0; i <= 385; i++) {
        var t = new Date(now);
        t.setDate(now.getDate() + i);
        var lo = Lunar.solar2lunar(t);
        if (lo && !lo.isLeap && lo.lMonth === lm && lo.lDay === tryDay) return t;
      }
      if (tryDay === ld && ld !== 30) break; // 只有三十才回退
    }
    return null;
  }
  // 计算条目的目标日与说明文字
  function countdownTarget(c) {
    var today = keyToDate(todayKey());
    if (c.type === 'lunar' && c.lunar) {
      var t = nextLunarOccurrence(c.lunar.m, c.lunar.d);
      if (!t) return null;
      var lo = Lunar.solar2lunar(t);
      return {
        target: t,
        sub: '每年农历' + Lunar.MONTH_CN[c.lunar.m - 1] + '月' + Lunar.DAY_CN[c.lunar.d - 1] +
          ' · 下次 ' + t.getFullYear() + '年' + (t.getMonth() + 1) + '月' + t.getDate() + '日' +
          (lo && lo.lDay !== c.lunar.d ? '(' + lo.dayCn + ')' : '')
      };
    }
    if (c.repeat) {
      var p = c.date.split('-').map(Number);
      var t2 = nextSolarOccurrence(p[1], p[2]);
      var lo2 = Lunar.solar2lunar(t2);
      return {
        target: t2,
        sub: '每年' + p[1] + '月' + p[2] + '日 · 下次 ' + t2.getFullYear() + '年' +
          (t2.getMonth() + 1) + '月' + t2.getDate() + '日' +
          (lo2 ? ' · 农历' + lo2.monthCn + lo2.dayCn : '')
      };
    }
    var t3 = keyToDate(c.date);
    var lo3 = Lunar.solar2lunar(t3);
    return {
      target: t3,
      sub: t3.getFullYear() + '年' + (t3.getMonth() + 1) + '月' + t3.getDate() + '日' +
        (lo3 ? ' · 农历' + lo3.monthCn + lo3.dayCn : '')
    };
  }

  function renderCountdowns() {
    var ul = $('#countdown-list');
    ul.innerHTML = '';
    var today = keyToDate(todayKey());
    var list = state.data.countdowns.map(function (c) {
      return { c: c, info: countdownTarget(c) };
    }).filter(function (x) { return x.info; }).sort(function (a, b) {
      return a.info.target - b.info.target;
    });
    list.forEach(function (item) {
      var c = item.c;
      var target = item.info.target;
      var diff = Math.round((target - today) / 86400000);
      var li = document.createElement('li');

      var left = document.createElement('div');
      var name = document.createElement('div'); name.className = 'cd-name'; name.textContent = c.title;
      var dt = document.createElement('div'); dt.className = 'cd-date';
      dt.textContent = item.info.sub;
      left.appendChild(name); left.appendChild(dt);

      var right = document.createElement('div'); right.className = 'cd-days';
      if (diff > 0) right.innerHTML = '还有 ' + diff + '<small> 天</small>';
      else if (diff === 0) right.textContent = '🎉 就是今天';
      else right.innerHTML = '已过 ' + (-diff) + '<small> 天</small>';

      var edit = document.createElement('button');
      edit.className = 'icon-btn'; edit.textContent = '✎'; edit.title = '编辑';
      edit.addEventListener('click', function (e) {
        e.stopPropagation();
        openCountdownModal(c.id);
      });

      var del = document.createElement('button');
      del.className = 'icon-btn'; del.textContent = '🗑'; del.title = '删除';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.data.countdowns = state.data.countdowns.filter(function (x) { return x.id !== c.id; });
        save(); renderCountdowns();
      });

      li.style.cursor = 'pointer';
      li.title = '点击编辑';
      li.addEventListener('click', function () { openCountdownModal(c.id); });

      li.appendChild(left); li.appendChild(right); li.appendChild(edit); li.appendChild(del);
      ul.appendChild(li);
    });
    $('#countdown-empty').classList.toggle('hidden', list.length > 0);
  }

  function initCountdownModal() {
    var selM = $('#cd-lmonth'), selD = $('#cd-lday');
    Lunar.MONTH_CN.forEach(function (m, i) {
      var op = document.createElement('option');
      op.value = i + 1; op.textContent = m + '月';
      selM.appendChild(op);
    });
    Lunar.DAY_CN.forEach(function (d, i) {
      var op = document.createElement('option');
      op.value = i + 1; op.textContent = d;
      selD.appendChild(op);
    });
    $('#cd-type').addEventListener('change', updateCountdownModalRows);
  }

  function updateCountdownModalRows() {
    var isLunar = $('#cd-type').value === 'lunar';
    $('#cd-solar-row').classList.toggle('hidden', isLunar);
    $('#cd-lunar-row').classList.toggle('hidden', !isLunar);
    // 农历模式固定每年重复(生日场景)
    if (isLunar) $('#cd-repeat').checked = true;
    $('#cd-repeat').disabled = isLunar;
  }

  function openCountdownModal(id) {
    state.editingCountdownId = id || null;
    var c = id ? state.data.countdowns.find(function (x) { return x.id === id; }) : null;
    $('#cd-modal-title').textContent = c ? '编辑倒计时 / 纪念日' : '添加倒计时 / 纪念日';
    $('#cd-title').value = c ? c.title : '';
    var isLunar = !!(c && c.type === 'lunar' && c.lunar);
    $('#cd-type').value = isLunar ? 'lunar' : 'solar';
    if (isLunar) {
      $('#cd-lmonth').value = c.lunar.m;
      $('#cd-lday').value = c.lunar.d;
      $('#cd-date').value = toInputDate(todayKey());
    } else {
      $('#cd-date').value = toInputDate(c && c.date ? c.date : todayKey());
      $('#cd-lmonth').value = 1;
      $('#cd-lday').value = 1;
    }
    $('#cd-repeat').checked = isLunar || !!(c && c.repeat);
    updateCountdownModalRows();
    showModal('countdown-modal');
    $('#cd-title').focus();
  }

  function saveCountdownModal() {
    var title = $('#cd-title').value.trim();
    if (!title) { toast('请输入名称'); return; }
    var isLunar = $('#cd-type').value === 'lunar';
    var patch = { title: title };
    if (isLunar) {
      patch.type = 'lunar';
      patch.lunar = { m: +$('#cd-lmonth').value, d: +$('#cd-lday').value };
      patch.repeat = true;
      patch.date = null;
      if (!nextLunarOccurrence(patch.lunar.m, patch.lunar.d)) {
        toast('该农历日期无效,请检查'); return;
      }
    } else {
      var dateV = $('#cd-date').value;
      if (!dateV) { toast('请选择日期'); return; }
      patch.type = 'solar';
      patch.lunar = null;
      patch.date = fromInputDate(dateV);
      patch.repeat = $('#cd-repeat').checked;
    }
    if (state.editingCountdownId) {
      var c = state.data.countdowns.find(function (x) { return x.id === state.editingCountdownId; });
      if (c) Object.assign(c, patch);
      toast('已修改');
    } else {
      patch.id = uid();
      state.data.countdowns.push(patch);
      toast('已添加');
    }
    save(); closeModals(); renderCountdowns();
  }

  // ---------- AI 助手 ----------
  var AI_TITLES = { report: 'AI写周报', chat: 'DeepSeek对话', todo: 'AI写待办' };
  var aiHistory = { report: [], chat: [], todo: [] }; // load() 后指向 state.data.aiHistory 持久化

  function setupAiView() {
    $('#ai-title').textContent = AI_TITLES[state.aiMode] || 'AI助手';
    $('#btn-ai-run').classList.toggle('hidden', state.aiMode !== 'report');
    $('#ai-input').placeholder = state.aiMode === 'todo'
      ? '描述你的目标,如:准备下周的产品发布会'
      : (state.aiMode === 'report' ? '可补充说明,或直接点右上角「生成」' : '输入内容,回车发送');
    renderAiMessages();
    if (state.aiMode === 'report' && !aiHistory.report.length) {
      pushAiMsg('bot', '我可以根据你最近 7 天完成的待办生成一份周报。\n点击右上角「生成」开始;也可以先在下方补充本周工作要点。');
    } else if (state.aiMode === 'todo' && !aiHistory.todo.length) {
      pushAiMsg('bot', '告诉我你的目标,我会拆解成待办并自动排好日期、避开已有日程。\n· "筹备年会"(默认从明天起排期)\n· "7月20日前完成毕业论文初稿"(按期限倒排)\n· "下周三下午交财报,帮我安排准备工作"');
    } else if (state.aiMode === 'chat' && !aiHistory.chat.length) {
      pushAiMsg('bot', '你好!我是贾维斯,可以直接帮你操作日历,试试对我说:\n· "明天下午3点提醒我去游泳"\n· "今天有什么安排?"\n· "游泳这条待办完成了"' + (state.data.apiKey ? '' : '\n(尚未配置 API Key,请点击右上角 ⚙ 设置)'));
    }
  }

  function pushAiMsg(role, text, todoLines) {
    aiHistory[state.aiMode].push({ role: role, text: text, todoLines: todoLines || null });
    if (aiHistory[state.aiMode].length > 200) aiHistory[state.aiMode].shift();
    save();
    renderAiMessages();
  }

  function renderAiMessages() {
    var box = $('#ai-messages');
    box.innerHTML = '';
    (aiHistory[state.aiMode] || []).forEach(function (m) {
      var div = document.createElement('div');
      div.className = 'ai-msg ' + (m.role === 'user' ? 'user' : 'bot');
      div.textContent = m.text;
      if (m.todoLines && m.todoLines.length) {
        var act = document.createElement('div');
        act.className = 'ai-actions';
        var btn = document.createElement('button');
        btn.className = 'pill-btn purple sm';
        btn.textContent = '一键添加为待办 (' + m.todoLines.length + '条)';
        btn.addEventListener('click', function () {
          m.todoLines.forEach(function (line) {
            if (typeof line === 'string') { addQuickTodo(line); return; }
            addQuickTodo(line.title, {
              date: line.date || null,
              time: line.time || null,
              remind: !!(line.date && line.time)
            });
          });
          toast('已添加 ' + m.todoLines.length + ' 条待办');
        });
        act.appendChild(btn);
        div.appendChild(act);
      }
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function dsRequest(messages, tools, cb) {
    var key = state.data.apiKey;
    if (!key) { cb(null, 'no-key'); return; }
    state.aiBusy = true;
    var body = { model: 'deepseek-chat', messages: messages, temperature: 0.7 };
    if (tools) body.tools = tools;
    fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      state.aiBusy = false;
      var msg = j.choices && j.choices[0] && j.choices[0].message;
      if (!msg) { cb(null, '空回复'); return; }
      cb(msg, null);
    }).catch(function (e) {
      state.aiBusy = false;
      cb(null, e.message || 'error');
    });
  }

  function callDeepSeek(messages, cb) {
    dsRequest(messages, null, function (msg, err) {
      cb(msg ? (msg.content || '(空回复)') : null, err);
    });
  }

  // ---- AI 工具调用:让对话能真正操作日历 ----
  var AI_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'add_todo',
        description: '为用户创建一条待办/日程。用户要求记录、安排、提醒某件事时必须调用。相对日期(明天、下周一等)必须换算为具体日期后传入。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '待办内容,简洁' },
            date: { type: 'string', description: '开始日期 YYYY-MM-DD,可选' },
            time: { type: 'string', description: '开始时间 HH:mm,24小时制,可选' },
            end_date: { type: 'string', description: '结束日期 YYYY-MM-DD,跨天事件用,可选' },
            end_time: { type: 'string', description: '结束时间 HH:mm,可选' },
            all_day: { type: 'boolean', description: '是否全天事件' },
            repeat: { type: 'string', enum: ['never', 'daily', 'weekly', 'monthly', 'yearly'], description: '重复规则,默认never' },
            remind: { type: 'boolean', description: '是否到点提醒,默认在有日期和时间时为true' },
            note: { type: 'string', description: '备注,可选' },
            list: { type: 'string', description: '清单名称。根据待办内容从用户已有清单中选择最合适的,不确定时不填' },
            quadrant: { type: 'integer', enum: [1, 2, 3, 4], description: '四象限:1重要且紧急 2重要不紧急 3不重要但紧急 4不重要不紧急' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_todos',
        description: '查询用户的待办。可按日期过滤;不传date则返回全部未完成待办。',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '日期 YYYY-MM-DD,可选' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'complete_todo',
        description: '把某条待办标记为已完成。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '待办标题(或标题中的关键词)' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_todo',
        description: '删除一条待办。用户要求删除、取消,或者合并/替换旧任务时使用(不要用complete_todo代替删除,完成只表示事情真的做完了)。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '待办标题(或标题中的关键词)' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'check_conflict',
        description: '检查某个日期时间是否与现有待办冲突(前后1小时内有其他日程)。为用户安排带时间的日程前,或用户询问某时段是否有空时调用。',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '日期 YYYY-MM-DD' },
            time: { type: 'string', description: '时间 HH:mm' }
          },
          required: ['date', 'time']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_countdown',
        description: '创建倒计时/纪念日。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            date: { type: 'string', description: '目标日期 YYYY-MM-DD' }
          },
          required: ['title', 'date']
        }
      }
    }
  ];

  // 宽容解析日期/时间:自动补零,非法返回 null
  function normDateArg(s) {
    var m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return m[1] + '-' + mo + '-' + d; // 内部 key 格式
  }
  function normTimeArg(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var h = +m[1];
    if (h > 23 || +m[2] > 59) return null;
    return pad(h) + ':' + m[2];
  }
  // 按名称匹配清单(全等优先,其次互相包含)
  function matchListByName(name) {
    var ln = String(name || '').trim();
    if (!ln) return null;
    return state.data.lists.find(function (l) { return l.name === ln; }) ||
      state.data.lists.find(function (l) { return l.name.indexOf(ln) !== -1 || ln.indexOf(l.name) !== -1; }) ||
      null;
  }

  function execTool(name, argsJson) {
    var args;
    try { args = typeof argsJson === 'string' ? JSON.parse(argsJson) : (argsJson || {}); }
    catch (e) { return '失败:参数格式错误'; }

    if (name === 'add_todo') {
      if (!args.title) return '失败:缺少标题';
      var extra = { quad: args.quadrant || 2, note: args.note || '' };
      var warns = [];
      if (args.date) {
        var nd = normDateArg(args.date);
        if (nd) extra.date = nd;
        else warns.push('日期"' + args.date + '"格式无效(应为YYYY-MM-DD),未设置日期');
      }
      extra.allDay = !!args.all_day;
      if (!extra.allDay && args.time) {
        var nt = normTimeArg(args.time);
        if (nt) extra.time = nt;
        else warns.push('时间"' + args.time + '"格式无效(应为HH:mm),未设置时间');
      }
      if (args.end_date) {
        var ned = normDateArg(args.end_date);
        if (ned) extra.endDate = ned;
      }
      if (!extra.allDay && args.end_time) {
        var net = normTimeArg(args.end_time);
        if (net) extra.endTime = net;
      }
      if (args.repeat && ['daily', 'weekly', 'monthly', 'yearly'].indexOf(args.repeat) !== -1) extra.repeat = args.repeat;
      var listMatch = null;
      if (args.list) {
        listMatch = matchListByName(args.list);
        if (listMatch) extra.listId = listMatch.id;
      }
      extra.remind = args.remind !== false && !!(extra.date && extra.time);
      var created = addQuickTodo(args.title, extra);
      var conflicts = findConflicts(extra.date, extra.time, created.id);
      return '成功:已创建待办「' + args.title + '」' +
        (extra.date ? ' 日期' + extra.date : '') +
        (extra.allDay ? ' 全天' : '') +
        (extra.time ? ' ' + extra.time : '') +
        (extra.endTime ? '-' + extra.endTime : '') +
        (extra.repeat && extra.repeat !== 'never' ? '(' + REPEAT_CN[extra.repeat] + '重复)' : '') +
        (listMatch ? ' 清单「' + listMatch.name + '」' : '') +
        (extra.remind ? '(已开启到点提醒)' : '') +
        (conflicts.length ? '。提示:同时段还有 ' + conflictText(conflicts) : '') +
        (warns.length ? '。⚠ ' + warns.join(';') + ',请修正后重新创建或告知用户' : '');
    }
    if (name === 'list_todos') {
      var items = aliveTodos();
      if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        var k = fromInputDate(args.date);
        items = items.filter(function (t) { return t.date === k; });
      } else {
        items = items.filter(function (t) { return !t.done; });
      }
      if (!items.length) return '没有找到相关待办';
      return items.slice(0, 20).map(function (t) {
        return (t.done ? '[已完成] ' : '[未完成] ') + t.title +
          (t.date ? ' @' + t.date + (t.time ? ' ' + t.time : '') : '');
      }).join('\n');
    }
    if (name === 'complete_todo') {
      if (!args.title) return '失败:缺少标题';
      var kw = args.title;
      var t = aliveTodos().find(function (x) { return !x.done && x.title.indexOf(kw) !== -1; });
      if (!t) return '失败:未找到未完成的待办「' + kw + '」';
      t.done = true; t.doneAt = Date.now();
      save(); refreshAll();
      return '成功:已完成「' + t.title + '」';
    }
    if (name === 'delete_todo') {
      if (!args.title) return '失败:缺少标题';
      var kw2 = args.title;
      var t2 = aliveTodos().find(function (x) { return x.title.indexOf(kw2) !== -1; });
      if (!t2) return '失败:未找到待办「' + kw2 + '」';
      t2.deleted = true;
      save(); refreshAll();
      return '成功:已删除「' + t2.title + '」';
    }
    if (name === 'check_conflict') {
      var cd = normDateArg(args.date), ct = normTimeArg(args.time);
      if (!cd || !ct) return '失败:日期或时间格式无效(应为YYYY-MM-DD和HH:mm)';
      var cfs = findConflicts(cd, ct, null);
      if (!cfs.length) return args.date + ' ' + args.time + ' 前后1小时内没有其他日程,时段空闲';
      return '该时段附近已有 ' + conflictText(cfs) + '(同一时间安排多个事项也是允许的)';
    }
    if (name === 'add_countdown') {
      var cdd = normDateArg(args.date);
      if (!args.title || !cdd) return '失败:参数不完整或日期格式无效';
      state.data.countdowns.push({ id: uid(), title: args.title, date: cdd, type: 'solar', repeat: false });
      save(); refreshAll();
      return '成功:已创建倒计时「' + args.title + '」→ ' + args.date;
    }
    return '失败:未知工具';
  }

  function chatSysPrompt() {
    var now = new Date();
    var lunar = Lunar.solar2lunar(now);
    var weekCn = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    return '你是"贾维斯桌面日历"的内置中文助手,名叫贾维斯。今天是' +
      now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + weekCn +
      (lunar ? ',农历' + lunar.monthCn + lunar.dayCn : '') +
      ',当前时间' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + '。\n' +
      '你可以调用工具直接操作用户的日历:创建待办(add_todo)、查询待办(list_todos)、完成待办(complete_todo)、删除待办(delete_todo)、创建倒计时(add_countdown)。\n' +
      '用户现有清单:' + state.data.lists.map(function (l) { return '「' + l.name + '」'; }).join('、') +
      '。创建待办时用list参数按内容选择最匹配的清单(如学习类放学术相关清单),没有明显匹配就不填。\n' +
      '规则:1) 用户要求记录/安排/提醒事项时,必须实际调用add_todo,不要只口头答应;2) "明天""下周三"等相对日期必须换算成具体日期;3) 只提到时间没提日期时默认今天(时间已过则为明天);4) 支持全天(all_day)、结束时间(end_time)、跨天(end_date)和重复(repeat:daily/weekly/monthly/yearly),用户说"每天/每周/每月/每年"时设置repeat,说"全天"时设置all_day;5) 同一时间安排多个事项是允许的,按时间顺序排列即可——不要主动建议合并或改时间,只在add_todo结果提示同时段有其他事项时顺带告知用户一句;6) 用户明确要求合并、替换、改期或取消任务时,先delete_todo删除旧待办再add_todo创建新的——严禁用complete_todo代替删除,完成只用于用户真的做完了某件事;7) 严禁在没有调用工具的情况下声称"已创建/已删除/已完成";工具结果里出现"失败"或"⚠"时必须处理(修正参数重试或如实告知用户),不能报成功;8) 操作完成后用一句话确认结果,回复简洁。';
  }

  function todoSysPrompt() {
    var now = new Date();
    var weekCn = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    return '你是"贾维斯桌面日历"的任务规划助手。今天是' +
      now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + weekCn + '。\n' +
      '用户现有清单:' + state.data.lists.map(function (l) { return '「' + l.name + '」'; }).join('、') + '。\n' +
      '把用户的目标拆解为5-8条具体、可执行的待办,并调用add_todo逐条实际创建(用list参数选择内容最匹配的清单)。规则:\n' +
      '1) 为每条待办安排合理的date(YYYY-MM-DD),需要的话加time,默认从明天开始按先后顺序排期,分布要合理;\n' +
      '2) 用户指定了日期、期限或截止时间时严格遵守,并从截止日倒排;\n' +
      '3) 每条标题不超过30字,具体可执行;\n' +
      '4) 同一时间已有其他事项是允许的,不需要刻意避开或合并,按时间顺序排列即可;工具结果若提示同时段有其他事项,在总结中顺带告知;\n' +
      '5) 全部创建后用简短列表总结:「日期 · 待办内容」,不要重复啰嗦。';
  }

  function chatWithTools(round, msgs) {
    if (round > 6) { pushAiMsg('bot', '(操作步骤过多,已停止)'); return; }
    dsRequest(msgs, AI_TOOLS, function (msg, err) {
      if (err === 'no-key') { pushAiMsg('bot', '请先在右上角 ⚙ 设置中填入 DeepSeek API Key 才能对话。'); return; }
      if (err) { pushAiMsg('bot', '请求失败:' + err); return; }
      if (msg.tool_calls && msg.tool_calls.length) {
        msgs.push(msg);
        msg.tool_calls.forEach(function (tc) {
          var result = execTool(tc.function.name, tc.function.arguments);
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
        });
        chatWithTools(round + 1, msgs);
      } else {
        pushAiMsg('bot', msg.content || '(已完成)');
      }
    });
  }

  function extractTodoLines(text) {
    return text.split('\n').map(function (s) {
      return s.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim();
    }).filter(function (s) { return s && s.length <= 60 && !/^[#>]/.test(s); }).slice(0, 12);
  }

  function offlineReport() {
    var now = Date.now();
    var recent = state.data.todos.filter(function (t) {
      return t.done && t.doneAt && now - t.doneAt < 7 * 86400000 && !t.deleted;
    });
    var undone = aliveTodos().filter(function (t) { return !t.done; });
    var lines = ['【本周工作周报】(本地生成)', '', '一、本周完成(' + recent.length + '项)'];
    if (recent.length) recent.forEach(function (t, i) { lines.push((i + 1) + '. ' + t.title); });
    else lines.push('(本周暂无已完成的待办)');
    lines.push('', '二、进行中 / 下周计划(' + undone.length + '项)');
    undone.slice(0, 10).forEach(function (t, i) { lines.push((i + 1) + '. ' + t.title); });
    if (!undone.length) lines.push('(暂无未完成事项)');
    lines.push('', '提示:在设置中配置 DeepSeek API Key 后,可生成更完整的润色版周报。');
    return lines.join('\n');
  }

  function aiSend() {
    if (state.aiBusy) { toast('AI 正在思考中...'); return; }
    var input = $('#ai-input');
    var text = input.value.trim();
    var mode = state.aiMode;

    if (mode === 'report' && !text) { aiGenerateReport(''); return; }
    if (!text) return;
    input.value = '';
    pushAiMsg('user', text);

    if (mode === 'report') { aiGenerateReport(text); return; }

    if (mode === 'todo') {
      if (state.data.apiKey) {
        // 在线:AI 直接调用工具逐条创建并自动排期、检查冲突
        chatWithTools(0, [{ role: 'system', content: todoSysPrompt() }, { role: 'user', content: text }]);
      } else {
        // 离线模板:从明天开始逐日排期,点按钮一键添加
        var tplLines = ['明确「' + text + '」的目标和截止时间', '收集所需资料与资源', '拆解任务并排定优先级', '完成第一个关键步骤', '中期检查进度并调整', '完成收尾并复盘总结'];
        var base = keyToDate(todayKey());
        var items = tplLines.map(function (l, i) {
          var d = new Date(base);
          d.setDate(d.getDate() + 1 + i);
          return { title: l, date: dateKey(d.getFullYear(), d.getMonth(), d.getDate()) };
        });
        pushAiMsg('bot', '未配置 API Key,已用本地模板拆解并从明天起逐日排期:\n\n' + items.map(function (it, i) {
          var d = keyToDate(it.date);
          return (i + 1) + '. ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + it.title;
        }).join('\n'), items);
      }
      return;
    }

    // chat:带工具调用,能真正创建/查询/完成待办
    var history = aiHistory.chat.filter(function (m) { return !m.todoLines; }).slice(-12).map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text };
    });
    chatWithTools(0, [{ role: 'system', content: chatSysPrompt() }].concat(history));
  }

  function aiGenerateReport(extra) {
    var base = offlineReport();
    if (!state.data.apiKey) {
      pushAiMsg('bot', base);
      return;
    }
    pushAiMsg('bot', '正在生成周报...');
    var sys = '你是周报撰写助手。根据用户提供的已完成/未完成待办清单' + (extra ? '和补充说明' : '') + ',写一份简洁专业的中文周报,分"本周完成、进行中、下周计划"三部分。';
    callDeepSeek([
      { role: 'system', content: sys },
      { role: 'user', content: base + (extra ? '\n\n补充说明:' + extra : '') }
    ], function (res, err) {
      aiHistory.report.pop(); // 移除"正在生成"
      if (err) pushAiMsg('bot', '请求失败(' + err + '),以下是本地版本:\n\n' + base);
      else pushAiMsg('bot', res);
    });
  }

  // ---------- 导入 ----------
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = reader.result;
        var count = 0;
        if (file.name.endsWith('.json')) {
          var arr = JSON.parse(text);
          if (Array.isArray(arr)) {
            arr.forEach(function (item) {
              var title = typeof item === 'string' ? item : item.title;
              if (title) { addQuickTodo(String(title).slice(0, 80)); count++; }
            });
          }
        } else {
          text.split(/\r?\n/).forEach(function (line) {
            line = line.trim();
            if (line) { addQuickTodo(line.slice(0, 80)); count++; }
          });
        }
        toast('已导入 ' + count + ' 条待办');
      } catch (e) {
        toast('导入失败:文件格式不正确');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // ---------- 搜索 ----------
  function renderSearch() {
    var kw = $('#search-input').value.trim().toLowerCase();
    var ul = $('#search-results');
    ul.innerHTML = '';
    if (!kw) return;
    aliveTodos().filter(function (t) {
      return t.title.toLowerCase().indexOf(kw) !== -1 || (t.note || '').toLowerCase().indexOf(kw) !== -1;
    }).slice(0, 20).forEach(function (t) {
      var li = document.createElement('li');
      var l = findList(t.listId);
      li.innerHTML = '';
      var tt = document.createElement('div'); tt.textContent = (t.done ? '✓ ' : '○ ') + t.title;
      var meta = document.createElement('div'); meta.className = 'sr-meta';
      meta.textContent = (l ? l.name : '') + (t.date ? ' · ' + t.date : '');
      li.appendChild(tt); li.appendChild(meta);
      li.addEventListener('click', function () {
        closeModals();
        state.activeListId = t.listId;
        switchView('todos');
        renderSidebar();
      });
      ul.appendChild(li);
    });
  }

  // ---------- 提醒 ----------
  function notify(title, body) {
    if (window.electronAPI && window.electronAPI.notify) {
      window.electronAPI.notify(title, body);
    } else if ('Notification' in window) {
      if (Notification.permission === 'granted') new Notification(title, { body: body });
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(function (p) {
          if (p === 'granted') new Notification(title, { body: body });
        });
      }
    }
    toast('🔔 ' + title + ' ' + body);
  }

  function checkReminders() {
    var now = new Date();
    var key = todayKey();
    var hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var changed = false;
    state.data.todos.forEach(function (t) {
      // 重复事件用 notifiedOn 记录"今天已提醒过",每个重复日都能再次提醒
      if (t.remind && !t.done && !t.deleted && !t.allDay && t.time &&
          t.notifiedOn !== key && occStartsOn(t, key) && t.time <= hhmm) {
        notify('待办提醒:' + t.title, t.time + (t.note ? ' · ' + t.note : ''));
        t.notifiedOn = key;
        changed = true;
      }
    });
    if (changed) save();
  }

  var lastDay = new Date().getDate();
  function checkDayChange() {
    var d = new Date().getDate();
    if (d !== lastDay) {
      lastDay = d;
      refreshAll();
    }
  }

  // ---------- 弹窗通用 ----------
  function showModal(id) {
    $('#modal-mask').classList.remove('hidden');
    $all('.modal').forEach(function (m) { m.classList.add('hidden'); });
    $('#' + id).classList.remove('hidden');
  }
  function closeModals() {
    $('#modal-mask').classList.add('hidden');
    $all('.modal').forEach(function (m) { m.classList.add('hidden'); });
  }

  // ---------- 全局刷新 ----------
  function refreshAll() {
    renderSidebar();
    if (state.view === 'todos' || state.statusFilter) renderTodos();
    if (state.view === 'calendar') renderCalendar();
    if (state.view === 'quadrant') renderQuadrant();
    if (state.view === 'countdown') renderCountdowns();
    if (state.view === 'news') renderStats();
    // 日期详情弹窗打开时同步刷新
    if (state.dayModalKey && !$('#day-modal').classList.contains('hidden')) {
      renderDayModal(state.dayModalKey);
    }
  }

  // ---------- 清单弹窗(新建/编辑,含颜色) ----------
  var LIST_COLORS = ['#4d8dff', '#38bde8', '#2fbf71', '#ffb35c', '#ff5f5f', '#8b5cf6', '#f472b6', '#eab308'];
  var listModalColor = LIST_COLORS[0];

  function initListModal() {
    var box = $('#list-colors');
    LIST_COLORS.forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'color-swatch';
      s.style.background = c;
      s.dataset.color = c;
      s.addEventListener('click', function () { selectListColor(c); });
      box.appendChild(s);
    });
  }
  function selectListColor(c) {
    listModalColor = c;
    $all('#list-colors .color-swatch').forEach(function (s) {
      s.classList.toggle('sel', s.dataset.color === c);
    });
  }
  function openListModal(id) {
    state.editingListId = id || null;
    var l = id ? findList(id) : null;
    $('#list-modal-title').textContent = l ? '编辑清单' : '新建清单';
    $('#list-name').value = l ? l.name : '';
    $('#list-name').disabled = !!(l && l.id === 'default');
    selectListColor(l && l.color ? l.color : LIST_COLORS[0]);
    showModal('list-modal');
    if (!(l && l.id === 'default')) $('#list-name').focus();
  }

  // ---------- 数据备份(导出/导入统一 JSON 格式) ----------
  function doExport() {
    var content = JSON.stringify({
      app: 'jarvis-calendar',
      version: 2,
      exportedAt: new Date().toISOString(),
      data: state.data
    }, null, 2);
    var fname = '贾维斯日历备份-' + toInputDate(todayKey()) + '.json';
    if (window.electronAPI && window.electronAPI.exportData) {
      window.electronAPI.exportData(content, fname).then(function (res) {
        if (res && res.ok) toast('已导出到:' + res.path);
        else if (res && !res.canceled) toast('导出失败:' + (res.error || '未知错误'));
      });
    } else {
      var blob = new Blob([content], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('备份文件已下载');
    }
  }

  function applyImport(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { toast('导入失败:文件格式错误'); return; }
    var d = obj && obj.data;
    if (!d || !Array.isArray(d.todos) || !Array.isArray(d.lists)) {
      toast('导入失败:不是有效的贾维斯日历备份文件'); return;
    }
    if (!confirm('导入将覆盖当前全部数据(备份含 ' + d.todos.length + ' 条待办、' +
      d.lists.length + ' 个清单),确定继续?')) return;
    state.data = d;
    normalizeData();
    aiHistory = state.data.aiHistory;
    save();
    state.activeListId = 'default';
    applyWallpaper();
    applyEdgeHide();
    if (state.data.pinned) $('#btn-pin').classList.add('active');
    else $('#btn-pin').classList.remove('active');
    if (window.electronAPI && window.electronAPI.setPin) window.electronAPI.setPin(!!state.data.pinned);
    closeModals();
    refreshAll();
    toast('导入成功');
  }

  function doImport() {
    if (window.electronAPI && window.electronAPI.importData) {
      window.electronAPI.importData().then(function (res) {
        if (res && res.ok && res.content) applyImport(res.content);
        else if (res && !res.canceled) toast('读取文件失败');
      });
    } else {
      $('#backup-file').click();
    }
  }

  // ---------- 概览统计(饼图 + 各清单任务数) ----------
  function renderStats() {
    var today = keyToDate(todayKey());
    var alive = aliveTodos();
    var done = alive.filter(function (t) { return t.done; });
    var undone = alive.filter(function (t) { return !t.done; });
    var overdue = undone.filter(function (t) {
      if (!t.date || (t.repeat && t.repeat !== 'never')) return false;
      return keyToDate(t.endDate || t.date) < today;
    });
    // 未开始:开始日期在未来的任务
    var notStarted = undone.filter(function (t) {
      return t.date && keyToDate(t.date) > today;
    });
    var active = undone.length - overdue.length - notStarted.length;

    var SC = state.data.statusColors;
    var cats = [
      { name: '进行中', count: active, color: SC.active, view: 'status-active' },
      { name: '未开始', count: notStarted.length, color: SC.notstarted, view: 'status-notstarted' },
      { name: '已逾期', count: overdue.length, color: SC.overdue, view: 'status-overdue' },
      { name: '已完成', count: done.length, color: SC.done, view: 'status-done' }
    ];
    function gotoStatus(view) {
      switchView(view);
      renderSidebar();
    }
    var total = cats.reduce(function (s, c) { return s + c.count; }, 0);

    var svg = $('#stats-pie');
    var legend = $('#stats-legend');
    svg.innerHTML = '';
    legend.innerHTML = '';

    var NS = 'http://www.w3.org/2000/svg';
    function mkEl(tag, attrs) {
      var el = document.createElementNS(NS, tag);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    function lighten(hex, t) {
      var n = parseInt(hex.slice(1), 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgb(' + Math.round(r + (255 - r) * t) + ',' + Math.round(g + (255 - g) * t) + ',' + Math.round(b + (255 - b) * t) + ')';
    }
    function shade(hex, f) {
      var n = parseInt(hex.slice(1), 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
    }

    if (!total) {
      var txt = mkEl('text', { x: 130, y: 105, 'text-anchor': 'middle', fill: 'rgba(235,240,248,.5)', 'font-size': '13' });
      txt.textContent = '暂无任务';
      svg.appendChild(txt);
    } else {
      // 3D 透视饼图:椭圆顶面 + 前侧厚度 + 渐变高光 + 底部光晕
      var cx = 130, cy = 84, rx = 104, ry = 56, depth = 26;
      function ptTop(a) { return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; }

      var defs = mkEl('defs', {});
      cats.forEach(function (c, i) {
        var grad = mkEl('linearGradient', { id: 'pie-g' + i, x1: '0', y1: '0', x2: '0', y2: '1' });
        grad.appendChild(mkEl('stop', { offset: '0%', 'stop-color': lighten(c.color, 0.4) }));
        grad.appendChild(mkEl('stop', { offset: '100%', 'stop-color': c.color }));
        defs.appendChild(grad);
        var gradW = mkEl('linearGradient', { id: 'pie-w' + i, x1: '0', y1: '0', x2: '0', y2: '1' });
        gradW.appendChild(mkEl('stop', { offset: '0%', 'stop-color': shade(c.color, 0.62) }));
        gradW.appendChild(mkEl('stop', { offset: '100%', 'stop-color': shade(c.color, 0.38) }));
        defs.appendChild(gradW);
        defs.appendChild(grad);
      });
      var blur = mkEl('filter', { id: 'pie-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' });
      blur.appendChild(mkEl('feGaussianBlur', { stdDeviation: '7' }));
      defs.appendChild(blur);
      svg.appendChild(defs);

      // 底部霓虹光晕
      svg.appendChild(mkEl('ellipse', {
        cx: cx, cy: cy + depth + 12, rx: rx * 0.94, ry: ry * 0.6,
        fill: 'rgba(77,141,255,.30)', filter: 'url(#pie-blur)'
      }));

      // 计算各扇区角度(从顶部 -90° 起)
      var segs = [];
      var angle = -Math.PI / 2;
      cats.forEach(function (c, i) {
        if (!c.count) return;
        var a1 = angle + c.count / total * Math.PI * 2;
        segs.push({ c: c, i: i, a0: angle, a1: a1, frac: c.count / total });
        angle = a1;
      });

      // 1) 前侧厚度墙(只画朝向观察者的 0~π 部分),先画避免遮挡顶面
      segs.forEach(function (s) {
        var f0 = Math.max(s.a0, 0), f1 = Math.min(s.a1, Math.PI);
        if (s.frac >= 0.9999) { f0 = 0; f1 = Math.PI; }
        if (f1 <= f0) return;
        var p0 = ptTop(f0), p1 = ptTop(f1);
        var d = 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) +
          ' A' + rx + ',' + ry + ' 0 0 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2) +
          ' L' + p1[0].toFixed(2) + ',' + (p1[1] + depth).toFixed(2) +
          ' A' + rx + ',' + ry + ' 0 0 0 ' + p0[0].toFixed(2) + ',' + (p0[1] + depth).toFixed(2) + ' Z';
        svg.appendChild(mkEl('path', { d: d, fill: 'url(#pie-w' + s.i + ')', stroke: 'rgba(0,0,0,.25)', 'stroke-width': '0.6' }));
      });

      // 2) 顶面扇区
      segs.forEach(function (s) {
        var el;
        if (s.frac >= 0.9999) {
          el = mkEl('ellipse', { cx: cx, cy: cy, rx: rx, ry: ry });
        } else {
          var p0 = ptTop(s.a0), p1 = ptTop(s.a1);
          var large = s.frac > 0.5 ? 1 : 0;
          el = mkEl('path', {
            d: 'M' + cx + ',' + cy + ' L' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) +
              ' A' + rx + ',' + ry + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2) + ' Z'
          });
        }
        el.setAttribute('fill', 'url(#pie-g' + s.i + ')');
        el.setAttribute('stroke', 'rgba(10,14,22,.5)');
        el.setAttribute('stroke-width', '1');
        el.style.cursor = 'pointer';
        var tip = document.createElementNS(NS, 'title');
        tip.textContent = s.c.name + ':' + s.c.count + ' 条(' + Math.round(s.frac * 100) + '%),点击查看';
        el.appendChild(tip);
        el.addEventListener('click', function () { gotoStatus(s.c.view); });
        svg.appendChild(el);
      });

      // 3) 顶面高光弧,增强立体感
      svg.appendChild(mkEl('ellipse', {
        cx: cx, cy: cy - 2, rx: rx * 0.62, ry: ry * 0.5,
        fill: 'rgba(255,255,255,.06)', 'pointer-events': 'none'
      }));
    }

    cats.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'legend-row clickable';
      row.title = '点击查看「' + c.name + '」';
      var dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = c.color;
      var name = document.createElement('span');
      name.textContent = c.name;
      var cnt = document.createElement('span');
      cnt.className = 'legend-count';
      cnt.textContent = c.count + ' 条' + (total ? '(' + Math.round(c.count / total * 100) + '%)' : '');
      row.appendChild(dot); row.appendChild(name); row.appendChild(cnt);
      row.addEventListener('click', function () { gotoStatus(c.view); });
      legend.appendChild(row);
    });

    // 各清单任务数:进度条按任务状态分色堆叠(与饼图同色),长度按总数比例
    var SEGS = [
      { key: 'active', name: '进行中', color: SC.active },
      { key: 'notstarted', name: '未开始', color: SC.notstarted },
      { key: 'overdue', name: '已逾期', color: SC.overdue },
      { key: 'done', name: '已完成', color: SC.done }
    ];
    function segCounts(items) {
      var seg = { active: 0, notstarted: 0, overdue: 0, done: 0 };
      items.forEach(function (t) {
        if (t.done) seg.done++;
        else if (t.date && (!t.repeat || t.repeat === 'never') && keyToDate(t.endDate || t.date) < today) seg.overdue++;
        else if (t.date && keyToDate(t.date) > today) seg.notstarted++;
        else seg.active++;
      });
      return seg;
    }

    var box = $('#stats-lists');
    box.innerHTML = '';
    var rows = [{ id: '__all__', name: '全部清单', items: alive }].concat(
      state.data.lists.map(function (l) {
        return { id: l.id, name: l.name, items: alive.filter(function (t) { return t.listId === l.id; }) };
      })
    );
    var max = 1;
    var grandTotal = alive.length;
    rows.forEach(function (rw) {
      rw.total = rw.items.length;
      rw.seg = segCounts(rw.items);
      max = Math.max(max, rw.total);
    });
    rows.forEach(function (rw) {
      var row = document.createElement('div');
      row.className = 'list-bar-row clickable';
      row.title = '点击打开「' + rw.name + '」';
      row.addEventListener('click', function () {
        state.activeListId = rw.id;
        switchView('todos');
        renderSidebar();
      });
      var name = document.createElement('span');
      name.className = 'list-bar-name';
      name.textContent = rw.name;
      name.title = rw.name;
      var track = document.createElement('div');
      track.className = 'list-bar-track';
      var fill = document.createElement('div');
      fill.className = 'list-bar-fill';
      fill.style.width = rw.total ? (rw.total / max * 100) + '%' : '0';
      SEGS.forEach(function (s) {
        var n = rw.seg[s.key];
        if (!n) return;
        var part = document.createElement('div');
        part.className = 'list-bar-seg';
        part.style.width = (n / rw.total * 100) + '%';
        part.style.background = s.color;
        part.title = s.name + ' ' + n + ' 条';
        fill.appendChild(part);
      });
      track.appendChild(fill);
      var cnt = document.createElement('span');
      cnt.className = 'list-bar-count';
      if (rw.id === '__all__') {
        cnt.textContent = String(rw.total);
        cnt.title = '全部任务总数(不含已删除)';
      } else {
        cnt.textContent = rw.total + ' / ' + grandTotal;
        cnt.title = '该清单任务数 / 全部任务数(均不含已删除)';
      }
      row.appendChild(name); row.appendChild(track); row.appendChild(cnt);
      box.appendChild(row);
    });
  }

  // ---------- 壁纸 / 透明度 / 停靠 ----------
  function applyWallpaper() {
    document.body.dataset.wp = state.data.wallpaper || 'aurora';
    var op = Math.max(15, Math.min(100, state.data.opacity || 100));
    $('#wallpaper').style.opacity = op / 100;
  }
  function applyEdgeHide() {
    if (window.electronAPI && window.electronAPI.setEdgeHide) {
      window.electronAPI.setEdgeHide(!!state.data.edgeHide);
    }
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    // 侧边栏固定项
    $all('.side-item[data-view]').forEach(function (el) {
      el.addEventListener('click', function () {
        switchView(el.dataset.view);
        renderSidebar();
      });
    });

    $('#btn-add-list').addEventListener('click', function () { openListModal(null); });
    $('#list-save').addEventListener('click', function () {
      var name = $('#list-name').value.trim();
      if (state.editingListId) {
        var l = findList(state.editingListId);
        if (l) {
          if (l.id !== 'default' && name) l.name = name;
          l.color = listModalColor;
        }
        save(); closeModals(); refreshAll();
        toast('清单已更新');
      } else {
        if (!name) { toast('请输入清单名称'); return; }
        var nl = { id: uid(), name: name, color: listModalColor };
        state.data.lists.push(nl);
        state.activeListId = nl.id;
        save(); closeModals();
        switchView('todos'); renderSidebar();
        toast('清单已创建');
      }
    });
    $('#list-cancel').addEventListener('click', closeModals);

    // 数据备份
    $('#btn-export').addEventListener('click', doExport);
    $('#btn-import-data').addEventListener('click', doImport);
    $('#backup-file').addEventListener('change', function () {
      if (this.files && this.files[0]) {
        var reader = new FileReader();
        reader.onload = function () { applyImport(reader.result); };
        reader.readAsText(this.files[0], 'utf-8');
      }
      this.value = '';
    });

    // 快速添加
    $('#quick-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = this.value.trim();
        if (!v) return;
        this.value = '';
        addQuickTodo(v);
        toast('已添加');
      }
    });
    // 双击空白创建
    $('#todos-body').addEventListener('dblclick', function (e) {
      if (e.target === this || e.target.id === 'todos-list' || e.target.closest('.empty-state')) {
        openTodoModal(null);
      }
    });
    $('#day-todos').addEventListener('dblclick', function (e) {
      if (e.target === this) openTodoModal(null, { date: state.selected });
    });

    $('#btn-filter-done').addEventListener('click', function () {
      state.hideDone = !state.hideDone;
      this.classList.toggle('active', state.hideDone);
      renderTodos();
      toast(state.hideDone ? '已隐藏已完成' : '显示全部');
    });
    $('#btn-sort').addEventListener('click', function () {
      toast('默认排序:未完成在前,新建在前');
    });
    $('#btn-purge-all').addEventListener('click', function () {
      var n = state.data.todos.filter(function (t) { return t.deleted; }).length;
      if (!n) return;
      if (!confirm('确定要彻底删除全部 ' + n + ' 条已删除待办吗?此操作不可恢复!')) return;
      state.data.todos = state.data.todos.filter(function (t) { return !t.deleted; });
      save(); refreshAll();
      toast('已清空 ' + n + ' 条');
    });

    $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importFile(this.files[0]);
      this.value = '';
    });
    $('#btn-ai-todo-quick').addEventListener('click', function () {
      switchView('ai-todo');
    });

    // 待办弹窗
    $('#td-save').addEventListener('click', saveTodoModal);
    $('#td-cancel').addEventListener('click', closeModals);
    $('#td-allday').addEventListener('change', updateTodoModalRows);

    // 日期详情弹窗
    $('#day-modal-close').addEventListener('click', closeModals);
    $('#day-modal-add').addEventListener('click', function () {
      openTodoModal(null, { date: state.dayModalKey || state.selected });
    });

    // 日历
    $('#cal-prev').addEventListener('click', function () { changeMonth(-1); });
    $('#cal-next').addEventListener('click', function () { changeMonth(1); });
    $('#btn-today').addEventListener('click', function () {
      var t = new Date();
      state.viewYear = t.getFullYear(); state.viewMonth = t.getMonth();
      state.selected = todayKey();
      renderCalendar();
    });
    $all('#cal-mode button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.calMode = b.dataset.mode;
        renderCalendar();
      });
    });
    $('#cal-grid').addEventListener('wheel', function (e) {
      e.preventDefault();
      changeMonth(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    // 四象限
    bindQuadrant();

    // 倒计时
    $('#btn-add-countdown').addEventListener('click', function () { openCountdownModal(null); });
    $('#cd-save').addEventListener('click', saveCountdownModal);
    $('#cd-cancel').addEventListener('click', closeModals);

    // AI
    $('#ai-send').addEventListener('click', aiSend);
    $('#ai-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') aiSend();
    });
    $('#btn-ai-run').addEventListener('click', function () { aiGenerateReport(''); });

    // 设置
    $('#btn-settings').addEventListener('click', function () {
      $('#set-apikey').value = state.data.apiKey || '';
      $('#set-wallpaper').value = state.data.wallpaper || 'aurora';
      $('#set-opacity').value = state.data.opacity || 100;
      $('#set-opacity-val').textContent = (state.data.opacity || 100) + '%';
      $('#set-edge').value = state.data.edgeHide ? 'on' : 'off';
      $('#sc-active').value = state.data.statusColors.active;
      $('#sc-notstarted').value = state.data.statusColors.notstarted;
      $('#sc-overdue').value = state.data.statusColors.overdue;
      $('#sc-done').value = state.data.statusColors.done;
      if (window.electronAPI && window.electronAPI.getDataDir) {
        window.electronAPI.getDataDir().then(function (dir) {
          $('#set-datadir').value = dir || '';
          $('#set-datadir').title = dir || '';
        });
      } else {
        $('#set-datadir').value = '浏览器模式不可用';
        $('#btn-choose-dir').disabled = true;
      }
      showModal('settings-modal');
    });
    // 更改数据保存位置(自动搬移数据文件)
    $('#btn-choose-dir').addEventListener('click', function () {
      if (!(window.electronAPI && window.electronAPI.chooseDataDir)) return;
      window.electronAPI.chooseDataDir(JSON.stringify(state.data)).then(function (res) {
        if (res && res.ok) {
          $('#set-datadir').value = res.path;
          $('#set-datadir').title = res.path;
          toast('数据已搬移到:' + res.path);
        } else if (res && !res.canceled) {
          toast('更改失败:' + (res.error || '未知错误'));
        }
      });
    });
    // 拖动滑块实时预览透明度
    $('#set-opacity').addEventListener('input', function () {
      $('#set-opacity-val').textContent = this.value + '%';
      $('#wallpaper').style.opacity = this.value / 100;
    });
    $('#set-save').addEventListener('click', function () {
      state.data.apiKey = $('#set-apikey').value.trim();
      state.data.wallpaper = $('#set-wallpaper').value;
      state.data.opacity = +$('#set-opacity').value;
      state.data.edgeHide = $('#set-edge').value === 'on';
      state.data.statusColors = {
        active: $('#sc-active').value,
        notstarted: $('#sc-notstarted').value,
        overdue: $('#sc-overdue').value,
        done: $('#sc-done').value
      };
      save(); applyWallpaper(); applyEdgeHide(); refreshAll(); closeModals();
      toast(state.data.edgeHide ? '设置已保存,把窗口拖到屏幕边缘即可自动隐藏' : '设置已保存');
    });
    $('#set-cancel').addEventListener('click', function () {
      applyWallpaper(); // 还原透明度预览
      closeModals();
    });

    // 主题(循环切换壁纸)
    var wps = ['aurora', 'ocean', 'sunset', 'forest', 'dark'];
    $('#btn-theme').addEventListener('click', function () {
      var i = wps.indexOf(state.data.wallpaper || 'aurora');
      state.data.wallpaper = wps[(i + 1) % wps.length];
      save(); applyWallpaper();
    });

    // 搜索
    $('#btn-search').addEventListener('click', function () {
      $('#search-input').value = '';
      $('#search-results').innerHTML = '';
      showModal('search-modal');
      $('#search-input').focus();
    });
    $('#search-input').addEventListener('input', renderSearch);
    $('#search-close').addEventListener('click', closeModals);

    // 窗口控制
    $('#btn-pin').addEventListener('click', function () {
      state.data.pinned = !state.data.pinned;
      save();
      this.classList.toggle('active', state.data.pinned);
      if (window.electronAPI && window.electronAPI.setPin) window.electronAPI.setPin(state.data.pinned);
      toast(state.data.pinned ? '窗口已置顶' : '已取消置顶');
    });
    $('#btn-min').addEventListener('click', function () {
      if (window.electronAPI && window.electronAPI.minimize) window.electronAPI.minimize();
    });
    $('#btn-close').addEventListener('click', function () {
      if (window.electronAPI && window.electronAPI.hide) window.electronAPI.hide();
      else toast('浏览器模式下请直接关闭标签页');
    });

    $('#modal-mask').addEventListener('click', function (e) {
      if (e.target === this) closeModals();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModals();
    });
  }

  // ---------- 启动 ----------
  function boot() {
    if (window.electronAPI && window.electronAPI.loadData) {
      window.electronAPI.loadData().then(function (content) {
        if (content) applyRaw(content);
        else applyRaw(localStorage.getItem(STORE_KEY)); // 首次:从旧的 localStorage 迁移
        init();
        save(); // 确保数据文件生成
      });
    } else {
      applyRaw(localStorage.getItem(STORE_KEY));
      init();
    }
  }

  function init() {
    normalizeData();
    aiHistory = state.data.aiHistory;
    var t = new Date();
    state.viewYear = t.getFullYear();
    state.viewMonth = t.getMonth();
    state.selected = todayKey();

    applyWallpaper();
    initCalendarHeader();
    initCountdownModal();
    initListModal();
    bindEvents();
    renderSidebar();
    switchView('todos');

    if (state.data.pinned) {
      $('#btn-pin').classList.add('active');
      if (window.electronAPI && window.electronAPI.setPin) window.electronAPI.setPin(true);
    }
    applyEdgeHide();

    setInterval(checkReminders, 20000);
    setInterval(checkDayChange, 60000);
    checkReminders();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
