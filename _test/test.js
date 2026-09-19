/* 用 jsdom 跑真实 DOM 环境，验证页面渲染与 JSON 输出 */
const fs = require('fs');
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

/* 源数据里的当前预设（默认加载第一个） */
const src = JSON.parse(fs.readFileSync(__dirname + '/../data/groups/interior.json', 'utf8'));
const schema = src.presets[0].sections;
const flat = f => {
  const o = f.options;
  if (!o) return [];
  return Array.isArray(o) ? o : Object.values(o).flat();
};
const allFields = [];
for (const sk of Object.keys(schema)) {
  for (const fk of Object.keys(schema[sk].fields || {})) {
    allFields.push({ sectionKey: sk, key: fk, field: schema[sk].fields[fk] });
  }
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
    }
  });

  const { window } = dom;
  const doc = window.document;
  let pageErrors = 0;
  window.addEventListener('error', e => { pageErrors++; console.log('  [window error] ' + e.message); });

  const rows = () => Array.from(doc.querySelectorAll('#form-container .field'));
  const presetPills = () => Array.from(doc.querySelectorAll('#presetNavBar .preset-pill'));
  function choosePresetByIndex(i) {
    const p = presetPills()[i];
    if (p) p.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }
  const json = () => JSON.parse(doc.getElementById('json-preview').textContent);

  console.log('\n=== 1. 首屏加载 ===');
  await waitFor(() => rows().length > 0, 20000, '表单渲染');
  await sleep(400);

  const groupTabs = doc.querySelectorAll('#groupNavBar .group-tab');
  check('分组标签数量 = 4', groupTabs.length === 4, groupTabs.length);
  check('第一个分组为「家装设计」', /家装设计/.test(groupTabs[0].textContent), groupTabs[0].textContent);
  check('第一个分组高亮', groupTabs[0].classList.contains('active'));

  console.log('\n=== 2. 预设：胶囊点选 ===');
  check('预设是胶囊按钮，不是下拉框', presetPills().length > 0, presetPills().length);
  check('预设数量 = 28', presetPills().length === 28, presetPills().length);
  check('第一个预设高亮', presetPills()[0].classList.contains('active'));
  check('预设名带序号', /^1\.\s/.test(presetPills()[0].textContent), presetPills()[0].textContent);
  check('页面上没有下拉框', doc.querySelectorAll('select').length === 0,
    doc.querySelectorAll('select').length);

  console.log('\n=== 3. 字段：全部用胶囊点选 ===');
  const rowCount = rows().length;
  console.log('    (字段行数 ' + rowCount + ')');
  check('字段数量与源数据一致', rowCount === allFields.length, { 页面: rowCount, 源数据: allFields.length });
  check('分区标题渲染', doc.querySelectorAll('#form-container .section-title').length > 0);
  check('开关类字段标记正确', doc.querySelectorAll('#form-container .field-switch').length > 0);

  // 每个「选项型字段」都必须有胶囊组；选型总数要和源数据对得上
  let expectedPills = 0;
  const missingPill = [];
  for (const f of allFields) {
    const t = f.field.type;
    if (t === 'text' || t === 'switch' || t === 'boolean') continue;
    expectedPills += flat(f.field).length;
  }
  const actualPills = doc.querySelectorAll('#form-container .pill-label').length;
  check('胶囊总数 = 源数据选项总数', actualPills === expectedPills,
    { 页面: actualPills, 源数据: expectedPills });

  // 逐行核对：选项型字段必须有 .pill-group
  rows().forEach((row, i) => {
    const f = allFields[i];
    if (!f) return;
    const t = f.field.type;
    if (t === 'text' || t === 'switch' || t === 'boolean') return;
    if (!row.querySelector('.pill-group')) missingPill.push(f.key + '(' + t + ')');
  });
  check('每个选项型字段都有胶囊组', missingPill.length === 0, missingPill.slice(0, 5));

  // 选项多的字段（33 个选项）确实全部铺开，没有降级成下拉
  const outsideField = allFields.find(f => f.key === '外景类型');
  if (outsideField) {
    const idx = allFields.indexOf(outsideField);
    const pillCount = rows()[idx].querySelectorAll('.pill-label').length;
    check('选项最多的字段（外景类型 33 个）全部铺成胶囊', pillCount === flat(outsideField.field).length,
      { 胶囊: pillCount, 选项: flat(outsideField.field).length });
  }

  console.log('\n=== 4. 排版策略 ===');
  const expectedWide = allFields.filter(f => (f.field.label || f.key).length > 22).length;
  const actualWide = rows().filter(r => r.classList.contains('field-wide')).length;
  check('超长字段名独占一行的规则与数据一致', actualWide === expectedWide, { 期望: expectedWide, 实际: actualWide });

  const infoIcons = doc.querySelectorAll('#form-container .info');
  check('说明文字收进 ℹ 图标', infoIcons.length > 0, infoIcons.length);
  check('ℹ 图标带完整说明文本', infoIcons[0] && infoIcons[0].getAttribute('data-tip').length > 20,
    infoIcons[0] && infoIcons[0].getAttribute('data-tip').slice(0, 40));
  check('界面上没有冗余的「当前值」标签', doc.querySelectorAll('.selected-value').length === 0);

  console.log('\n=== 5. JSON 预览 ===');
  let parsed = json();
  check('预览是合法 JSON', !!parsed);
  check('预览含多个分区', Object.keys(parsed).length > 1, Object.keys(parsed));
  const jsonFieldCount = Object.values(parsed).reduce((a, o) => a + Object.keys(o).length, 0);
  const offSwitches = Array.from(doc.querySelectorAll('#form-container .switch input')).filter(i => !i.checked).length;
  check('JSON 字段数 = 字段数 - 关闭的开关数', jsonFieldCount === rowCount - offSwitches,
    { jsonFieldCount, rowCount, offSwitches });
  check('预览元信息显示', /项/.test(doc.getElementById('previewMeta').textContent));

  console.log('\n=== 6. 交互：点选胶囊 ===');
  const firstRadio = doc.querySelector('#form-container .pill-group input[type=radio]:not(:checked)');
  if (firstRadio) {
    firstRadio.checked = true;
    firstRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    check('点选后 JSON 内容变化', JSON.stringify(json()) !== JSON.stringify(parsed));
    parsed = json();
  } else {
    check('找到可点击的单选胶囊', false);
  }

  console.log('\n=== 7. 交互：多选 ===');
  const boxes = doc.querySelectorAll('#form-container .pill-group input[type=checkbox]');
  if (boxes.length) {
    boxes[0].checked = !boxes[0].checked;
    boxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    const arr = Object.values(json()).map(o => Object.values(o)).flat().find(v => Array.isArray(v));
    check('多选字段输出为数组', Array.isArray(arr), arr);
  }

  console.log('\n=== 8. 交互：开关 ===');
  const sw = doc.querySelector('#form-container .switch input');
  if (sw) {
    const before = JSON.stringify(json());
    sw.checked = !sw.checked;
    sw.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    check('开关切换后 JSON 变化', JSON.stringify(json()) !== before);
  }

  console.log('\n=== 9. 切换预设 ===');
  const beforePreset = JSON.stringify(json());
  choosePresetByIndex(5);
  await sleep(600);
  check('切换预设后重新渲染', rows().length > 0, rows().length);
  check('切换预设后 JSON 变化', JSON.stringify(json()) !== beforePreset);
  check('预设高亮跟随切换', presetPills()[5].classList.contains('active'));
  check('只有当前预设高亮', presetPills().filter(p => p.classList.contains('active')).length === 1);
  check('URL 参数同步 preset', /preset=/.test(window.location.search), window.location.search);

  console.log('\n=== 10. 切换分组 ===');
  groupTabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => /工装设计/.test(doc.querySelector('#groupNavBar .group-tab.active').textContent), 10000, '工装设计激活');
  await sleep(500);
  check('工装设计有字段行', rows().length > 0, rows().length);
  check('工装设计预设数 = 6', presetPills().length === 6, presetPills().length);
  check('URL 参数同步 group', /group=architecture/.test(window.location.search), window.location.search);

  console.log('\n=== 11. 空分组容错 ===');
  doc.querySelectorAll('#groupNavBar .group-tab')[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  const ph = doc.querySelector('#form-container .placeholder');
  check('空分组显示占位提示', !!ph, ph && ph.textContent.slice(0, 40));
  check('空分组仍列出该组预设', presetPills().length === 2, presetPills().length);

  console.log('\n=== 12. 自定义选项 ===');
  doc.querySelectorAll('#groupNavBar .group-tab')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => rows().length > 0, 15000, '回到家装');
  await sleep(400);

  const addBtn = doc.querySelector('#form-container .pill-text.add-new');
  addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  const adder = doc.querySelector('#form-container .hidden-adder.active');
  check('自定义输入区展开', !!adder);
  if (adder) {
    const ta = adder.querySelector('textarea');
    ta.value = '我的自定义风格值';
    adder.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(200);
    check('自定义值写入 JSON', JSON.stringify(json()).includes('我的自定义风格值'));
    check('自定义胶囊已加入该字段', !!doc.querySelector('#form-container .pill-label input[value="我的自定义风格值"]'));
  }

  console.log('\n=== 13. 重置 ===');
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
