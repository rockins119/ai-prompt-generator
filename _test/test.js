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

  window.addEventListener('error', e => console.log('  [window error] ' + e.message));

  console.log('\n=== 1. 首屏加载 ===');
  await waitFor(() => doc.querySelectorAll('#form-container .card').length > 0, 20000, '表单渲染');
  await sleep(300);

  const groupTabs = doc.querySelectorAll('#groupNavBar .group-tab');
  check('分组标签数量 = 4', groupTabs.length === 4, groupTabs.length);
  check('第一个分组为「家装设计」', /家装设计/.test(groupTabs[0].textContent), groupTabs[0] && groupTabs[0].textContent);
  check('第一个分组高亮', groupTabs[0].classList.contains('active'));

  const presetPills = doc.querySelectorAll('#presetNavBar .preset-pill');
  check('家装预设数量 = 28', presetPills.length === 28, presetPills.length);
  check('第一个预设高亮', presetPills[0] && presetPills[0].classList.contains('active'));

  const cards = doc.querySelectorAll('#form-container .card');
  console.log('    (卡片数 ' + cards.length + ')');
  check('字段卡片数量 > 0', cards.length > 0);

  const sectionTitles = doc.querySelectorAll('#form-container .section-title');
  console.log('    (分区数 ' + sectionTitles.length + ')');
  check('分区标题渲染', sectionTitles.length > 0);

  console.log('\n=== 2. JSON 预览 ===');
  let parsed = null;
  try { parsed = JSON.parse(doc.getElementById('json-preview').textContent); } catch (e) {}
  check('预览是合法 JSON', parsed !== null);
  check('预览含多个分区', parsed && Object.keys(parsed).length > 1, parsed && Object.keys(parsed));
  const totalFields = parsed ? Object.values(parsed).reduce((a, o) => a + Object.keys(o).length, 0) : 0;
  console.log('    (JSON 字段总数 ' + totalFields + ')');
  check('JSON 字段数与卡片数一致', totalFields === cards.length - countSwitchesOff(cards),
    { jsonFields: totalFields, cards: cards.length });
  check('预览元信息显示', /项/.test(doc.getElementById('previewMeta').textContent), doc.getElementById('previewMeta').textContent);

  function countSwitchesOff(list) {
    return Array.from(list).filter(c => {
      const sw = c.querySelector('.switch input');
      return sw && !sw.checked;
    }).length;
  }

  console.log('\n=== 3. 交互：点选胶囊 ===');
  const firstRadio = doc.querySelector('#form-container .pill-group input[type=radio]:not(:checked)');
  if (firstRadio) {
    firstRadio.checked = true;
    firstRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    const after = JSON.parse(doc.getElementById('json-preview').textContent);
    check('切换选项后 JSON 内容发生变化', JSON.stringify(after) !== JSON.stringify(parsed));
  } else {
    check('找到可点击的单选胶囊', false);
  }

  console.log('\n=== 4. 交互：多选 ===');
  const boxes = doc.querySelectorAll('#form-container .pill-group input[type=checkbox]');
  if (boxes.length) {
    boxes[0].checked = !boxes[0].checked;
    boxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    const after = JSON.parse(doc.getElementById('json-preview').textContent);
    const arr = Object.values(after).map(o => Object.values(o)).flat().find(v => Array.isArray(v));
    check('多选字段输出为数组', Array.isArray(arr), arr);
  }

  console.log('\n=== 5. 交互：开关 ===');
  const sw = doc.querySelector('#form-container .switch input');
  if (sw) {
    const before = sw.checked;
    sw.checked = !before;
    sw.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(120);
    const after = JSON.parse(doc.getElementById('json-preview').textContent);
    check('开关可切换且不报错', typeof after === 'object');
  }

  console.log('\n=== 6. 切换预设 ===');
  presetPills[5] && presetPills[5].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  const cards2 = doc.querySelectorAll('#form-container .card');
  const parsed2 = JSON.parse(doc.getElementById('json-preview').textContent);
  check('切换预设后重新渲染', cards2.length > 0);
  check('切换预设后 JSON 随之变化', JSON.stringify(parsed2) !== JSON.stringify(parsed));
  check('预设高亮跟随切换', doc.querySelectorAll('#presetNavBar .preset-pill')[5].classList.contains('active'));
  check('URL 参数同步 preset', /preset=/.test(window.location.search), window.location.search);

  console.log('\n=== 7. 切换分组 ===');
  groupTabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => /工装设计/.test(doc.querySelector('#groupNavBar .group-tab.active').textContent), 10000, '工装设计激活');
  await sleep(500);
  const cards3 = doc.querySelectorAll('#form-container .card');
  check('工装设计有卡片', cards3.length > 0, cards3.length);
  check('工装设计预设数 = 6', doc.querySelectorAll('#presetNavBar .preset-pill').length === 6,
    doc.querySelectorAll('#presetNavBar .preset-pill').length);
  check('URL 参数同步 group', /group=architecture/.test(window.location.search), window.location.search);

  console.log('\n=== 8. 空分组容错 ===');
  doc.querySelectorAll('#groupNavBar .group-tab')[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  const ph = doc.querySelector('#form-container .placeholder');
  check('空分组显示占位提示', !!ph, ph && ph.textContent.slice(0, 40));

  console.log('\n=== 9. 自定义选项 ===');
  doc.querySelectorAll('#groupNavBar .group-tab')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('#form-container .card').length > 0, 15000, '回到家装');
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
    const parsed3 = JSON.parse(doc.getElementById('json-preview').textContent);
    check('自定义值写入 JSON', JSON.stringify(parsed3).includes('我的自定义风格值'));
  }

  console.log('\n=== 10. 重置 ===');
  const resetBtn = doc.querySelector('[data-action=reset]');
  resetBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const parsed4 = JSON.parse(doc.getElementById('json-preview').textContent);
  check('重置后自定义值被清空', !JSON.stringify(parsed4).includes('我的自定义风格值'));
  check('重置后 JSON 仍然有效', Object.keys(parsed4).length > 0);

  console.log('\n=== 结果 ===');
  console.log(failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌');
  dom.window.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('\n测试脚本异常: ' + err.message);
  console.error(err.stack);
  process.exit(2);
});
