/**
 * PE 成績登記 - Apps Script 後端(資料庫版)
 *
 * 設計方式:
 * - 「學生名冊」分頁由老師自己在 Google Sheet 上維護(新增/刪除/改名學生都直接改這個分頁)。
 *   前端只會「讀取」這個分頁來同步名單,不會寫入或覆蓋它。
 * - 「單元設定」「出席與備註」「成績資料」三個分頁由前端自動寫入(登記分數/調整評量項目時即時同步),
 *   老師不需要手動操作這幾個分頁,它們是程式自動維護的資料庫。
 *
 * 部署方式請見 README.md。
 */

var SHEET_ROSTER = '學生名冊';
var SHEET_UNITS = '單元設定';
var SHEET_ATTEND = '出席與備註';
var SHEET_RECORDS = '成績資料';

/* ---------- 選單 ---------- */
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('體育成績登記')
    .addItem('一鍵設定', 'setup')
    .addToUi();
}

function setup(){
  ensureSheets_();
  SpreadsheetApp.getUi().alert(
    '設定完成。\n\n' +
    '1. 到「學生名冊」分頁建立您的班級與學生名單(欄位:班級代碼、座號、姓名)。\n' +
    '2. 到「專案設定 → 指令碼屬性」確認已新增 PE_API_KEY。\n' +
    '3. 到「部署 → 管理部署作業」建立或更新 Web App 部署(執行身分:我;存取權限:任何人)。\n' +
    '4. 把 Web App 網址與 PE_API_KEY 填進網頁的「雲端同步」設定。\n\n' +
    '「班級代碼」請自訂一個好記的代碼(例如 115-1-一年級-1班),登記網頁新增班級時要填一樣的代碼才能對應。'
  );
}

/* ---------- 共用 ---------- */
function getApiKey_(){
  return PropertiesService.getScriptProperties().getProperty('PE_API_KEY');
}

function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key){
  return !!key && key === getApiKey_();
}

/** 去除頭尾空白,並把值一律轉成字串,避免「一年級1班 」「115-1-一年級-1班」這類打字差異或
 *  Sheet 把座號存成數字(1)、前端存成字串("1")的型別差異造成比對不到。 */
function norm_(v){ return String(v===undefined||v===null?'':v).trim(); }

function ensureSheets_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetWithHeader_(ss, SHEET_ROSTER, ['班級代碼','座號','姓名']);
  ensureSheetWithHeader_(ss, SHEET_UNITS, ['班級代碼','單元代碼(名稱|週次)','單元名稱','週次','評量項目JSON','更新時間']);
  ensureSheetWithHeader_(ss, SHEET_ATTEND, ['班級代碼','單元代碼','座號','出席狀態','教師備註','更新時間']);
  ensureSheetWithHeader_(ss, SHEET_RECORDS, ['班級代碼','單元代碼','座號','評量項目','評量方式','配分%','原始數據','換算分數','更新時間']);
}

function ensureSheetWithHeader_(ss, name, header){
  var sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,header.length).setValues([header]);
    sh.getRange(1,1,1,header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 依 keyCols(欄位 index,從0起)比對 keyValues,找到就更新該列,找不到就新增一列。 */
function upsertRow_(sh, keyColIdx, keyValues, rowValues){
  var lastRow = sh.getLastRow();
  if(lastRow>=2){
    var range = sh.getRange(2,1,lastRow-1, sh.getLastColumn());
    var data = range.getValues();
    for(var i=0;i<data.length;i++){
      var match = keyColIdx.every(function(colIdx, k){ return norm_(data[i][colIdx]) === norm_(keyValues[k]); });
      if(match){
        sh.getRange(i+2,1,1,rowValues.length).setValues([rowValues]);
        return;
      }
    }
  }
  sh.appendRow(rowValues);
}

function unitKeyOf_(name, week){ return name+'|'+week; }

/* ---------- Web App 入口 ---------- */
function doGet(e){
  var p = e.parameter;
  if(!checkKey_(p.key)){ return jsonOut_({ok:false, error:'invalid_key'}); }
  ensureSheets_();

  if(p.action === 'pull'){
    return jsonOut_(pullClass_(p.classKey));
  }
  return jsonOut_({ok:false, error:'unknown_action'});
}

function doPost(e){
  var body;
  try{ body = JSON.parse(e.postData.contents); }catch(err){
    return jsonOut_({ok:false, error:'bad_body'});
  }
  if(!checkKey_(body.key)){ return jsonOut_({ok:false, error:'invalid_key'}); }
  ensureSheets_();

  if(body.action === 'upsertUnit'){ return jsonOut_(upsertUnit_(body)); }
  if(body.action === 'upsertRecord'){ return jsonOut_(upsertRecord_(body)); }
  if(body.action === 'upsertAttendance'){ return jsonOut_(upsertAttendance_(body)); }
  return jsonOut_({ok:false, error:'unknown_action'});
}

/* ---------- 讀取(老師在「學生名冊」維護,程式只讀) ---------- */
function pullClass_(classKeyRaw){
  var classKey = norm_(classKeyRaw);
  if(!classKey) return {ok:false, error:'missing_classKey'};
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var rosterSh = ss.getSheetByName(SHEET_ROSTER);
  if(!rosterSh){
    return {ok:false, error:'sheet_not_found', message:'找不到「'+SHEET_ROSTER+'」分頁,請確認分頁名稱完全一致(含是否有多餘空白)。'};
  }
  var roster = [];
  var seenClassKeys = {}; // 用來回報「Sheet 裡實際有哪些班級代碼」,方便抓打字落差
  var rData = rosterSh.getDataRange().getValues();
  for(var i=1;i<rData.length;i++){
    var rowClassKey = norm_(rData[i][0]);
    if(!rowClassKey) continue;
    seenClassKeys[rowClassKey] = true;
    if(rowClassKey===classKey && norm_(rData[i][1])!==''){
      roster.push({seat:norm_(rData[i][1]), name:norm_(rData[i][2])});
    }
  }

  var unitsSh = ss.getSheetByName(SHEET_UNITS);
  var uData = unitsSh ? unitsSh.getDataRange().getValues() : [];
  var units = [];
  for(var j=1;j<uData.length;j++){
    if(norm_(uData[j][0])===classKey && norm_(uData[j][1])!==''){
      var items = [];
      try{ items = JSON.parse(uData[j][4]); }catch(err){ items = []; }
      units.push({unitKey:norm_(uData[j][1]), name:norm_(uData[j][2]), week:norm_(uData[j][3]), items:items});
    }
  }

  var attendSh = ss.getSheetByName(SHEET_ATTEND);
  var aData = attendSh ? attendSh.getDataRange().getValues() : [];
  var attendance = {}; // unitKey|seat -> {att, note}
  for(var k=1;k<aData.length;k++){
    if(norm_(aData[k][0])===classKey && norm_(aData[k][1])!==''){
      attendance[norm_(aData[k][1])+'|'+norm_(aData[k][2])] = {att:norm_(aData[k][3]), note:norm_(aData[k][4])};
    }
  }

  var recSh = ss.getSheetByName(SHEET_RECORDS);
  var recData = recSh ? recSh.getDataRange().getValues() : [];
  var records = {}; // unitKey|seat|itemName -> raw
  for(var m=1;m<recData.length;m++){
    if(norm_(recData[m][0])===classKey && norm_(recData[m][1])!==''){
      records[norm_(recData[m][1])+'|'+norm_(recData[m][2])+'|'+norm_(recData[m][3])] = recData[m][6];
    }
  }

  var result = {ok:true, roster:roster, units:units, attendance:attendance, records:records, updatedAt:new Date().toISOString()};
  if(roster.length===0){
    result.warning = '在「'+SHEET_ROSTER+'」分頁裡找不到班級代碼「'+classKey+'」的學生。';
    result.availableClassKeys = Object.keys(seenClassKeys);
  }
  return result;
}

/* ---------- 寫入(前端自動呼叫,老師不需手動操作) ---------- */
function upsertUnit_(body){
  var classKey = norm_(body.classKey), name = norm_(body.name), week = norm_(body.week);
  if(!classKey || !name || !week) return {ok:false, error:'missing_fields'};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_UNITS);
  var unitKey = unitKeyOf_(name, week);
  upsertRow_(sh, [0,1], [classKey, unitKey],
    [classKey, unitKey, name, week, JSON.stringify(body.items||[]), new Date().toISOString()]);
  return {ok:true, unitKey:unitKey, updatedAt:new Date().toISOString()};
}

function upsertRecord_(body){
  var classKey = norm_(body.classKey), unitKey = norm_(body.unitKey), seat = norm_(body.seat), itemName = norm_(body.itemName);
  if(!classKey || !unitKey || !seat || !itemName) return {ok:false, error:'missing_fields'};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
  upsertRow_(sh, [0,1,2,3], [classKey, unitKey, seat, itemName],
    [classKey, unitKey, seat, itemName, body.itemType||'', body.weight||0,
     body.raw===undefined?'':body.raw, body.score===undefined?'':body.score, new Date().toISOString()]);
  return {ok:true, updatedAt:new Date().toISOString()};
}

function upsertAttendance_(body){
  var classKey = norm_(body.classKey), unitKey = norm_(body.unitKey), seat = norm_(body.seat);
  if(!classKey || !unitKey || !seat) return {ok:false, error:'missing_fields'};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTEND);
  upsertRow_(sh, [0,1,2], [classKey, unitKey, seat],
    [classKey, unitKey, seat, body.att||'出席', body.note||'', new Date().toISOString()]);
  return {ok:true, updatedAt:new Date().toISOString()};
}
