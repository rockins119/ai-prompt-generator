/* 用 jsdom 跑真实 DOM 环境，验证页面渲染与 JSON 输出 */
const { JSDOM } = require('jsdom');

const BASE = 'http://127.0.0.1:8123/';
let failures = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (fn()) return true; } catch (e) { /* retry */ }
    await sleep(60);
  }
  throw new Error('timeout waiting for ' + label);
}

(async () => {
  const dom = await JSDOM.fromURL(BASE + 'index.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? new URL(input, BASE).href : input;
        return fetch(url, init);
      };
      window.open = () => ({});
      window.alert = () => {};
      window.onerror = (msg) => { console.log('  [page error] ' + msg); };
    }
  });

  const { window } = dom;
  const doc = window.document;
  let pageErrors = 0;
  window.addEventListener('error', e => { pageErrors++; console.log('  [window error] ' + e.message); });

  const fields = () => Array.from(doc.querySelectorAll('#form-container .field'));
  const presetSelect = () => doc.getElementById('presetSelect');
  const presetKeys = () => Array.from(presetSelect().options).map(o => o.value);
  function choosePresetByIndex(i) {
    const sel = presetSelect();
    sel.value = presetKeys()[i];
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  const json = () => JSON.parse(doc.getElementById('json-preview').textContent);

  console.log('\n=== 1. 首屏加载 ===');
  await waitFor(() => fields().length > 0, 20000, '表单渲染');
  await sleep(400);

  const groupTabs = doc.querySelectorAll('#groupNavBar .group-tab');
  check('分组标签数量 = 4', groupTabs.length === 4, groupTabs.length);
  check('第一个分组为「家装设计」', /家装设计/.test(groupTabs[0].textContent), groupTabs[0].textContent);
  check('第一个分组高亮', groupTabs[0].classList.contains('active'));

  check('预设是下拉框', presetSelect() && presetSelect().tagName === 'SELECT');
  check('预设数量 = 28', presetKeys().length === 28, presetKeys().length);
  check('当前预设已选中', !!presetSelect().value && presetSelect().value === presetKeys()[0], presetSelect().value);
  check('预设名带序号', /^1\.\s/.test(presetSelect().options[0].textContent), presetSelect().options[0].textContent);

  const rowCount = fields().length;
  console.log('    (字段行数 ' + rowCount + ')');
  check('字段行渲染', rowCount > 0);
  check('分区标题渲染', doc.querySelectorAll('#form-container .section-title').length > 0);

  console.log('\n=== 2. 排版策略 ===');
  const switchRows = doc.querySelectorAll('#form-container .field-switch');
  check('开关类字段标记正确', switchRows.length > 0, switchRows.length);

  const selects = doc.querySelectorAll('#form-container .field select');
  const pillsInRows = doc.querySelectorAll('#form-container .field .pill-group');
  console.log('    (下拉框 ' + selects.length + ' 个 / 胶囊组 ' + pillsInRows.length + ' 个)');
  check('选项多的字段改用下拉框', selects.length > 0, selects.length);

  // 逐个字段核对：拿源数据算出「该用下拉还是胶囊」，与页面实际渲染对比
  const fs = require('fs');
  const src = JSON.parse(fs.readFileSync(__dirname + '/../data/groups/interior.json', 'utf8'));
  const schema = src.presets[0].sections;
  const flat = f => {
    const o = f.options;
    if (!o) return [];
    return Array.isArray(o) ? o : Object.values(o).flat();
  };
  const expectedWide = [];
  for (const sk of Object.keys(schema)) {
    const sec = schema[sk];
    for (const fk of Object.keys(sec.fields || {})) {
      const f = sec.fields[fk];
      const lb = f.label || fk;
      if (lb.length > 22) expectedWide.push(lb.slice(0, 20));
    }
  }
  const actualWide = fields().filter(row => row.classList.contains('field-wide')).length;
  check('超长字段名独占一行的规则与数据一致',
    actualWide === expectedWide.length,
    { 期望: expectedWide.length, 实际: actualWide, 数据里最长的几个: expectedWide.slice(0, 3) });

  const expected = [];
  for (const sk of Object.keys(schema)) {
    const sec = schema[sk];
    for (const fk of Object.keys(sec.fields || {})) {
      const f = sec.fields[fk];
      const t = f.type;
      if (t === 'switch' || t === 'boolean' || t === 'multi-select') { expected.push('other'); continue; }
      expected.push((t === 'select' || flat(f).length > 8) ? 'select' : 'pills');
    }
  }
  const actual = fields().map(row => {
    if (row.querySelector('.switch')) return 'other';
    const pills = row.querySelector('.pill-group');
    if (pills) return pills.querySelector('input[type=checkbox]') ? 'other' : 'pills';
    if (row.querySelector('select')) return 'select';
    if (row.querySelector('input[type=text],textarea.custom-input')) return 'other';
    return 'unknown';
  });
  check('字段数量与源数据一致', actual.length === expected.length, { 页面: actual.length, 源数据: expected.length });
  const policyBad = expected
    .map((want, i) => ({ want, got: actual[i], row: fields()[i] }))
    .filter(x => x.want !== 'other' && x.got !== x.want)
    .map(x => (x.row && x.row.querySelector('.field-name') ? x.row.querySelector('.field-name').textContent.slice(0, 18) : '?') +
      ' 期望 ' + x.want + ' 实际 ' + x.got);
  check('每个字段的控件类型都符合「>8 转下拉」规则', policyBad.length === 0, policyBad.slice(0, 6));

  // 胶囊组的选项数一律不得超过阈值
  const overLimit = [];
  doc.querySelectorAll('#form-container .field').forEach(row => {
    const pills = row.querySelector('.pill-group');
    if (!pills) return;
    if (pills.querySelector('input[type=checkbox]')) return;
    const n = pills.querySelectorAll('input[type=radio]').length;
    if (n > 8) overLimit.push((row.querySelector('.field-name') || {}).textContent + ':' + n);
  });
  check('没有字段的胶囊超过 8 个', overLimit.length === 0, overLimit);

  const infoIcons = doc.querySelectorAll('#form-container .info');
  check('说明文字收进 ℹ 图标', infoIcons.length > 0, infoIcons.length);
  const firstInfo = infoIcons[0];
  check('ℹ 图标带完整说明文本', firstInfo && firstInfo.getAttribute('data-tip').length > 20,
    firstInfo && firstInfo.getAttribute('data-tip').slice(0, 40));
  check('界面上不再有冗余的「当前值」标签', doc.querySelectorAll('.selected-value').length === 0);

  console.log('\n=== 3. JSON 预览 ===');
  let parsed = json();
  check('预览是合法 JSON', !!parsed);
  check('预览含多个分区', Object.keys(parsed).length > 1, Object.keys(parsed));
  const jsonFieldCount = Object.values(parsed).reduce((a, o) => a + Object.keys(o).length, 0);
  const offSwitches = Array.from(doc.querySelectorAll('#form-container .switch input')).filter(i => !i.checked).length;
  console.log('    (JSON 字段 ' + jsonFieldCount + ' / 行数 ' + rowCount + ' / 关闭的开关 ' + offSwitches + ')');
  check('JSON 字段数 = 字段数 - 关闭的开关数', jsonFieldCount === rowCount - offSwitches,
    { jsonFieldCount, rowCount, offSwitches });
  check('预览元信息显示', /项/.test(doc.getElementById('previewMeta').textContent));

  console.log('\n=== 4. 交互：胶囊单选 ===');
  const firstRadio = doc.querySelector('#form-container .pill-group input[type=radio]:not(:checked)');
  if (firstRadio) {
    firstRadio.checked = true;
    firstRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    check('切换选项后 JSON 内容变化', JSON.stringify(json()) !== JSON.stringify(parsed));
    parsed = json();
  } else {
    check('找到可点击的单选胶囊', false);
  }

  console.log('\n=== 5. 交互：下拉框 ===');
  const sel = doc.querySelector('#form-container .field select');
  if (sel) {
    const target = Array.from(sel.options).find(o => o.value && o.value !== sel.value && o.value !== '__ADD_NEW__');
    if (target) {
      const before = JSON.stringify(json());
      sel.value = target.value;
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(120);
      check('下拉框选择写入 JSON', JSON.stringify(json()) !== before);
      check('下拉框选中态保留', sel.value === target.value, sel.value);
    }
  }

  console.log('\n=== 6. 交互：多选 ===');
  const boxes = doc.querySelectorAll('#form-container .pill-group input[type=checkbox]');
  if (boxes.length) {
    boxes[0].checked = !boxes[0].checked;
    boxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    const arr = Object.values(json()).map(o => Object.values(o)).flat().find(v => Array.isArray(v));
    check('多选字段输出为数组', Array.isArray(arr), arr);
  }

  console.log('\n=== 7. 交互：开关 ===');
  const sw = doc.querySelector('#form-container .switch input');
  if (sw) {
    const before = JSON.stringify(json());
    sw.checked = !sw.checked;
    sw.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    check('开关切换后 JSON 变化', JSON.stringify(json()) !== before);
  }

  console.log('\n=== 8. 切换预设 ===');
  const beforePreset = JSON.stringify(json());
  choosePresetByIndex(5);
  await sleep(600);
  check('切换预设后重新渲染', fields().length > 0, fields().length);
  check('切换预设后 JSON 变化', JSON.stringify(json()) !== beforePreset);
  check('下拉框选中态跟随', presetSelect().value === presetKeys()[5], presetSelect().value);
  check('URL 参数同步 preset', /preset=/.test(window.location.search), window.location.search);

  console.log('\n=== 9. 切换分组 ===');
  groupTabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => /工装设计/.test(doc.querySelector('#groupNavBar .group-tab.active').textContent), 10000, '工装设计激活');
  await sleep(500);
  check('工装设计有字段行', fields().length > 0, fields().length);
  check('工装设计预设数 = 6', presetKeys().length === 6, presetKeys().length);
  check('URL 参数同步 group', /group=architecture/.test(window.location.search), window.location.search);

  console.log('\n=== 10. 空分组容错 ===');
  doc.querySelectorAll('#groupNavBar .group-tab')[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  const ph = doc.querySelector('#form-container .placeholder');
  check('空分组显示占位提示', !!ph, ph && ph.textContent.slice(0, 40));
  check('空分组仍列出该组预设', presetKeys().length === 2, presetKeys().length);

  console.log('\n=== 11. 自定义选项 ===');
  doc.querySelectorAll('#groupNavBar .group-tab')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => fields().length > 0, 15000, '回到家装');
  await sleep(400);

  const addBtn = doc.querySelector('#form-container .pill-text.add-new');
  addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  const adder = doc.querySelector('#form-container .hidden-adder.active');
  check('胶囊字段的自定义输入区展开', !!adder);
  if (adder) {
    const ta = adder.querySelector('textarea');
    ta.value = '我的自定义风格值';
    adder.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(200);
    check('自定义值写入 JSON', JSON.stringify(json()).includes('我的自定义风格值'));
  }

  // 下拉框字段的自定义
  const selForCustom = doc.querySelector('#form-container .field select');
  if (selForCustom) {
    selForCustom.value = '__ADD_NEW__';
    selForCustom.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(100);
    const adder2 = selForCustom.closest('.field').querySelector('.hidden-adder.active');
    check('下拉框字段的自定义输入区展开', !!adder2);
    if (adder2) {
      const ta2 = adder2.querySelector('textarea');
      ta2.value = '下拉自定义值';
      adder2.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(200);
      check('下拉框自定义值写入 JSON', JSON.stringify(json()).includes('下拉自定义值'));
      check('下拉框回退到已选值而非卡在「自定义」', selForCustom.value !== '__ADD_NEW__', selForCustom.value);
    }
  }

  console.log('\n=== 12. 重置 ===');
  doc.querySelector('[data-action=reset]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const afterReset = json();
  check('重置后自定义值被清空', !JSON.stringify(afterReset).includes('我的自定义风格值'));
  check('重置后 JSON 仍然有效', Object.keys(afterReset).length > 0);

  console.log('\n=== 结果 ===');
  if (pageErrors) console.log('（页面运行期间出现 ' + pageErrors + ' 个 JS 错误）');
  console.log(failures === 0 && pageErrors === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌');
  dom.window.close();
  process.exit(failures === 0 && pageErrors === 0 ? 0 : 1);
})().catch(err => {
  console.error('\n测试脚本异常: ' + err.message);
  console.error(err.stack);
  process.exit(2);
});
