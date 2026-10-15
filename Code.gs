/**
 * PE 成績登記 - Apps Script 後端
 *
 * 用途:接收前端(index.html)的成績資料,存成一份 JSON(存在 Google 雲端硬碟),
 * 並同步鏡像到這份試算表的三個分頁,方便老師直接用 Google Sheet 查看與留存。
 *
 * 部署方式請見 README.md。
 */

var DATA_FOLDER_NAME = 'PE成績登記資料';
var DATA_FILE_NAME = 'pe_grades_data.json';

/* ---------- 選單(在綁定的 Google Sheet 開啟時顯示) ---------- */
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('體育成績登記')
    .addItem('一鍵設定', 'setup')
    .addItem('重新產生成績分頁', 'rebuildSheets')
    .addToUi();
}

function setup(){
  getOrCreateDataFile_();
  rebuildSheets();
  SpreadsheetApp.getUi().alert(
    '設定完成。\n\n' +
    '1. 到「專案設定 → 指令碼屬性」確認已新增 PE_API_KEY。\n' +
    '2. 到「部署 → 管理部署作業」建立或更新 Web App 部署(執行身分:我;存取權限:任何人)。\n' +
    '3. 把 Web App 網址與 PE_API_KEY 填進網頁的「雲端同步」設定。'
  );
}

/* ---------- 共用 ---------- */
function getApiKey_(){
  return PropertiesService.getScriptProperties().getProperty('PE_API_KEY');
}

function getOrCreateFolder_(){
  var folders = DriveApp.getFoldersByName(DATA_FOLDER_NAME);
  if(folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DATA_FOLDER_NAME);
}

function emptyState_(){
  return {classes:[], units:[], students:[], attendance:{}, notes:{}, records:{}};
}

function getOrCreateDataFile_(){
  var folder = getOrCreateFolder_();
  var files = folder.getFilesByName(DATA_FILE_NAME);
  if(files.hasNext()) return files.next();
  return folder.createFile(DATA_FILE_NAME, JSON.stringify(emptyState_()), MimeType.PLAIN_TEXT);
}

function loadState_(){
  var file = getOrCreateDataFile_();
  var text = file.getBlob().getDataAsString();
  try{ return JSON.parse(text); }catch(e){ return emptyState_(); }
}

function saveState_(state){
  var folder = getOrCreateFolder_();
  var files = folder.getFilesByName(DATA_FILE_NAME);
  var file = files.hasNext() ? files.next() : folder.createFile(DATA_FILE_NAME, '{}', MimeType.PLAIN_TEXT);
  file.setContent(JSON.stringify(state));
}

function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Web App 入口 ---------- */
function doGet(e){
  var key = e.parameter.key;
  if(!key || key !== getApiKey_()){
    return jsonOut_({ok:false, error:'invalid_key'});
  }
  var state = loadState_();
  return jsonOut_({ok:true, state:state, updatedAt: new Date().toISOString()});
}

function doPost(e){
  var body;
  try{ body = JSON.parse(e.postData.contents); }catch(err){
    return jsonOut_({ok:false, error:'bad_body'});
  }
  if(!body.key || body.key !== getApiKey_()){
    return jsonOut_({ok:false, error:'invalid_key'});
  }
  if(!body.state){
    return jsonOut_({ok:false, error:'missing_state'});
  }
  saveState_(body.state);
  try{ rebuildSheets_(body.state); }catch(err){ /* 鏡像到 Sheet 失敗不影響存檔 */ }
  return jsonOut_({ok:true, updatedAt: new Date().toISOString()});
}

/* ---------- 鏡像到 Google Sheet ---------- */
function rebuildSheets(){
  rebuildSheets_(loadState_());
}

function rebuildSheets_(state){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeRoster_(ss, state);
  writeSummary_(ss, state);
  writeDetail_(ss, state);
}

function byId_(arr, id){
  for(var i=0;i<arr.length;i++){ if(arr[i].id===id) return arr[i]; }
  return null;
}

function termLabel_(term){ return term==='2' ? '第二學期' : '第一學期'; }

function classLabel_(cls){
  if(!cls) return '';
  return cls.year+'學年度 '+termLabel_(cls.term)+' '+cls.grade+cls.cls;
}

function getOrCreateSheet_(ss, name){
  var sh = ss.getSheetByName(name);
  if(!sh){ sh = ss.insertSheet(name); }
  sh.clearContents();
  return sh;
}

function writeSheetRows_(sh, rows){
  if(rows.length===0){ rows = [['(尚無資料)']]; }
  sh.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  sh.getRange(1,1,1,rows[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function writeRoster_(ss, state){
  var sh = getOrCreateSheet_(ss, '班級名冊');
  var rows = [['班級','座號','姓名']];
  state.students.forEach(function(stu){
    var cls = byId_(state.classes, stu.classId);
    rows.push([classLabel_(cls), stu.seat, stu.name]);
  });
  writeSheetRows_(sh, rows);
}

/* 與前端 index.html 的換算規則一致,請兩邊同步修改 */
function computeScore_(item, raw){
  if(raw===undefined || raw===null || raw===''){ return null; }
  if(item.type==='score'){
    var n = Number(raw);
    return isNaN(n) ? null : n;
  }
  if(item.type==='level'){
    var lv = (item.config.levels||[]).filter(function(l){ return l.label===raw; })[0];
    return lv ? lv.score : null;
  }
  if(item.type==='metric'){
    var n2 = Number(raw);
    if(isNaN(n2)) return null;
    var best = item.config.best, pass = item.config.pass, dir = item.config.direction;
    var s;
    if(dir==='low'){
      s = (best===pass) ? (n2<=best?100:60) : 60 + (pass-n2)/(pass-best)*40;
    } else {
      s = (best===pass) ? (n2>=best?100:60) : 60 + (n2-pass)/(best-pass)*40;
    }
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  if(item.type==='done'){
    var opt = (item.config.options||[]).filter(function(o){ return o.label===raw; })[0];
    return opt ? opt.score : null;
  }
  return null;
}

function studentUnitResult_(state, unit, studentId){
  var att = state.attendance[unit.id+'|'+studentId] || '出席';
  var anyMissing = false, weighted = 0;
  unit.items.forEach(function(item){
    var raw = state.records[unit.id+'|'+studentId+'|'+item.id];
    var sc = computeScore_(item, raw);
    if(sc===null){ anyMissing = true; } else { weighted += sc * (item.weight/100); }
  });
  var normal = (att==='出席' || att==='已補測');
  var status;
  if(att==='缺席待補測') status='待補測';
  else if(att==='請假') status='請假';
  else if(att==='免測') status='免測';
  else status = anyMissing ? '待登錄' : '已完成';
  var finalScore = (normal && !anyMissing) ? Math.round(weighted) : null;
  return {att:att, status:status, finalScore:finalScore};
}

function writeSummary_(ss, state){
  var sh = getOrCreateSheet_(ss, '成績總表');
  var rows = [['學年度','學期','年級','班級','單元','週次','座號','姓名','出席狀態','加權總成績','狀態','教師備註']];
  state.units.forEach(function(unit){
    var cls = byId_(state.classes, unit.classId);
    if(!cls) return;
    var students = state.students.filter(function(s){ return s.classId===unit.classId; });
    students.sort(function(a,b){ return (a.seat||'').localeCompare(b.seat||''); });
    students.forEach(function(stu){
      var r = studentUnitResult_(state, unit, stu.id);
      var note = state.notes[unit.id+'|'+stu.id] || '';
      rows.push([cls.year, termLabel_(cls.term), cls.grade, cls.cls, unit.name, unit.week,
        stu.seat, stu.name, r.att, r.finalScore===null?'':r.finalScore, r.status, note]);
    });
  });
  writeSheetRows_(sh, rows);
}

function writeDetail_(ss, state){
  var sh = getOrCreateSheet_(ss, '成績明細');
  var rows = [['學年度','學期','年級','班級','單元','週次','座號','姓名','評量項目','評量方式','配分%','原始數據','換算分數']];
  var typeLabel = {score:'分數', level:'等級', metric:'數據', done:'完成狀態'};
  state.units.forEach(function(unit){
    var cls = byId_(state.classes, unit.classId);
    if(!cls) return;
    var students = state.students.filter(function(s){ return s.classId===unit.classId; });
    students.sort(function(a,b){ return (a.seat||'').localeCompare(b.seat||''); });
    students.forEach(function(stu){
      unit.items.forEach(function(item){
        var raw = state.records[unit.id+'|'+stu.id+'|'+item.id];
        var sc = computeScore_(item, raw);
        rows.push([cls.year, termLabel_(cls.term), cls.grade, cls.cls, unit.name, unit.week,
          stu.seat, stu.name, item.name, typeLabel[item.type]||item.type, item.weight,
          (raw===undefined||raw===null)?'':raw, sc===null?'':sc]);
      });
    });
  });
  writeSheetRows_(sh, rows);
}
