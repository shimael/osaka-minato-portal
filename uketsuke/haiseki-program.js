/* ============================================================
 *  MS の進行（R9 講話＆会員スピーチ）
 *
 *  正はスプレッドシート「大阪みなと会員スピーチ」の R9 タブ。
 *  配席の上と、LINE 用の画像の先頭に出す。朝食会では使わない。
 *  列の位置は見出し名で探す（列がずれても壊れにくくする）。
 *  ダブル講話は「W講話」列。トリプルは見出しに「トリプル」があれば読む。
 * ============================================================ */
(function (global) {
  "use strict";

  const SHEET = {
    id: "1DWyJy9Hst3ohPIme66oFf37dMbp7VwKiGyBb8JyC8Iw",
    gid: "1644925538",
    url: "https://docs.google.com/spreadsheets/d/1DWyJy9Hst3ohPIme66oFf37dMbp7VwKiGyBb8JyC8Iw/edit?gid=1644925538#gid=1644925538"
  };
  const CACHE = "haiseki.program.r9";

  function parseCsv(text) {
    const rows = [];
    let row = [], cur = "", q = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch !== "\r") cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  const tidy = s => String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t　]+/g, " ").trim();
  const oneLine = s => tidy(s).replace(/\n+/g, " ").replace(/ +/g, " ").trim();
  const compact = s => String(s || "").replace(/[\s　]/g, "");

  function parseSheetDate(s) {
    const t = String(s || "").trim();
    const m = t.match(/^(\d{2,4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (!m) return "";
    let y = Number(m[1]);
    if (y < 100) y += 2000;
    return y + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
  }

  function headerKey(c) {
    return String(c || "").replace(/[\s　\n\r]/g, "");
  }

  /* ホワイトボード／プロジェクターの欄。⚪︎・利用・PC持参 などを「使う／使わない」にそろえる */
  function gear(raw) {
    const t = compact(raw).replace(/[ー－―]/g, "-");
    if (!t) return { use: null, label: "未記入", note: "" };
    if (/^(なし|無し|-|×|x|✗|✘)$/i.test(t)) return { use: false, label: "使わない", note: "" };
    if (/[○◯〇⚪︎●]/.test(raw) || t === "あり" || t === "使う") return { use: true, label: "使う", note: "" };
    if (/利用/.test(t) || /PC/.test(t) || /プロジェクター/.test(t)) {
      let note = "";
      if (/持参/.test(t)) note = "PC持参";
      else if (/単会/.test(t)) note = "PCは単会用意";
      return { use: true, label: "使う", note };
    }
    return { use: true, label: "使う", note: oneLine(raw) };
  }
  function gearText(g) {
    if (!g || g.use == null) return "未記入";
    return g.note ? g.label + "（" + g.note + "）" : g.label;
  }
  function mergeGear(list) {
    const used = list.find(g => g && g.use === true);
    if (used) return used;
    if (list.some(g => g && g.use === false)) return { use: false, label: "使わない", note: "" };
    return { use: null, label: "未記入", note: "" };
  }

  function isNoneSpeech(s) {
    const t = compact(s);
    if (!t) return true;
    if (/^(無し|なし|-)$/.test(t)) return true;
    if (/休会/.test(t)) return true;
    return false;
  }
  function isBlankName(s) {
    const t = compact(s);
    if (!t) return true;
    if (/休会/.test(t)) return true;
    if (/^(無し|なし|-)$/.test(t)) return true;
    if (/^(w講[話和]|W講[話和]|ダブル講話|トリプル講話)$/i.test(t)) return true;
    return false;
  }

  function parsePerson(raw, extra) {
    extra = extra || {};
    const lines = tidy(raw).split("\n").map(s => s.trim()).filter(Boolean);
    if (!lines.length || isBlankName(lines[0])) return null;
    let name = lines[0].replace(/さん$/u, "").trim();
    let kana = "";
    if (lines[1] && /[ぁ-んァ-ヶー]/.test(lines[1])) kana = lines[1];
    return {
      name, kana,
      callAs: oneLine(extra.callAs),
      role: oneLine(extra.role),
      org: oneLine(extra.org),
      title: tidy(extra.title).replace(/\n+/g, "\n"),
      whiteboard: gear(extra.whiteboard),
      projector: gear(extra.projector)
    };
  }

  function findHeader(headers, names, from) {
    for (let i = from || 0; i < headers.length; i++) {
      const h = headers[i];
      if (names.some(n => h.indexOf(n) >= 0)) return i;
    }
    return -1;
  }

  function parseSheet(values) {
    if (!values || !values.length) return [];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(values.length, 4); i++) {
      const line = (values[i] || []).map(headerKey);
      if (line.some(h => h.indexOf("担当日") >= 0) && line.some(h => h === "講師" || h.indexOf("講師") === 0)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return [];
    const headers = (values[headerIdx] || []).map(headerKey);
    const cell = (line, i) => (i >= 0 && line[i] != null) ? line[i] : "";

    const iDate = findHeader(headers, ["担当日"], 0);
    const iTag = iDate >= 0 ? iDate + 1 : 1;
    const iKowa = findHeader(headers, ["講師"], 0);
    const afterKowa = iKowa >= 0 ? iKowa : 0;
    const iCall1 = findHeader(headers, ["呼び出し方"], afterKowa);
    const iRole1 = findHeader(headers, ["研究所辞令", "役職"], afterKowa);
    const iOrg1 = findHeader(headers, ["所属"], afterKowa);
    const iTitle1 = findHeader(headers, ["タイトル"], afterKowa);
    const iWb1 = findHeader(headers, ["ホワイト"], afterKowa);
    const iPj1 = findHeader(headers, ["プロジェクター"], afterKowa);

    const iW = findHeader(headers, ["W講話", "ダブル講話"], 0);
    const afterW = iW >= 0 ? iW : headers.length;
    const iCall2 = iW >= 0 ? findHeader(headers, ["呼び出し方"], iW) : -1;
    const iRole2 = iW >= 0 ? findHeader(headers, ["研究所辞令", "役職"], iW) : -1;
    const iOrg2 = iW >= 0 ? findHeader(headers, ["所属"], iW) : -1;
    const iTitle2 = iW >= 0 ? findHeader(headers, ["タイトル"], iW) : -1;
    const iWb2 = iW >= 0 ? findHeader(headers, ["ホワイト"], iW) : -1;
    const iPj2 = iW >= 0 ? findHeader(headers, ["プロジェクター"], iW) : -1;

    const iT = findHeader(headers, ["トリプル講話", "T講話"], 0);
    const iCall3 = iT >= 0 ? findHeader(headers, ["呼び出し方"], iT) : -1;
    const iRole3 = iT >= 0 ? findHeader(headers, ["研究所辞令", "役職"], iT) : -1;
    const iOrg3 = iT >= 0 ? findHeader(headers, ["所属"], iT) : -1;
    const iTitle3 = iT >= 0 ? findHeader(headers, ["タイトル"], iT) : -1;
    const iWb3 = iT >= 0 ? findHeader(headers, ["ホワイト"], iT) : -1;
    const iPj3 = iT >= 0 ? findHeader(headers, ["プロジェクター"], iT) : -1;

    const iSpeech = findHeader(headers, ["会員スピーチ"], 0);
    const iSpeechRole = iSpeech >= 0 ? findHeader(headers, ["役職"], iSpeech) : -1;

    let start = headerIdx + 1;
    if (values[start] && !parseSheetDate(cell(values[start], iDate))) start += 1;

    const out = [];
    for (let r = start; r < values.length; r++) {
      const line = values[r] || [];
      const date = parseSheetDate(cell(line, iDate));
      if (!date) continue;
      const tag = tidy(cell(line, iTag));
      const speakers = [];
      const p1 = parsePerson(cell(line, iKowa), {
        callAs: cell(line, iCall1), role: cell(line, iRole1), org: cell(line, iOrg1),
        title: cell(line, iTitle1), whiteboard: cell(line, iWb1), projector: cell(line, iPj1)
      });
      if (p1) speakers.push(p1);
      const p2 = parsePerson(cell(line, iW), {
        callAs: cell(line, iCall2), role: cell(line, iRole2), org: cell(line, iOrg2),
        title: cell(line, iTitle2), whiteboard: cell(line, iWb2), projector: cell(line, iPj2)
      });
      if (p2) speakers.push(p2);
      const p3 = iT >= 0 ? parsePerson(cell(line, iT), {
        callAs: cell(line, iCall3), role: cell(line, iRole3), org: cell(line, iOrg3),
        title: cell(line, iTitle3), whiteboard: cell(line, iWb3), projector: cell(line, iPj3)
      }) : null;
      if (p3) speakers.push(p3);

      const speechRaw = cell(line, iSpeech);
      const speech = isNoneSpeech(speechRaw) ? null : parsePerson(speechRaw, { role: cell(line, iSpeechRole) });

      const recess = /休会/.test(tag) || /休会/.test(cell(line, iKowa));
      const tags = [];
      if (recess) tags.push("休会");
      if (/トリプル/.test(tag) || speakers.length >= 3) tags.push("トリプル講話");
      else if (/W講|ダブル/.test(tag) || speakers.length >= 2) tags.push("ダブル講話");
      if (/バッチ|バッジ/.test(tag)) tags.push("バッジ贈呈式");
      if (/辞令/.test(tag)) tags.push("辞令交付式");
      if (/夢を語る/.test(tag)) tags.push("夢を語る会");
      if (/抱負/.test(tag)) tags.push("抱負をかたる会");
      if (/自単会/.test(tag)) tags.push("自単会講話");
      if (!recess) tags.push(speech ? "会員スピーチあり" : "会員スピーチなし");

      out.push({
        date, recess, tag: oneLine(tag), tags, speakers, speech,
        whiteboard: mergeGear(speakers.map(s => s.whiteboard)),
        projector: mergeGear(speakers.map(s => s.projector))
      });
    }
    return out;
  }

  function forDate(sessions, date) {
    return (sessions || []).find(s => s.date === date) || null;
  }

  async function fetchSheet() {
    const url = "https://docs.google.com/spreadsheets/d/" + SHEET.id + "/export?format=csv&gid=" + SHEET.gid + "&_=" + Date.now();
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok || /<html/i.test(text.slice(0, 80))) throw new Error("進行表を開けませんでした");
    return parseSheet(parseCsv(text));
  }

  async function load(fresh) {
    if (!fresh) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE) || "null");
        if (cached && cached.sessions && cached.sessions.length) {
          fetchSheet().then(sessions => {
            try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), sessions })); } catch (e) { /* ignore */ }
          }).catch(() => {});
          return cached.sessions;
        }
      } catch (e) { /* ignore */ }
    }
    const sessions = await fetchSheet();
    try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), sessions })); } catch (e) { /* ignore */ }
    return sessions;
  }

  /* 画面・画像の両方で同じ文言にする */
  function summary(sess) {
    if (!sess) return null;
    const speakers = (sess.speakers || []).map((s, i) => ({
      label: sess.speakers.length > 1 ? "講話" + (i + 1) : "講話",
      name: s.name, kana: s.kana, callAs: s.callAs, role: s.role, org: s.org,
      title: s.title, whiteboard: gearText(s.whiteboard), projector: gearText(s.projector)
    }));
    return {
      recess: sess.recess,
      tags: sess.tags || [],
      tag: sess.tag || "",
      speakers,
      speech: sess.speech ? { name: sess.speech.name, kana: sess.speech.kana, role: sess.speech.role } : null,
      whiteboard: gearText(sess.whiteboard),
      projector: gearText(sess.projector),
      sheetUrl: SHEET.url
    };
  }

  const api = { SHEET, parseCsv, parseSheet, forDate, load, gear, gearText, summary };
  global.HAISEKI_PROGRAM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
