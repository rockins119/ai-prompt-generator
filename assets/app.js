/* ============================================================
   AI 提示词生成器 — 主逻辑
   ------------------------------------------------------------
   数据来自 data/ 目录下的 JSON 文件，改配置不用动这里的代码。
   想换默认打开的 AI 网址、换标题，只改下面 CONFIG 即可。
   ============================================================ */

'use strict';

/* ===================== 可改配置 ===================== */

const CONFIG = {
  // 项目入口文件（里面登记了有哪些分组、各自的文件路径）
  projectUrl: 'data/project.json',

  // 「复制并打开」按钮跳转的 AI 网址，换成你常用的即可
  aiUrl: 'https://www.doubao.com/chat/',
  aiButtonLabel: '复制并打开豆包',

  // 复制后是否自动打开上面这个网址
  autoOpenAi: true,

  // 是否记住上次选择的分组和预设（存浏览器本地）
  rememberLastChoice: true
};

/* ===================== 运行时状态 ===================== */

const STATE = {
  project: null,        // { name, key, groups: { gk: {name, icon, file} } }
  groupKey: '',
  presetKey: '',
  groupCache: {},       // gk -> { name, icon, sections, presets }
  group: null,          // 当前分组数据
  sections: null,       // 当前生效的字段结构
  fields: [],           // [{ id, sectionKey, key, field }]
  values: {},           // id -> 值
  tagEls: {},           // id -> 值标签元素
  pendingCustom: {}     // id -> 自定义追加的选项 { value, label }
};

const STORAGE_KEY = 'prompt-generator:last';

/* ===================== 小工具 ===================== */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function normalizeOption(raw) {
  if (typeof raw === 'string') return { value: raw, label: raw };
  if (raw && typeof raw === 'object') {
    const value = raw.value === undefined ? '' : String(raw.value);
    const label = raw.label === undefined ? value : String(raw.label);
    return { value, label };
  }
  return null;
}

/** 取出字段的全部选项（支持 { 分组名: [选项...] } 的写法），统一成扁平数组 */
function flatOptions(field) {
  const opts = field && field.options;
  if (!opts) return [];
  if (Array.isArray(opts)) return opts.map(normalizeOption).filter(Boolean);
  const out = [];
  for (const groupName of Object.keys(opts)) {
    const list = Array.isArray(opts[groupName]) ? opts[groupName] : [];
    list.forEach(item => {
      const n = normalizeOption(item);
      if (n) out.push(n);
    });
  }
  return out;
}

/** 追加的自定义选项也要能参与「值 → 显示文字」的换算 */
function allOptionValues(field, id) {
  const values = flatOptions(field).map(o => o.value);
  const extra = STATE.pendingCustom[id];
  if (extra) values.push(extra.value);
  return values;
}

function labelForValue(field, id, value) {
  const extra = STATE.pendingCustom[id];
  if (extra && extra.value === value) return extra.label;
  const hit = flatOptions(field).find(o => o.value === value);
  return hit ? hit.label : value;
}

/** 字符串里如果是完整 JSON 对象，就还原成对象（提示词里支持直接塞结构化片段） */
function resolveValue(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return value;
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) { /* 不是合法 JSON，按普通文本处理 */ }
  return value;
}

/** 开关类字段的 key 支持写成 "json里的键:要写入的值" */
function splitBoolKey(key) {
  const i = Math.max(key.indexOf(':'), key.indexOf('：'));
  if (i < 0) return null;
  return { jsonKey: key.slice(0, i).trim(), jsonVal: key.slice(i + 1).trim() };
}

function showToast(message) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => box.classList.remove('show'), 1800);
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* 走下面的兜底方案 */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function placeholder(text, isError) {
  return el('div', 'placeholder' + (isError ? ' error' : ''), text);
}

/* ===================== 默认值 ===================== */

function initialValue(field) {
  const type = field.type;
  if (type === 'switch' || type === 'boolean') return !!field.default;

  if (type === 'multi-select') {
    if (Array.isArray(field.default)) return field.default.slice();
    return field.default ? [field.default] : [];
  }

  if (type === 'select' || type === 'button-select') {
    const values = flatOptions(field).map(o => o.value);
    if (field.default !== undefined && values.indexOf(field.default) >= 0) return field.default;
    return values.length ? values[0] : '';
  }

  if (type === 'text') return field.default === undefined || field.default === null ? '' : String(field.default);

  return field.default === undefined ? '' : field.default;
}

function valueLabel(field, id, value) {
  const type = field.type;

  if (type === 'switch' || type === 'boolean') return value ? '开' : '关';

  if (type === 'multi-select') {
    if (!Array.isArray(value) || !value.length) return '未选';
    return value.map(v => {
      if (typeof v === 'string' && resolveValue(v) !== v) return 'JSON 片段';
      return labelForValue(field, id, v);
    }).join(' · ');
  }

  if (type === 'select' || type === 'button-select') {
    if (typeof value === 'string' && resolveValue(value) !== value) return 'JSON 片段';
    return value === '' || value === undefined || value === null ? '未选' : labelForValue(field, id, value);
  }

  if (typeof value === 'string' && resolveValue(value) !== value) return 'JSON 片段';
  return value === '' || value === undefined || value === null ? '未填' : String(value);
}

function isEmptyValue(type, value) {
  if (type === 'switch' || type === 'boolean') return !value;
  if (Array.isArray(value)) return value.length === 0;
  return value === '' || value === undefined || value === null;
}

/* ===================== 渲染：字段卡片 ===================== */

function renderField(entry) {
  const { id, key, field } = entry;
  const card = el('div', 'card');
  const header = el('div', 'card-header');
  const titleGroup = el('div', 'card-title-group');

  titleGroup.appendChild(el('span', 'card-label', field.label || key));
  if (field.description) titleGroup.appendChild(el('p', 'card-description', field.description));

  const tag = el('span', 'selected-value');
  titleGroup.appendChild(tag);
  STATE.tagEls[id] = tag;

  header.appendChild(titleGroup);
  card.appendChild(header);

  const type = field.type;

  if (type === 'switch' || type === 'boolean') {
    const wrap = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!STATE.values[id];
    input.addEventListener('change', () => setValue(id, input.checked));
    wrap.appendChild(input);
    wrap.appendChild(el('span', 'slider'));
    header.appendChild(wrap);
  } else {
    const body = el('div');
    if (type === 'text') {
      body.appendChild(renderTextInput(entry));
    } else if (type === 'select') {
      body.appendChild(renderSelect(entry));
    } else {
      body.appendChild(renderPillGroup(entry));
    }
    body.appendChild(renderAdder(entry));
    card.appendChild(body);
  }

  refreshTag(id);
  return card;
}

function renderTextInput(entry) {
  const { id } = entry;
  const input = el('input');
  input.type = 'text';
  input.value = STATE.values[id] === undefined ? '' : String(STATE.values[id]);
  input.addEventListener('input', () => setValue(id, input.value));
  return input;
}

function renderSelect(entry) {
  const { id, field } = entry;
  const select = el('select');
  const current = STATE.values[id];

  const pushOption = (parent, opt) => {
    const option = el('option', null, opt.label);
    option.value = opt.value;
    if (opt.value === current) option.selected = true;
    parent.appendChild(option);
  };

  const raw = field.options;
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    // 分组写法
    for (const groupName of Object.keys(raw)) {
      const og = el('optgroup');
      og.label = groupName;
      (raw[groupName] || []).forEach(item => {
        const n = normalizeOption(item);
        if (n) pushOption(og, n);
      });
      select.appendChild(og);
    }
  } else {
    flatOptions(field).forEach(opt => pushOption(select, opt));
  }

  const ADD = el('option', null, '✎ 自定义…');
  ADD.value = '__ADD_NEW__';
  select.appendChild(ADD);

  select.addEventListener('change', () => {
    if (select.value === '__ADD_NEW__') {
      openAdder(entry.id);
      // 还原成原来的选择，避免下拉框卡在「自定义」上
      select.value = STATE.values[id];
    } else {
      closeAdder(entry.id);
      setValue(id, select.value);
    }
  });

  entry.selectEl = select;
  return select;
}

function renderPillGroup(entry) {
  const { id, field } = entry;
  const multi = field.type === 'multi-select';
  const wrap = el('div', 'pill-group');

  flatOptions(field).forEach(opt => {
    wrap.appendChild(pillElement(entry, opt, multi));
  });

  const addBtn = el('span', 'pill-text add-new', '+ 自定义');
  addBtn.addEventListener('click', () => openAdder(id));
  wrap.appendChild(addBtn);

  entry.pillGroupEl = wrap;
  return wrap;
}

function pillElement(entry, opt, multi) {
  const { id } = entry;
  const label = el('label', 'pill-label');
  const input = el('input');
  input.type = multi ? 'checkbox' : 'radio';
  if (!multi) input.name = 'radio-' + id;
  input.value = opt.value;

  const value = STATE.values[id];
  input.checked = multi
    ? Array.isArray(value) && value.indexOf(opt.value) >= 0
    : value === opt.value;

  input.addEventListener('change', () => {
    if (multi) {
      const list = Array.isArray(STATE.values[id]) ? STATE.values[id].slice() : [];
      const i = list.indexOf(opt.value);
      if (input.checked) { if (i < 0) list.push(opt.value); }
      else if (i >= 0) list.splice(i, 1);
      setValue(id, list);
    } else {
      setValue(id, opt.value);
    }
  });

  label.appendChild(input);
  label.appendChild(el('span', 'pill-text', opt.label));
  return label;
}

function renderAdder(entry) {
  const { id, field } = entry;
  const box = el('div', 'hidden-adder');

  const ta = el('textarea', 'custom-input');
  ta.rows = 1;
  ta.placeholder = '输入新值（可粘贴 JSON 对象）';

  const ok = el('button', 'copy-btn', '确定');
  ok.type = 'button';
  ok.style.flex = '0 0 auto';
  ok.style.background = 'var(--primary-color)';
  ok.style.borderColor = 'var(--primary-color)';
  ok.style.color = '#fff';

  ok.addEventListener('click', () => commitCustom(entry, ta));
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitCustom(entry, ta);
    }
  });

  box.appendChild(ta);
  box.appendChild(ok);
  entry.adderEl = box;
  return box;
}

function openAdder(id) {
  const entry = findEntry(id);
  if (!entry || !entry.adderEl) return;
  entry.adderEl.classList.add('active');
  const ta = entry.adderEl.querySelector('textarea');
  if (ta) setTimeout(() => ta.focus(), 0);
}

function closeAdder(id) {
  const entry = findEntry(id);
  if (entry && entry.adderEl) entry.adderEl.classList.remove('active');
}

function commitCustom(entry, ta) {
  const { id, field } = entry;
  const value = ta.value.trim();
  if (!value) return;

  STATE.pendingCustom[id] = { value, label: value };
  const multi = field.type === 'multi-select';

  if (field.type === 'select' && entry.selectEl) {
    const option = el('option', null, value);
    option.value = value;
    entry.selectEl.insertBefore(option, entry.selectEl.lastElementChild);
    entry.selectEl.value = value;
    setValue(id, value);
  } else if (entry.pillGroupEl) {
    const node = pillElement(entry, { value, label: value }, multi);
    const checked = node.querySelector('input');
    if (checked) checked.checked = true;
    entry.pillGroupEl.insertBefore(node, entry.pillGroupEl.lastElementChild);

    if (multi) {
      const list = Array.isArray(STATE.values[id]) ? STATE.values[id].slice() : [];
      if (list.indexOf(value) < 0) list.push(value);
      setValue(id, list);
    } else {
      setValue(id, value);
    }
  }

  ta.value = '';
  closeAdder(id);
  refreshTag(id);
}

/* ===================== 值更新 ===================== */

function findEntry(id) {
  return STATE.fields.find(f => f.id === id);
}

function setValue(id, value) {
  STATE.values[id] = value;
  refreshTag(id);
  updatePreview();
}

function refreshTag(id) {
  const entry = findEntry(id);
  const tag = STATE.tagEls[id];
  if (!entry || !tag) return;
  const value = STATE.values[id];
  tag.textContent = valueLabel(entry.field, id, value);
  tag.classList.toggle('empty', isEmptyValue(entry.field.type, value));
}

/* ===================== 生成 JSON ===================== */

function buildNested() {
  const nested = {};
  const schema = STATE.sections || {};

  for (const sectionKey of Object.keys(schema)) nested[sectionKey] = {};

  for (const entry of STATE.fields) {
    const { id, sectionKey, key, field } = entry;
    const value = STATE.values[id];
    if (!nested[sectionKey]) nested[sectionKey] = {};

    if (field.type === 'switch' || field.type === 'boolean') {
      if (!value) continue;
      const pair = splitBoolKey(key);
      if (pair) nested[sectionKey][pair.jsonKey] = pair.jsonVal;
      else nested[sectionKey][key] = true;
    } else {
      nested[sectionKey][key] = resolveValue(value);
    }
  }
  return nested;
}

let previewRaf = null;

const raf = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : cb => setTimeout(cb, 16);

function updatePreview() {
  if (previewRaf) return;
  previewRaf = raf(() => {
    previewRaf = null;
    const nested = buildNested();
    const text = JSON.stringify(nested, null, 4);
    const pre = document.getElementById('json-preview');
    if (pre) pre.textContent = text;

    const meta = document.getElementById('previewMeta');
    if (meta) meta.textContent = STATE.fields.length + ' 项 · ' + text.length + ' 字符';

    updateUrl();
  });
}

/* ===================== 表单构建 ===================== */

function buildForm(sections) {
  const container = document.getElementById('form-container');
  container.innerHTML = '';

  STATE.fields = [];
  STATE.values = {};
  STATE.tagEls = {};
  STATE.pendingCustom = {};
  STATE.sections = sections || {};

  const sectionKeys = Object.keys(STATE.sections);
  if (!sectionKeys.length) {
    container.appendChild(placeholder('该分组暂无配置，可在对应的 data/groups/*.json 里补充。'));
    updatePreview();
    return;
  }

  let index = 0;
  for (const sectionKey of sectionKeys) {
    const section = STATE.sections[sectionKey] || {};
    const block = el('div');

    const title = el('div', 'section-title');
    title.textContent = (section.icon ? section.icon + ' ' : '') + (section.title || sectionKey);
    block.appendChild(title);

    const grid = el('div', 'grid-container');
    const fields = section.fields || {};
    for (const fieldKey of Object.keys(fields)) {
      const field = fields[fieldKey];
      const id = 'f' + (index++);
      const entry = { id, sectionKey, key: fieldKey, field };
      STATE.fields.push(entry);
      STATE.values[id] = initialValue(field);
      grid.appendChild(renderField(entry));
    }

    block.appendChild(grid);
    container.appendChild(block);
  }

  updatePreview();
}

/* ===================== 导航 ===================== */

function renderGroupNav() {
  const bar = document.getElementById('groupNavBar');
  bar.innerHTML = '';
  if (!STATE.project || !STATE.project.groups) return;

  Object.keys(STATE.project.groups).forEach(gk => {
    const meta = STATE.project.groups[gk];
    const btn = el('button', 'group-tab');
    btn.type = 'button';
    btn.textContent = (meta.icon ? meta.icon + ' ' : '') + (meta.name || gk);
    if (gk === STATE.groupKey) btn.classList.add('active');
    btn.addEventListener('click', () => selectGroup(gk));
    bar.appendChild(btn);
  });
}

function renderPresetNav() {
  const bar = document.getElementById('presetNavBar');
  bar.innerHTML = '';
  const presets = (STATE.group && STATE.group.presets) || [];

  if (!presets.length) {
    bar.appendChild(el('span', 'nav-empty', '该分组暂无预设，使用上方默认配置'));
    return;
  }

  presets.forEach(preset => {
    const btn = el('button', 'preset-pill');
    btn.type = 'button';
    btn.textContent = preset.name || preset.key;
    if (preset.key === STATE.presetKey) btn.classList.add('active');
    btn.addEventListener('click', () => selectPreset(preset.key));
    bar.appendChild(btn);
  });
}

function activePreset() {
  const presets = (STATE.group && STATE.group.presets) || [];
  if (!presets.length) return null;
  return presets.find(p => p.key === STATE.presetKey) || presets[0];
}

/** 预设自带一整套字段结构时优先用它，否则用分组的默认结构 */
function activeSections() {
  const preset = activePreset();
  if (preset && preset.sections && Object.keys(preset.sections).length) return preset.sections;
  return (STATE.group && STATE.group.sections) || {};
}

/* ===================== 数据加载 ===================== */

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('加载 ' + url + ' 失败（HTTP ' + res.status + '）');
  return res.json();
}

async function loadProject() {
  const data = await fetchJSON(CONFIG.projectUrl);
  if (!data || !data.groups) throw new Error('data/project.json 格式不正确：缺少 groups 字段');
  STATE.project = data;

  const title = document.getElementById('appTitle');
  if (title && data.name) title.textContent = data.name + ' · AI 提示词生成器';
  document.title = (data.name ? data.name + ' · ' : '') + 'AI 提示词生成器';
}

async function loadGroup(groupKey) {
  if (STATE.groupCache[groupKey]) return STATE.groupCache[groupKey];

  const meta = STATE.project.groups[groupKey];
  if (!meta) throw new Error('找不到分组：' + groupKey);
  const url = meta.file && meta.file.indexOf('/') >= 0
    ? 'data/' + meta.file
    : 'data/groups/' + (meta.file || groupKey + '.json');

  const data = await fetchJSON(url);
  const normalized = {
    name: data.name || meta.name || groupKey,
    icon: data.icon || meta.icon || '📁',
    sections: data.sections && !Array.isArray(data.sections) ? data.sections : {},
    presets: Array.isArray(data.presets) ? data.presets.filter(p => p && typeof p === 'object') : []
  };
  STATE.groupCache[groupKey] = normalized;
  return normalized;
}

function readUrlParams() {
  const params = new URLSearchParams(location.search);
  return {
    group: params.get('group') || '',
    preset: params.get('preset') || ''
  };
}

function updateUrl() {
  if (!STATE.groupKey) return;
  const url = new URL(location.href);
  url.searchParams.set('group', STATE.groupKey);
  if (STATE.presetKey) url.searchParams.set('preset', STATE.presetKey);
  else url.searchParams.delete('preset');
  history.replaceState(null, '', url);
}

function saveChoice() {
  if (!CONFIG.rememberLastChoice) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      group: STATE.groupKey,
      preset: STATE.presetKey
    }));
  } catch (e) { /* 隐私模式下忽略 */ }
}

function loadChoice() {
  if (!CONFIG.rememberLastChoice) return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

/* ===================== 交互入口 ===================== */

async function selectGroup(groupKey) {
  if (groupKey === STATE.groupKey && STATE.group) return;

  const container = document.getElementById('form-container');
  container.innerHTML = '';
  container.appendChild(placeholder('正在加载「' + groupKey + '」配置...'));

  try {
    const group = await loadGroup(groupKey);
    STATE.groupKey = groupKey;
    STATE.group = group;

    const presets = group.presets || [];
    const sameGroup = STATE.presetKey && presets.some(p => p.key === STATE.presetKey);
    STATE.presetKey = sameGroup ? STATE.presetKey : (presets.length ? presets[0].key : '');

    renderGroupNav();
    renderPresetNav();
    buildForm(activeSections());
    saveChoice();
  } catch (error) {
    container.innerHTML = '';
    container.appendChild(placeholder('加载失败：' + error.message, true));
  }
}

function selectPreset(presetKey) {
  const presets = (STATE.group && STATE.group.presets) || [];
  const preset = presets.find(p => p.key === presetKey);
  if (!preset) return;

  STATE.presetKey = presetKey;
  renderPresetNav();
  buildForm(activeSections());
  saveChoice();
  const bar = document.getElementById('presetNavBar');
  if (bar && typeof bar.scrollIntoView === 'function') bar.scrollIntoView({ block: 'nearest' });
}

function resetPreset() {
  buildForm(activeSections());
  showToast('已恢复该预设的默认值');
}

/* ===================== 输出动作 ===================== */

function currentJSON() {
  const pre = document.getElementById('json-preview');
  return pre ? pre.textContent : '{}';
}

async function actionCopy() {
  const ok = await copyToClipboard(currentJSON());
  showToast(ok ? '✅ 已复制 JSON' : '复制失败，请手动选择复制');
}

async function actionCopyAndOpen() {
  const ok = await copyToClipboard(currentJSON());
  showToast(ok ? '✅ 已复制，正在打开 AI' : '复制失败');
  if (CONFIG.autoOpenAi && CONFIG.aiUrl) {
    window.open(CONFIG.aiUrl, '_blank', 'noopener,noreferrer');
  }
}

function actionDownload() {
  const blob = new Blob([currentJSON()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = 'prompt-' + (STATE.groupKey || 'config') + '-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已下载 JSON 文件');
}

function bindActions() {
  const btnOpen = document.getElementById('btnCopyOpen');
  if (btnOpen) btnOpen.textContent = CONFIG.aiButtonLabel;

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'copy') actionCopy();
      else if (action === 'copy-open') actionCopyAndOpen();
      else if (action === 'download') actionDownload();
      else if (action === 'reset') resetPreset();
    });
  });
}

/** 窄屏下把 JSON 面板收成底部一条，点「展开」查看完整内容 */
function setupResponsivePanel() {
  const panel = document.getElementById('right-panel');
  const toggle = document.getElementById('panelToggle');
  if (!panel || !toggle) return;

  const NARROW = '(max-width: 900px)';
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null;

  function isNarrow() {
    return mq ? mq.matches : window.innerWidth <= 900;
  }

  function setCollapsed(collapsed) {
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '展开' : '收起';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function apply() {
    setCollapsed(isNarrow());
  }

  toggle.addEventListener('click', () => {
    setCollapsed(!panel.classList.contains('collapsed'));
  });

  if (mq) {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
    else if (typeof mq.addListener === 'function') mq.addListener(apply);
  } else {
    window.addEventListener('resize', apply);
  }

  apply();
}

/* ===================== 启动 ===================== */

async function boot() {
  bindActions();
  setupResponsivePanel();
  try {
    await loadProject();

    const meta = STATE.project.groups || {};
    const keys = Object.keys(meta);
    if (!keys.length) throw new Error('data/project.json 里没有登记任何分组');

    const url = readUrlParams();
    const saved = loadChoice();

    const groupKey = (url.group && meta[url.group]) ? url.group
      : (saved.group && meta[saved.group]) ? saved.group
      : keys[0];

    STATE.presetKey = url.preset || saved.preset || '';

    await selectGroup(groupKey);
  } catch (error) {
    const container = document.getElementById('form-container');
    container.innerHTML = '';
    container.appendChild(placeholder(
      '初始化失败：' + error.message +
      '\n\n排查提示：\n1. 必须通过 http(s) 访问，直接双击打开 index.html 会因浏览器安全策略而无法读取 JSON；\n2. 本地预览可在项目根目录执行 python -m http.server 8000；\n3. 确认 data/project.json 与 data/groups/ 目录都存在。',
      true
    ));
  }
}

document.addEventListener('DOMContentLoaded', boot);
