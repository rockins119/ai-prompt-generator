/* 等价性验证：原站 vs 本地复刻版，比对生成的 JSON 提示词 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = 'http://154.201.65.81/';
const LOCAL = 'http://127.0.0.1:8123/index.html';

async function grab(browser, url, label, setup) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('#form-container .card, #form-container .field', { timeout: 60000 });
  await new Promise(r => setTimeout(r, 1200));

  const snapshot = await page.evaluate(() => {
    const sel = document.getElementById('presetSelect');
    const presetList = sel
      ? Array.from(sel.options).map(o => o.textContent.trim())
      : Array.from(document.querySelectorAll('#presetNavBar .preset-pill')).map(b => b.textContent.trim());
    const activePreset = sel
      ? (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : null)
      : (document.querySelector('#presetNavBar .preset-pill.active')
        ? document.querySelector('#presetNavBar .preset-pill.active').textContent.trim() : null);
    const activeGroupEl = document.querySelector('#groupNavBar .group-tab.active');
    return {
      groups: Array.from(document.querySelectorAll('#groupNavBar .group-tab')).map(b => b.textContent.trim()),
      presets: presetList,
      cards: document.querySelectorAll('#form-container .card, #form-container .field').length,
      json: document.getElementById('json-preview').textContent,
      activeGroup: activeGroupEl ? activeGroupEl.textContent.trim() : null,
      activePreset: activePreset,
      groupCount: document.querySelectorAll('#groupNavBar .group-tab').length,
      presetCount: presetList.length
    };
  });
  console.log('  [' + label + '] groups=' + snapshot.groupCount + ' presets=' + snapshot.presetCount +
    ' cards=' + snapshot.cards + ' jsonLen=' + snapshot.json.length +
    ' activeGroup=' + snapshot.activeGroup + ' activePreset=' + snapshot.activePreset);
  if (errors.length) console.log('  [' + label + '] 页面错误: ' + JSON.stringify(errors));

  if (setup) await setup(page, snapshot);
  await page.close();
  return snapshot;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });

  console.log('\n=== 抓取原站与本地页面 ===');
  const a = await grab(browser, ORIGIN, '原站');
  const b = await grab(browser, LOCAL, '本地');

  let fail = 0;
  const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
  };

  console.log('\n=== 结构对比 ===');
  const strip = s => String(s).replace(/^\d+\.\s*/, '');
  check('分组标题数量一致', a.groups.length === b.groups.length, { 原站: a.groups.length, 本地: b.groups.length });
  check('分组标题内容一致', JSON.stringify(a.groups) === JSON.stringify(b.groups),
    { 原站: a.groups, 本地: b.groups });
  check('预设数量一致', a.presets.length === b.presets.length, { 原站: a.presets.length, 本地: b.presets.length });
  check('预设列表一致（忽略序号前缀）',
    JSON.stringify(a.presets.map(strip)) === JSON.stringify(b.presets.map(strip)),
    { 原站前三: a.presets.slice(0, 3), 本地前三: b.presets.slice(0, 3) });
  check('默认分组一致', a.activeGroup === b.activeGroup, { 原站: a.activeGroup, 本地: b.activeGroup });
  check('默认预设一致', strip(a.activePreset) === strip(b.activePreset), { 原站: a.activePreset, 本地: b.activePreset });
  check('字段数量一致', a.cards === b.cards, { 原站: a.cards, 本地: b.cards });

  console.log('\n=== 默认 JSON 输出对比 ===');
  check('默认 JSON 完全一致', a.json === b.json,
    { 原站长度: a.json.length, 本地长度: b.json.length });

  if (a.json !== b.json) {
    console.log('\n--- 逐行差异（最多 40 行）---');
    const la = a.json.split('\n'), lb = b.json.split('\n');
    let shown = 0;
    for (let i = 0; i < Math.max(la.length, lb.length) && shown < 40; i++) {
      if (la[i] !== lb[i]) {
        shown++;
        console.log('  行' + (i + 1) + ' 原站: ' + String(la[i]).slice(0, 150));
        console.log('  行' + (i + 1) + ' 本地: ' + String(lb[i]).slice(0, 150));
      }
    }
    fs.writeFileSync('json-origin.json', a.json, 'utf8');
    fs.writeFileSync('json-local.json', b.json, 'utf8');
    console.log('  （完整内容已写入 _test/json-origin.json 与 _test/json-local.json）');
  }

  /* ---- 逐预设、逐分组深度对比 ---- */
  async function compareAcross(pageUrl, label) {
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('#form-container .card, #form-container .field', { timeout: 60000 });
    await new Promise(r => setTimeout(r, 1000));

    const result = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const groups = Array.from(document.querySelectorAll('#groupNavBar .group-tab'));
      for (let gi = 0; gi < groups.length; gi++) {
        groups[gi].click();
        await sleep(900);
        const gName = document.querySelector('#groupNavBar .group-tab.active').textContent.trim();
        out[gName] = {};

        const sel = document.getElementById('presetSelect');
        if (sel) {
          // 本地版：预设是下拉框
          const keys = Array.from(sel.options).map(o => o.value);
          for (let pi = 0; pi < keys.length; pi++) {
            sel.value = keys[pi];
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(320);
            out[gName]['preset#' + pi] = document.getElementById('json-preview').textContent;
          }
        } else {
          // 原站：预设是一排胶囊按钮
          const pills = () => Array.from(document.querySelectorAll('#presetNavBar .preset-pill'));
          const n = pills().length;
          for (let pi = 0; pi < n; pi++) {
            pills()[pi].click();
            await sleep(300);
            out[gName]['preset#' + pi] = document.getElementById('json-preview').textContent;
          }
        }
      }
      return out;
    });
    await page.close();
    return result;
  }

  console.log('\n=== 全量对比：4 个分组 × 全部预设 ===');
  const fullA = await compareAcross(ORIGIN, '原站');
  const fullB = await compareAcross(LOCAL, '本地');

  const groupsA = Object.keys(fullA);
  const groupsB = Object.keys(fullB);
  check('分组名称集合一致', JSON.stringify(groupsA) === JSON.stringify(groupsB), { 原站: groupsA, 本地: groupsB });

  let totalPresets = 0, mismatches = 0;
  for (const g of groupsA) {
    const pa = fullA[g] || {}, pb = fullB[g] || {};
    const ka = Object.keys(pa), kb = Object.keys(pb);
    totalPresets += ka.length;
    let groupBad = 0;
    for (const k of ka) {
      if (pa[k] !== pb[k]) { groupBad++; mismatches++; }
    }
    console.log('  ' + g + ': 预设 ' + ka.length + ' 个，不一致 ' + groupBad + ' 个' +
      (JSON.stringify(ka) !== JSON.stringify(kb) ? ' （预设名单不同！）' : ''));
  }
  check('全部 ' + totalPresets + ' 个预设的 JSON 输出与原站逐字节一致', mismatches === 0,
    { 不一致数量: mismatches });

  console.log('\n=== 结果 ===');
  console.log(fail === 0 ? '与原站完全等价 ✅' : fail + ' 项差异 ❌');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('异常: ' + e.message); process.exit(2); });
