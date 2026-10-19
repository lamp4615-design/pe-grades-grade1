// 教師後台 admin.html 的測試（由 run.js 呼叫）。用一組可以手算的小資料驗證數字。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { build } = require('./gas-mock');

module.exports = async function adminTests({ ok, eq, sleep, KEY }) {
  console.log('\n【教師後台 admin.html（jsdom）】');
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const g2 = build(); g2.ctx.setup(); g2.props.set('PASSCODE', KEY);
  g2.sheets.get('班級名單').rows = [['班級', '座號', '姓名'], ...Array.from({ length: 10 }, (_, i) => ['101', i + 1, `後台${i + 1}`]), ['102', 1, '空班生']];
  g2.sheets.get('活動設定').rows.find(r => r[0] === 'ROPE02')[15] = 98;      // 跳繩「優分」自訂 98
  const D1 = '2026-09-01', D2 = '2026-09-15';
  const R = (date, no, aid, value, extra) => Object.assign({ date, cls: '101', no, aid, value }, extra);
  const recs = [];
  for (const d of [D1, D2]) recs.push(R(d, 1, 'ROPE02', 15), R(d, 1, 'BALL01', 10), R(d, 1, 'ATT02', 4));      // 1 號：全優
  recs.push(R(D1, 2, 'ROPE02', 15), R(D2, 2, 'ROPE02', 0), R(D1, 2, 'BALL01', 5), R(D1, 2, 'ATT02', 3));       // 2 號：跳繩 優→需加油（退步）
  recs.push(R(D1, 3, 'ROPE02', 0), R(D1, 3, 'BALL01', 0), R(D1, 3, 'ATT02', 1));                                // 3 號：全需加油
  recs.push(R(D1, 4, 'ROPE02', null, { absent: true, note: '感冒' }), R(D1, 4, 'BALL01', 5), R(D1, 4, 'ATT02', 3)); // 4 號：跳繩缺席
  for (let n = 5; n <= 10; n++) recs.push(R(D1, n, 'ROPE02', 8), R(D1, n, 'BALL01', 5), R(D1, n, 'ATT02', 3));  // 5–10 號：全達成
  g2.post({ action: 'save', key: KEY, records: recs });

  const blobs = [];
  const dom = new JSDOM(adminHtml, {
    url: 'https://app.test/admin.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('pe1.auth', JSON.stringify({ url: 'x', key: KEY }));
      w.localStorage.setItem('pe1.admin.ui', JSON.stringify({ tab: 'home', cls: '101' }));
      w.scrollTo = () => { }; w.print = () => { };
      w.URL.createObjectURL = b => { blobs.push(b); return 'blob:x'; };
      w.HTMLAnchorElement.prototype.click = function () { };
      w.fetch = async (u, init) => ({ ok: true, status: 200, json: async () => g2.post(init.body) });
    }
  });
  const w = dom.window, d = w.document, A = w.__admin;
  for (let i = 0; i < 100 && !A.S.scores.size; i++) await sleep(20);
  const text = () => d.querySelector('#main').textContent;
  const tab = t => d.querySelector(`#tabs [data-tab=${t}]`).click();
  const blobBuf = b => new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(Buffer.from(fr.result)); fr.readAsArrayBuffer(b); });

  ok(A.S.scores.size === recs.length, `後台載入 ${A.S.scores.size} 筆成績`);
  eq(A.S.cfg.activities.find(a => a.id === 'ROPE02').sc, [98, 93, 89, 85], '後台拿到逐活動自訂分數（跳繩優分 98，其餘預設）');

  // 班級總覽
  const cards = [...d.querySelectorAll('.cc')];
  ok(cards.length === 2, '班級總覽：兩個班級卡片');
  ok(/92\.6/.test(cards[0].textContent), '班級總覽：101 平均 92.6 分（手算 92.57，含跳繩優分 98 的自訂換算）');
  ok(/關注 1/.test(cards[0].textContent), '班級總覽：101 需關注 1 位（3 號整體偏低；2 號只有單一活動退步，列為「留意」不計入）');
  ok(/–/.test(cards[1].textContent), '班級總覽：沒資料的班級顯示「–」');
  ok(!/NaN|undefined/.test(d.body.textContent), '總覽頁沒有 NaN／undefined');

  // 班級分析
  cards[0].click();
  ok(A.st.tab === 'cls', '點班級卡片 → 班級分析');
  const kpis = [...d.querySelectorAll('.kpi')].map(k => k.textContent.replace(/\s/g, ''));
  ok(kpis.some(k => k.includes('達成率86%')), '班級分析：達成率 86%（手算 25/29）');
  ok(kpis.some(k => k.includes('待補測1項')), '班級分析：待補測 1 項');
  ok(d.querySelectorAll('.insight li').length >= 4, '班級分析：自動產生文字摘要（' + d.querySelectorAll('.insight li').length + ' 句）');
  ok(d.querySelectorAll('.hist div').length === 4, '班級分析：分數分布 4 段');
  ok(d.querySelector('svg polyline') && d.querySelectorAll('svg circle').length === 2, '班級分析：趨勢折線（2 個登記日）');
  ok(!/NaN|undefined/.test(d.body.textContent), '班級分析沒有 NaN／undefined');

  // 學生成績表
  tab('stu');
  let rows = [...d.querySelectorAll('tbody tr')];
  eq(rows.length, 11, '學生成績表：10 位＋全班平均列');
  ok(rows[0].textContent.includes('⭐') && /99\.3/.test(rows[0].textContent), '1 號：⭐、總分 99.3（跳繩 98＋球類 100＋態度 100）');
  const s3 = rows.find(r => r.textContent.includes('後台3'));
  ok(/85\.0/.test(s3.textContent) && /關注/.test(s3.textContent), '3 號：總分 85.0 並標示「關注」');
  [...d.querySelectorAll('th.sort')].find(t => t.textContent.startsWith('總分')).click();
  rows = [...d.querySelectorAll('tbody tr')];
  ok(/後台3/.test(rows[0].textContent), '點「總分」排序 → 最低分在最前');
  const cb = d.querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
  eq([...d.querySelectorAll('tbody tr.click')].length, 1, '只看需關注：1 位');
  A.st.onlyFlag = false; A.st.sk = 'no'; A.st.sd = 1; A.render();
  const q = d.querySelector('input[type=search]'); q.value = '後台7'; q.dispatchEvent(new w.Event('input', { bubbles: true }));
  eq([...d.querySelectorAll('tbody tr.click')].length, 1, '搜尋姓名');
  A.st.q = ''; A.render();

  // 學生詳情
  [...d.querySelectorAll('tbody tr.click')].find(r => r.textContent.includes('後台2')).click();
  const dr = d.querySelector('#drawer');
  ok(dr.classList.contains('open') && /退步/.test(dr.textContent) && dr.querySelector('svg polygon'), '學生詳情：雷達圖與「退步」趨勢（2 號跳繩 優→需加油）');
  ok(/9\/1/.test(dr.textContent) && /9\/15/.test(dr.textContent), '學生詳情：列出歷次日期 ' + dr.textContent.slice(0, 300));

  // 待處理
  tab('todo');
  ok(/需要關注（1）/.test(text()) && /留意（1）/.test(text()) && /缺席待補測（1）/.test(text()), '待處理：關注 1、留意 1、待補測 1');
  ok(/退步/.test(text()) && /整體偏低/.test(text()), '待處理：顯示原因（單項退步列為留意、整體偏低列為關注）');
  g2.post({ action: 'save', key: KEY, records: [R(D2, 4, 'ROPE02', 8)] });
  d.getElementById('btnRefresh').click(); await sleep(150);
  ok(/缺席待補測（0）/.test(text()), '4 號補測登記後，待補測自動消失');

  // 學期成績單
  tab('report');
  ok(/體育學期成績單/.test(text()) && d.querySelectorAll('tbody tr').length === 11, '學期成績單：10 位＋平均');
  [...d.querySelectorAll('button')].find(b => b.textContent.includes('匯出成績單')).click();
  const b1 = await blobBuf(blobs[0]);
  const csv = b1.toString('utf8').replace(/^﻿/, '').split('\r\n');
  ok(b1[0] === 0xEF && csv[0].startsWith('班級,座號,姓名,跳繩,球類,安全與態度,總分'), '成績單 CSV：BOM＋表頭（各類別欄）');
  ok(csv[1].startsWith('101,1,後台1,98.0,100.0,100.0,99.3'), '成績單 CSV：1 號 98.0／100.0／100.0／總分 99.3');
  [...d.querySelectorAll('button')].find(b => b.textContent.includes('明細')).click();
  const lines = (await blobBuf(blobs[1])).toString('utf8').split('\r\n');
  ok(lines[0].includes('分數') && lines.length > 30, `明細 CSV：${lines.length - 1} 筆，含「分數」欄`);

  // 算法與日期區間
  A.st.mode = 'act'; A.render(); tab('stu');
  ok(/9[89]\.\d/.test(d.querySelector('tbody tr').textContent), '總分算法切換為「各活動平均」仍正確');
  A.st.from = '2026-09-10'; A.render(); tab('cls');
  ok(!/NaN|undefined/.test(d.body.textContent), '日期區間篩選（9/10 起）不出錯');
  A.st.from = '2030-01-01'; A.render();
  ok(/還沒有任何成績/.test(text()), '區間內沒資料 → 友善提示');
  w.close();
};
