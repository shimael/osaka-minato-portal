/* ============================================================
 *  MS・朝食会 配席
 *
 *  ゲストは受付ファイルのゲスト情報（guestBoard）から、その日の方を読む。
 *  アテンドはゲストに登録されたアテンドを候補に出し、ほかの会員は名簿のかな検索で出す。
 *  席に名前を入れるのはゲスト・アテンド・会長・講話者・司会・お役・リーダーだけで、
 *  ほかの会員は自由席（空の札のまま）。
 *
 *  置き方は2通り：
 *    ・マウスで名前をつかんで席へ運ぶ（席から席で入れ替え、左の一覧へ戻すと席から外れる）
 *    ・名前を押して選んでから空席を押す（スマホ・タブレットはこちら）
 *  保存先は受付ファイルの「配席」シート。読み込んだあとに他の人が保存していたら、上書きする前に聞く。
 *  ?edit=1 のときだけ編集できる。付いていなければ見るだけ。
 * ============================================================ */
(function () {
  "use strict";
  const K = window.UKETSUKE;
  const U = K.U;
  const C = UKETSUKE_CONFIG;
  const L = window.HAISEKI_LAYOUTS;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const EDIT = params.get("edit") === "1";
  const today = K.todayYmd();

  const ROLES = {
    guest: "ゲスト", attend: "アテンド", leader: "テーブルリーダー", chair: "会長",
    speaker: "講話者", mc: "司会", yaku: "お役", member: "会員"
  };
  const ROLE_SHORT = { attend: "アテンド", leader: "リーダー", chair: "会長", speaker: "講話者", mc: "司会", yaku: "お役", member: "" };
  /* 印刷・画像の色。画面の CSS（haiseki.html）と同じ色にそろえる */
  const COLORS = {
    guest:   { fill: "#e3f1ff", line: "#2f86d6", band: "#2f86d6", ink: "#0d3b66" },
    attend:  { fill: "#ffffff", line: "#1f4e8c", band: "#1f4e8c", ink: "#16202e" },
    leader:  { fill: "#ffffff", line: "#3c9a4c", band: "#3c9a4c", ink: "#16202e" },
    chair:   { fill: "#fff1ef", line: "#d2493a", band: "#d2493a", ink: "#16202e" },
    speaker: { fill: "#fff0f7", line: "#cf4f95", band: "#cf4f95", ink: "#16202e" },
    mc:      { fill: "#fffaf0", line: "#b9861b", band: "#b9861b", ink: "#16202e" },
    yaku:    { fill: "#fffaf0", line: "#b9861b", band: "#b9861b", ink: "#16202e" },
    member:  { fill: "#ffffff", line: "#8a96a8", band: "#8a96a8", ink: "#16202e" }
  };

  /* ---------- 日付 ---------- */
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  function nextTuesday(s) {
    const d = parse(s);
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    return ymd(d);
  }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }

  /* ---------- 状態 ---------- */
  let date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : nextTuesday(today);
  let kind = params.get("kind") === "choshoku" ? "choshoku" : "ms";
  let board = null;            // guestBoard の結果（その年）
  let boardYear = "";
  let seats = {};              // 席ID → 座る方
  let server = null;           // サーバーにある配席 { version, updatedAt, updatedBy }
  let previous = null;         // 同じ種類の前の回（ひな形）
  let dirty = false;
  let loading = true;
  let loadError = "";
  let selected = null;         // 置く席を選んでいる方
  let notice = "";             // 上に出すお知らせ
  let noticeAction = null;     // お知らせのボタン { label, fn }
  let noticeAction2 = null;
  let programs = null;         // R9 講話＆会員スピーチ（日付の配列）
  let programError = "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const flat = s => String(s || "").replace(/[\s　]+/g, "");
  /* 全角スペースのままだと札の中で間が空きすぎるので、半角1つにそろえる */
  const tidy = s => String(s || "").replace(/[\s　]+/g, " ").trim();
  const layout = () => L[kind];
  const seatDef = id => layout().seats.find(s => s.id === id) || null;
  function tableName(id) {
    const s = seatDef(id);
    if (!s) return "";
    if (!s.table) return s.label;
    const block = (layout().blocks || []).find(b => b.id === s.table);
    return block ? block.label : s.table + "卓";
  }

  /* ---------- ゲストの印（ゲスト情報ページと同じ考え方） ---------- */
  function joinStep(g) {
    const m = String(g.meibo || "").match(/（([^・）]+)(・ふりがなで一致)?）/);
    const fromMeibo = !m ? "" : m[1] === "在籍" ? "入会済み" : m[1] === "仮" ? "入会予定" : m[1] === "入会手続き中" ? "入会手続き中" : "";
    const st = String(g.status || "");
    const fromStatus = /^入会[・済]/.test(st) || st === "入会" ? "入会済み" : st === "入会手続き中" ? "入会手続き中" : st === "入会予定" ? "入会予定" : "";
    const steps = ["入会予定", "入会手続き中", "入会済み"];
    return steps.indexOf(fromMeibo) > steps.indexOf(fromStatus) ? fromMeibo : fromStatus;
  }
  function guestMarks(g) {
    const out = [];
    const j = joinStep(g);
    if (j) out.push(j);
    if (g.msBefore > 0) out.push("みなと" + (g.msBefore + 1) + "回目");
    else out.push("初めて");
    return out;
  }
  const wantsBreakfast = g => !!g.share || String(g.plan || "").includes("朝食会");

  /* ---------- 人（ゲスト・アテンド・名簿の会員） ---------- */
  /* アテンドは「佐治さん」のように敬称付き・名字だけで入っていることがある。
     敬称を外して名簿と照らし、名字だけでも1人に決まればその方にする */
  function memberByName(name) {
    const f = flat(name).replace(/(さん|様|さま|くん|氏)$/, "");
    if (!f) return null;
    const exact = U.members.find(m => flat(m.name) === f);
    if (exact) return exact;
    const pre = U.members.filter(m => flat(m.name).indexOf(f) === 0);
    return pre.length === 1 ? pre[0] : null;
  }
  function guestPerson(g) {
    return {
      type: "guest", role: "guest", key: "g:" + (g.guestId || flat(g.name)),
      name: tidy(g.name), kana: tidy(g.kana), referrer: tidy(g.referrer),
      attendants: K.splitAttendants(g.attendant).filter(Boolean),
      marks: guestMarks(g), breakfast: wantsBreakfast(g)
    };
  }
  function memberPerson(m, role, forGuest) {
    return {
      type: "member", role: role || "member", key: "m:" + (m.id || flat(m.name)),
      name: m.name, kana: m.kana || "", memberId: m.id || "", forGuest: forGuest || ""
    };
  }
  function attendPerson(name, guestKey) {
    const m = memberByName(name);
    return memberPerson(m || { name, kana: "" }, "attend", guestKey);
  }
  function otherPerson(name, role) {
    if (role === "guest") return { type: "guest", role: "guest", key: "x:" + flat(name), name, kana: "", referrer: "", attendants: [], marks: [] };
    return { type: "member", role, key: "o:" + flat(name), name, kana: "", memberId: "" };
  }

  function dayGuests() {
    if (!board) return [];
    return board.guests.filter(g => g.date === date && g.event === K.DEFAULT_EVENT)
      .map(guestPerson)
      .sort((a, b) => a.kana.localeCompare(b.kana, "ja") || a.name.localeCompare(b.name, "ja"));
  }
  /* 席に入っているゲストの情報（ふりがな・紹介者・印）は、読み込めたゲスト情報で新しくする */
  function refreshSeatedGuests() {
    const by = {};
    dayGuests().forEach(p => { by[p.key] = p; });
    Object.keys(seats).forEach(id => {
      const p = seats[id];
      if (p.type === "guest" && by[p.key]) seats[id] = by[p.key];
    });
  }
  function seatOf(key) {
    return Object.keys(seats).find(id => seats[id].key === key) || "";
  }
  /* ゲストのアテンド：受付で登録された方と、この画面で「このゲストのアテンド」として名簿から置いた方 */
  function attendantsOf(g) {
    const out = (g.attendants || []).map(n => attendPerson(n, g.key));
    Object.keys(seats).forEach(id => {
      const p = seats[id];
      if (p.role === "attend" && p.forGuest === g.key && !out.some(a => a.key === p.key)) out.push(p);
    });
    return out;
  }

  /* ---------- 置く・外す ---------- */
  function roleForSeat(p, id) {
    if (p.type === "guest") return "guest";
    const s = seatDef(id);
    if (s && ["chair", "speaker", "mc", "yaku"].includes(s.hint)) return s.hint;
    if (p.role && p.role !== "member") return p.role;
    return s && s.hint === "leader" ? "leader" : (p.role || "member");
  }
  function place(p, id) {
    const from = seatOf(p.key);
    if (from === id) return;
    const here = seats[id];
    if (from) delete seats[from];
    const next = Object.assign({}, p, { role: roleForSeat(p, id) });
    seats[id] = next;
    if (here && from) seats[from] = Object.assign({}, here, { role: roleForSeat(here, from) });
    selected = null;
    changed();
  }
  function unseat(key) {
    const id = seatOf(key);
    if (!id) return;
    delete seats[id];
    selected = null;
    changed();
  }
  function changed() {
    dirty = true;
    saveDraft();
    render();
  }

  /* アテンドの案：席に座ったゲストのアテンドがまだ席にいなければ、同じ卓のいちばん近い空席に薄く出す */
  function suggestions() {
    const out = {};
    if (!EDIT) return out;
    Object.keys(seats).forEach(id => {
      const g = seats[id];
      if (g.type !== "guest") return;
      const s = seatDef(id);
      if (!s || !s.table) return;
      attendantsOf(g).forEach(a => {
        if (seatOf(a.key) || Object.values(out).some(x => x.key === a.key)) return;
        const free = layout().seats.filter(x => x.table === s.table && !seats[x.id] && !out[x.id] && !["chair", "speaker", "mc", "yaku"].includes(x.hint))
          .sort((x, y) => Math.hypot(x.x - s.x, x.y - s.y) - Math.hypot(y.x - s.x, y.y - s.y));
        if (free.length) out[free[0].id] = a;
      });
    });
    return out;
  }

  /* 気をつけること（上の帯に出す） */
  function warnings() {
    const out = [];
    const guests = dayGuests().filter(g => kind === "ms" || g.breakfast);
    const unseated = guests.filter(g => !seatOf(g.key));
    if (unseated.length) out.push({ level: "ng", text: "まだ席がないゲスト：" + unseated.map(g => g.name + "様").join("、") });
    Object.keys(seats).forEach(id => {
      const g = seats[id];
      if (g.type !== "guest") return;
      const t = seatDef(id) ? seatDef(id).table : "";
      const atts = attendantsOf(g);
      if (!atts.length) {
        out.push({ level: "info", text: g.name + "様はアテンドが登録されていません（左の一覧の「名簿から選ぶ」で選べます）" });
        return;
      }
      atts.forEach(a => {
        const aid = seatOf(a.key);
        if (!aid) out.push({ level: "warn", text: g.name + "様のアテンド " + a.name + " さんの席がまだです" });
        else if (t && seatDef(aid) && seatDef(aid).table !== t) {
          out.push({ level: "warn", text: g.name + "様（" + tableName(id) + "）とアテンドの " + a.name + " さん（" + tableName(aid) + "）が別の卓です" });
        }
      });
    });
    return out;
  }

  /* ---------- 読み込み ---------- */
  const draftKey = () => "haiseki.draft." + date + "|" + kind;
  function saveDraft() {
    try { localStorage.setItem(draftKey(), JSON.stringify({ seats, base: server ? server.version : "", at: K.nowDateTime() })); } catch (e) { /* ignore */ }
  }
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch (e) { return null; }
  }
  function dropDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ } }

  async function api(params) {
    const q = new URLSearchParams(Object.assign({ key: K.currentKey(), _: Date.now() }, params));
    const j = await (await fetch(C.api.endpoint + "?" + q)).json();
    if (!j.ok) throw new Error(j.error || "読み込めませんでした");
    return j;
  }
  async function loadBoard(fresh) {
    const year = date.slice(0, 4);
    if (boardYear !== year) {
      boardYear = year;
      try { board = JSON.parse(localStorage.getItem("uketsuke.guestBoard." + year) || "null"); } catch (e) { board = null; }
    }
    const j = await api(Object.assign({ action: "guestBoard", year }, fresh ? { fresh: "1" } : {}));
    if (boardYear !== year) return;
    board = j;
    try { localStorage.setItem("uketsuke.guestBoard." + year, JSON.stringify(j)); } catch (e) { /* ignore */ }
  }
  async function loadSeating() {
    const want = date + "|" + kind;
    const j = await api({ action: "seating", date, kind });
    if (date + "|" + kind !== want) return;
    previous = j.previous;
    const s = j.seating;
    const newer = !server || !s || server.version !== s.version;
    if (dirty && server && s && server.version !== s.version) {
      notice = s.updatedBy + " さんが " + s.updatedAt + " に保存しています。いまの画面はまだ読み込んでいません。";
      noticeAction = { label: "読み込む（この画面の変更は消えます）", fn: () => { dirty = false; server = null; dropDraft(); reloadAll(); } };
      return;
    }
    if (dirty) return;
    if (!newer && server) return;
    server = s ? { version: s.version, updatedAt: s.updatedAt, updatedBy: s.updatedBy } : null;
    seats = (s && s.data && s.data.seats) || {};
    const d = EDIT ? readDraft() : null;
    if (d && d.seats && JSON.stringify(d.seats) !== JSON.stringify(seats)) {
      if ((d.base || "") === (server ? server.version : "")) {
        seats = d.seats;
        dirty = true;
      } else {
        notice = "この端末に、保存していない配席が残っています（" + d.at + "）。そのあとに別の方が保存しています。";
        noticeAction = { label: "この端末の配席を使う", fn: () => { seats = d.seats; dirty = true; notice = ""; noticeAction = null; render(); } };
      }
    }
  }
  async function loadProgram(fresh) {
    if (kind !== "ms" || !window.HAISEKI_PROGRAM) return;
    try {
      programs = await window.HAISEKI_PROGRAM.load(fresh);
      programError = "";
    } catch (e) {
      programError = "進行表（講話・会員スピーチ）を読めませんでした。配席はそのまま使えます。";
    }
  }
  function todayProgram() {
    if (kind !== "ms" || !window.HAISEKI_PROGRAM) return null;
    return window.HAISEKI_PROGRAM.summary(window.HAISEKI_PROGRAM.forDate(programs, date));
  }

  async function reloadAll(fresh) {
    loading = true;
    render();
    try {
      await Promise.all([loadBoard(fresh), loadSeating(), loadProgram(fresh)]);
      loadError = "";
    } catch (e) {
      loadError = "読み込みに時間がかかっています。少し待ってから「更新」を押してください。";
    }
    loading = false;
    refreshSeatedGuests();
    render();
  }

  /* ---------- 保存 ---------- */
  function who() { return ($("who") && $("who").value.trim()) || localStorage.getItem("haiseki.who") || ""; }
  async function save(force) {
    if (!who()) {
      $("who").focus();
      showNotice("保存する方のお名前を入れてください（だれが保存したか、ほかの方に見えます）。");
      return;
    }
    localStorage.setItem("haiseki.who", who());
    const btn = $("btn-save");
    btn.disabled = true;
    btn.textContent = "保存しています…";
    try {
      const res = await fetch(C.api.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          op: "seatingSave", key: K.currentKey(), updatedBy: who(), date, kind,
          baseVersion: server ? server.version : "", force: !!force, data: { seats }
        })
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "保存できませんでした");
      if (j.conflict) {
        const s = j.seating;
        notice = s.updatedBy + " さんが " + s.updatedAt + " に保存しています（この画面を開いたあとです）。";
        noticeAction = { label: "自分の配席で上書きする", fn: () => { notice = ""; noticeAction = null; save(true); } };
        noticeAction2 = { label: "相手の配席を読み込む（自分の変更は消えます）", fn: () => { dirty = false; server = null; dropDraft(); notice = ""; noticeAction = null; noticeAction2 = null; reloadAll(); } };
        render();
        return;
      }
      const s = j.seating;
      server = { version: s.version, updatedAt: s.updatedAt, updatedBy: s.updatedBy };
      dirty = false;
      dropDraft();
      notice = "";
      noticeAction = null;
      noticeAction2 = null;
      render();
    } catch (e) {
      showNotice("保存できませんでした。電波のよいところで、もう一度「保存」を押してください。変更はこの端末に残っています。");
    } finally {
      btn.disabled = false;
      renderToolbar();
    }
  }
  function showNotice(t) { notice = t; noticeAction = null; noticeAction2 = null; render(); }

  /* ---------- 描画 ---------- */
  function seatHtml(s, p, ghost) {
    const lay = layout();
    const w = s.w || lay.seatW, h = s.h || lay.seatH;
    const style = `left:${(s.x - w / 2) / lay.width * 100}%;top:${(s.y - h / 2) / lay.height * 100}%;width:${w / lay.width * 100}%;height:${h / lay.height * 100}%`;
    const narrow = s.w && s.w < lay.seatW ? " narrow" : "";
    if (!p) {
      const target = selected && EDIT ? " target" : "";
      if (ghost) {
        return `<div class="seat ghost${narrow}" data-seat="${s.id}" data-ghost="${esc(ghost.key)}" style="${style}" title="押すと置きます">
          <span class="s-top">アテンドの案</span><span class="s-name">${esc(ghost.name)}</span><span class="s-sub">押すと置く</span></div>`;
      }
      const hint = s.label || (s.hint === "leader" ? "リーダー" : "");
      const hintHtml = ({ "会員スピーチ": "会員<br>スピーチ", "誓いの言葉": "誓いの<br>言葉", "会長・進行": "会長・<br>進行" }[hint]) || esc(hint);
      return `<div class="seat empty${narrow}${target}${s.hint ? " h-" + s.hint : ""}" data-seat="${s.id}" style="${style}">${hint ? `<span class="s-hint">${hintHtml}</span>` : ""}</div>`;
    }
    const len = flat(p.name).length;
    const size = len >= 8 ? " xlong" : len >= 6 ? " long" : "";
    const sel = selected && selected.key === p.key ? " picked" : "";
    if (p.type === "guest") {
      return `<div class="seat r-guest${narrow}${size}${sel}" data-seat="${s.id}" data-drag="${esc(p.key)}" style="${style}">
        <span class="s-top">${esc(p.kana)}</span>
        <span class="s-name">${esc(p.name)}<small>様</small></span>
        <span class="s-sub">${p.referrer ? "紹介 " + esc(p.referrer) : "ゲスト"}</span></div>`;
    }
    const tag = p.role === "yaku" && s.label ? s.label : ROLE_SHORT[p.role] || "";
    return `<div class="seat r-${p.role}${narrow}${size}${sel}" data-seat="${s.id}" data-drag="${esc(p.key)}" style="${style}">
      ${tag ? `<span class="s-top">${esc(tag)}</span>` : ""}<span class="s-name">${esc(p.name)}</span></div>`;
  }

  function renderBoard() {
    const lay = layout();
    const sug = suggestions();
    const counts = {};
    Object.keys(seats).forEach(id => {
      const s = seatDef(id);
      if (!s || !s.table) return;
      const c = counts[s.table] = counts[s.table] || { g: 0, a: 0 };
      if (seats[id].type === "guest") c.g++; else if (seats[id].role === "attend") c.a++;
    });
    const tables = lay.tables.map(t => {
      const c = counts[t.id] || { g: 0, a: 0 };
      const r = t.r;
      return `<div class="table" style="left:${(t.x - r) / lay.width * 100}%;top:${(t.y - r) / lay.height * 100}%;width:${2 * r / lay.width * 100}%;height:${2 * r / lay.height * 100}%">
        <b>${esc(t.label)}</b>${t.note ? `<em>${esc(t.note)}</em>` : ""}${c.g || c.a ? `<span>${c.g ? "ゲスト" + c.g : ""}${c.g && c.a ? "・" : ""}${c.a ? "アテンド" + c.a : ""}</span>` : ""}</div>`;
    }).join("");
    const html = lay.seats.map(s => seatHtml(s, seats[s.id], sug[s.id])).join("");
    $("board").innerHTML = `<div class="front">${esc(lay.front)}</div>${tables}${html}`;
    $("board").classList.toggle("picking", !!selected);
    fitBoard();
    fitNames();
  }
  /* 席図を画面の残り高さに合わせて縮め、会場全体が見えるようにする（幅いっぱいに広げない） */
  function fitBoard() {
    const el = $("board");
    if (!el) return;
    const lay = layout();
    el.style.aspectRatio = lay.width + " / " + lay.height;
    if (window.innerWidth <= 980) {
      el.style.width = "100%";
      return;
    }
    const box = el.closest(".board-box");
    const maxW = Math.max(360, (box ? box.clientWidth : el.parentElement.clientWidth) || 720);
    const top = (box || el).getBoundingClientRect().top;
    const maxH = Math.max(440, window.innerHeight - top - 28);
    el.style.width = Math.min(maxW, maxH * (lay.width / lay.height)) + "px";
  }
  /* 名前が札からはみ出すときは、収まるまで文字を小さくする（「…」で切らない） */
  function fitNames() {
    document.querySelectorAll("#board .seat .s-name, #board .seat .s-top, #board .seat .s-sub").forEach(el => {
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      if (el.scrollWidth <= el.clientWidth) return;
      while (el.scrollWidth > el.clientWidth && size > base * 0.55) {
        size *= 0.92;
        el.style.fontSize = size + "px";
      }
      el.style.fontSize = size * 0.96 + "px";
    });
  }
  window.addEventListener("resize", () => { fitBoard(); fitNames(); });

  function personChip(p, extra) {
    const at = seatOf(p.key);
    const sel = selected && selected.key === p.key ? " picked" : "";
    return `<button type="button" class="chip c-${p.role}${at ? " seated" : ""}${sel}" data-drag="${esc(p.key)}" data-pick="${esc(p.key)}">
      ${extra || ""}<span class="c-name">${esc(p.name)}</span>${at ? `<span class="c-at">${esc(tableName(at))}</span>` : `<span class="c-at none">席なし</span>`}</button>`;
  }

  function renderPool() {
    if (!EDIT) return;
    const guests = dayGuests();
    const want = kind === "ms" ? guests : guests.filter(g => g.breakfast);
    const rest = kind === "ms" ? [] : guests.filter(g => !g.breakfast);
    const card = g => {
      const at = seatOf(g.key);
      const sel = selected && selected.key === g.key ? " picked" : "";
      const atts = attendantsOf(g);
      const att = atts.length
        ? atts.map(a => personChip(a, `<span class="c-role">アテンド</span>`)).join("")
        : `<button type="button" class="chip c-missing" data-find-for="${esc(g.key)}"><span class="c-role">アテンド</span><span class="c-name">未登録・名簿から選ぶ</span></button>`;
      return `<div class="g-item${at ? " seated" : ""}">
        <button type="button" class="g-main${sel}" data-drag="${esc(g.key)}" data-pick="${esc(g.key)}">
          <span class="g-kana">${esc(g.kana || "ふりがな未登録")}</span>
          <span class="g-name">${esc(g.name)}<small>様</small></span>
          <span class="g-ref">紹介者　${esc(g.referrer || "—")}</span>
          <span class="g-marks">${g.marks.map(m => `<i>${esc(m)}</i>`).join("")}</span>
          <span class="g-at${at ? "" : " none"}">${at ? esc(tableName(at)) : "席なし"}</span>
        </button>
        <div class="g-att">${att}</div>
      </div>`;
    };
    const others = Object.keys(seats).map(id => seats[id])
      .filter(p => p.type !== "guest" && p.role !== "attend");
    let html = `<div class="pool-head"><h2>${kind === "ms" ? "この日のゲスト" : "朝食会に参加予定のゲスト"}</h2><span>${want.length}名</span></div>`;
    if (loading && !board) html += `<p class="pool-empty">読み込んでいます…</p>`;
    else if (!want.length) html += `<p class="pool-empty">${kind === "ms" ? "この日のゲストは、まだ登録されていません。<br>受付・紹介者フォームで入れると、ここに出ます。" : "朝食会に参加予定のゲストは、まだいません。"}</p>`;
    html += want.map(card).join("");
    if (rest.length) {
      html += `<details class="pool-more"><summary>ほかのゲスト（朝食会の予定は未確認）${rest.length}名</summary>${rest.map(card).join("")}</details>`;
    }
    if (others.length) {
      html += `<div class="pool-head sm"><h2>席にいる役の方</h2></div><div class="g-att">${others.map(p => personChip(p, `<span class="c-role">${esc(ROLE_SHORT[p.role] || "会員")}</span>`)).join("")}</div>`;
    }
    $("pool").innerHTML = html;
  }

  function renderWarnings() {
    const box = $("warn");
    const list = loading && !board ? [] : warnings();
    box.hidden = !list.length;
    box.innerHTML = list.map(w => `<li class="${w.level}">${esc(w.text)}</li>`).join("");
  }

  function renderList() {
    const lay = layout();
    const groups = {};
    lay.seats.forEach(s => {
      const p = seats[s.id];
      if (!p) return;
      const g = s.table || "前方";
      (groups[g] = groups[g] || []).push({ s, p });
    });
    const order = ["前方"].concat(lay.tables.map(t => t.id), (lay.blocks || []).map(b => b.id));
    const html = order.filter(k => groups[k]).map(k => {
      const title = k === "前方" ? "前方の席" : ((lay.blocks || []).find(b => b.id === k) || {}).label || k + "卓" + ((lay.tables.find(t => t.id === k) || {}).note ? "（" + lay.tables.find(t => t.id === k).note + "）" : "");
      const rows = groups[k].map(({ s, p }) => {
        if (p.type === "guest") {
          return `<li class="r-guest"><span class="l-role">ゲスト</span><span class="l-name">${esc(p.name)}様<small>${esc(p.kana)}</small></span><span class="l-sub">紹介 ${esc(p.referrer || "—")}${attendantsOf(p).length ? "／アテンド " + esc(attendantsOf(p).map(a => a.name).join("、")) : ""}</span></li>`;
        }
        const tag = p.role === "yaku" && s.label ? s.label : ROLES[p.role] || "";
        return `<li class="r-${p.role}"><span class="l-role">${esc(tag)}</span><span class="l-name">${esc(p.name)}</span></li>`;
      }).join("");
      return `<section><h3>${esc(title)}</h3><ul>${rows}</ul></section>`;
    }).join("");
    $("list").innerHTML = html || `<p class="pool-empty">${loading ? "読み込んでいます…" : "まだ席に名前が入っていません。"}</p>`;
  }

  function renderToolbar() {
    $("date-label").textContent = K.jaDate(date);
    document.querySelectorAll("[data-kind]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    const st = $("status");
    st.className = "status" + (dirty ? " dirty" : "");
    st.textContent = loading ? "読み込んでいます…"
      : dirty ? "保存していない変更があります"
      : server ? "保存済み　" + server.updatedBy + "（" + server.updatedAt.slice(5).replace("-", "/") + "）"
      : EDIT ? "まだ保存されていません" : "";
    if (EDIT) {
      $("btn-save").textContent = "保存";
      $("btn-save").classList.toggle("ready", dirty);
      const canCopy = previous && previous.data && previous.data.seats && !Object.keys(seats).some(id => seats[id].type !== "guest" && ["chair", "leader", "mc"].includes(seats[id].role));
      $("btn-template").hidden = !canCopy;
      if (canCopy) $("btn-template").textContent = "前回（" + K.jaDateShort(previous.date) + "）の会長・司会・リーダーを写す";
    }
  }

  function renderNotice() {
    const box = $("notice");
    const text = notice || loadError;
    box.hidden = !text;
    box.innerHTML = esc(text) +
      (noticeAction ? ` <button type="button" class="btn-sm" id="notice-act">${esc(noticeAction.label)}</button>` : "") +
      (noticeAction2 ? ` <button type="button" class="btn-sm ghost" id="notice-act2">${esc(noticeAction2.label)}</button>` : "");
    if (noticeAction) $("notice-act").onclick = noticeAction.fn;
    if (noticeAction2) $("notice-act2").onclick = noticeAction2.fn;
  }

  function tagClass(t) {
    if (/休会|なし/.test(t)) return "hot";
    if (/あり/.test(t)) return "ok";
    if (/ダブル|トリプル|講話/.test(t) && !/自単会/.test(t)) return "pink";
    if (/バッジ|辞令|夢|抱負/.test(t)) return "gold";
    return "";
  }
  function renderProgram() {
    const box = $("program");
    if (!box) return;
    if (kind !== "ms") { box.hidden = true; box.innerHTML = ""; return; }
    const p = todayProgram();
    if (programError && !p) {
      box.hidden = false;
      box.innerHTML = `<p class="p-empty">${esc(programError)}</p>`;
      return;
    }
    if (!p) {
      box.hidden = false;
      box.innerHTML = `<div class="program-head"><h2>今日のモーニングセミナー</h2></div><p class="p-empty">この日の進行は、まだ進行表に入っていません。</p>`;
      return;
    }
    const tags = (p.tags || []).map(t => `<span class="ptag ${tagClass(t)}">${esc(t)}</span>`).join("");
    const gearOn = t => /使う/.test(t);
    const people = p.speakers.map(s => `<article class="p-card">
      <div class="k">${esc(s.label)}</div>
      <div class="nm">${esc(s.name)}${s.kana ? `<span class="kn">${esc(s.kana)}</span>` : ""}</div>
      ${s.callAs ? `<div class="call">呼び出し　${esc(s.callAs)}</div>` : ""}
      ${s.title ? `<div class="ttl">${esc(s.title)}</div>` : ""}
    </article>`).join("");
    const speech = p.speech
      ? `<article class="p-card speech"><div class="k">会員スピーチ</div><div class="nm">${esc(p.speech.name)}${p.speech.kana ? `<span class="kn">${esc(p.speech.kana)}</span>` : ""}</div>${p.speech.role ? `<div class="call">${esc(p.speech.role)}</div>` : ""}</article>`
      : `<article class="p-card speech"><div class="k">会員スピーチ</div><div class="nm">なし</div></article>`;
    box.hidden = false;
    box.innerHTML = `<div class="program-head">
      <h2>今日のモーニングセミナー</h2>
      <div class="ptags">${tags}</div>
      <a href="${esc(p.sheetUrl)}" target="_blank" rel="noopener">進行表を開く</a>
    </div>
    <div class="p-gear">
      <span class="${gearOn(p.whiteboard) ? "on" : "off"}"><b>ホワイトボード</b>${esc(p.whiteboard)}</span>
      <span class="${gearOn(p.projector) ? "on" : "off"}"><b>プロジェクター</b>${esc(p.projector)}</span>
    </div>
    ${p.recess ? `<p class="p-empty">この日は休会です。</p>` : `<div class="p-people">${people}${speech}</div>`}`;
  }

  function renderPicking() {
    const bar = $("picking");
    if (!EDIT) return;
    bar.hidden = !selected;
    if (selected) $("picking-text").textContent = selected.name + (selected.type === "guest" ? "様" : " さん") + "を置く席を押してください";
  }

  function render() {
    renderToolbar();
    renderNotice();
    renderProgram();
    renderPicking();
    renderWarnings();
    renderPool();
    renderBoard();
    renderList();
  }

  /* ---------- 人を探す（キーから） ---------- */
  function findPerson(key) {
    const id = seatOf(key);
    if (id) return seats[id];
    for (const g of dayGuests()) {
      if (g.key === key) return g;
      for (const a of attendantsOf(g)) if (a.key === key) return a;
    }
    if (selected && selected.key === key) return selected;
    const sug = suggestions();
    for (const sid in sug) if (sug[sid].key === key) return sug[sid];
    return null;
  }

  /* ---------- 選んで置く ---------- */
  function pick(key) {
    const p = findPerson(key);
    if (!p) return;
    selected = selected && selected.key === key ? null : p;
    render();
  }
  function onSeat(id, ghostKey) {
    if (!EDIT) return;
    if (ghostKey && !selected) {
      const p = findPerson(ghostKey);
      if (p) place(p, id);
      return;
    }
    if (selected) { place(selected, id); return; }
    if (seats[id]) openSeatDialog(id);
    else openPicker(id);
  }

  /* ---------- 空いている席を押したとき：座る方を選ぶ ---------- */
  let pickerSeat = "", pickerRole = "attend", pickerFor = "";
  function openPicker(id, forGuest) {
    pickerSeat = id || "";
    pickerFor = forGuest || "";
    const s = id ? seatDef(id) : null;
    pickerRole = s && ["chair", "speaker", "mc", "yaku", "leader"].includes(s.hint) ? s.hint : "attend";
    $("picker-title").textContent = id ? tableName(id) + (s && s.table ? "の席" : "") + "に座る方" : "アテンドを名簿から選ぶ";
    const guests = dayGuests();
    const cands = [];
    guests.forEach(g => {
      if (!seatOf(g.key)) cands.push(g);
      g.attendants.forEach(n => { const a = attendPerson(n, g.key); if (!seatOf(a.key) && !cands.some(c => c.key === a.key)) cands.push(a); });
    });
    $("picker-cands-box").hidden = !id || !cands.length;
    $("picker-cands").innerHTML = cands.map(p => `<button type="button" class="chip c-${p.role}" data-cand="${esc(p.key)}">
      <span class="c-role">${p.type === "guest" ? "ゲスト" : "アテンド"}</span><span class="c-name">${esc(p.name)}${p.type === "guest" ? "様" : ""}</span>${p.kana ? `<span class="c-at">${esc(p.kana)}</span>` : ""}</button>`).join("");
    $("picker-q").value = "";
    $("picker-hits").innerHTML = "";
    $("picker-free").value = "";
    $("picker-roles-box").hidden = !!forGuest;
    renderPickerRoles();
    $("picker").showModal();
    if (!id || !cands.length) setTimeout(() => $("picker-q").focus(), 50);
  }
  function renderPickerRoles() {
    const keys = ["attend", "leader", "chair", "speaker", "mc", "yaku", "member", "guest"];
    $("picker-roles").innerHTML = keys.map(k => `<button type="button" class="role-btn r-${k}" data-role="${k}" aria-pressed="${k === pickerRole}">${esc(ROLES[k])}</button>`).join("");
  }
  function pickerPlace(p) {
    $("picker").close();
    if (pickerSeat) place(p, pickerSeat);
    else { selected = p; render(); }
  }
  $("picker-roles").addEventListener("click", e => {
    const b = e.target.closest("[data-role]");
    if (!b) return;
    pickerRole = b.dataset.role;
    renderPickerRoles();
  });
  $("picker-cands").addEventListener("click", e => {
    const b = e.target.closest("[data-cand]");
    if (!b) return;
    const p = findPerson(b.dataset.cand);
    if (p) pickerPlace(p);
  });
  $("picker-q").addEventListener("input", () => {
    const hits = K.searchMembers($("picker-q").value);
    $("picker-hits").innerHTML = hits.map(m => `<button type="button" class="hit" data-mid="${esc(m.id || m.name)}">
      <b>${esc(m.name)}</b><span>${esc(m.kana)}</span>${seatOf("m:" + (m.id || flat(m.name))) ? `<em>${esc(tableName(seatOf("m:" + (m.id || flat(m.name)))))}にいます</em>` : ""}</button>`).join("")
      || ($("picker-q").value.trim() ? `<p class="pool-empty">名簿に見つかりません。下の「名簿にない方」から入れてください。</p>` : "");
  });
  $("picker-hits").addEventListener("click", e => {
    const b = e.target.closest("[data-mid]");
    if (!b) return;
    const m = U.members.find(x => (x.id || x.name) === b.dataset.mid);
    if (!m) return;
    const role = pickerFor ? "attend" : pickerRole === "guest" ? "member" : pickerRole;
    pickerPlace(memberPerson(m, role, pickerFor));
  });
  $("picker-free-add").addEventListener("click", () => {
    const name = $("picker-free").value.trim();
    if (!name) { $("picker-free").focus(); return; }
    pickerPlace(otherPerson(name, pickerFor ? "attend" : pickerRole));
  });
  $("picker-close").addEventListener("click", () => $("picker").close());

  /* ---------- 名前の入った席を押したとき ---------- */
  let dialogSeat = "";
  function openSeatDialog(id) {
    dialogSeat = id;
    const p = seats[id];
    const s = seatDef(id);
    $("seat-where").textContent = tableName(id) + (s && s.label && s.table ? "（" + s.label + "）" : "");
    $("seat-name").innerHTML = p.type === "guest"
      ? `<small>${esc(p.kana)}</small>${esc(p.name)}様`
      : `${p.kana ? `<small>${esc(p.kana)}</small>` : ""}${esc(p.name)}`;
    $("seat-info").innerHTML = p.type === "guest"
      ? `<dt>紹介者</dt><dd>${esc(p.referrer || "—")}</dd><dt>アテンド</dt><dd>${esc(attendantsOf(p).map(a => a.name).join("、") || "未登録")}</dd>${p.marks && p.marks.length ? `<dt>印</dt><dd>${esc(p.marks.join("・"))}</dd>` : ""}`
      : "";
    $("seat-roles-box").hidden = p.type === "guest";
    if (p.type !== "guest") {
      $("seat-roles").innerHTML = ["attend", "leader", "chair", "speaker", "mc", "yaku", "member"].map(k =>
        `<button type="button" class="role-btn r-${k}" data-role="${k}" aria-pressed="${k === p.role}">${esc(ROLES[k])}</button>`).join("");
    }
    $("seat-dialog").showModal();
  }
  $("seat-roles").addEventListener("click", e => {
    const b = e.target.closest("[data-role]");
    if (!b || !seats[dialogSeat]) return;
    seats[dialogSeat] = Object.assign({}, seats[dialogSeat], { role: b.dataset.role });
    $("seat-dialog").close();
    changed();
  });
  $("seat-move").addEventListener("click", () => {
    $("seat-dialog").close();
    selected = seats[dialogSeat];
    render();
  });
  $("seat-remove").addEventListener("click", () => {
    $("seat-dialog").close();
    unseat(seats[dialogSeat].key);
  });
  $("seat-close").addEventListener("click", () => $("seat-dialog").close());

  /* ---------- マウスでつかんで運ぶ（指で押したときは「選んで置く」になる） ---------- */
  let drag = null;
  document.addEventListener("pointerdown", e => {
    if (!EDIT || e.pointerType === "touch" || e.button !== 0) return;
    const el = e.target.closest("[data-drag]");
    if (!el) return;
    drag = { key: el.dataset.drag, x: e.clientX, y: e.clientY, el, moving: false, ghost: null };
  });
  document.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const p = findPerson(drag.key);
      if (!p) { drag = null; return; }
      drag.moving = true;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "drag-ghost r-" + p.role;
      drag.ghost.textContent = p.name + (p.type === "guest" ? "様" : "");
      document.body.appendChild(drag.ghost);
      document.body.classList.add("dragging");
    }
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
    document.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const tgt = over && (over.closest("[data-seat]") || over.closest("#pool"));
    if (tgt) tgt.classList.add("drop-on");
  });
  document.addEventListener("pointerup", e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moving) return;
    d.ghost.remove();
    document.body.classList.remove("dragging");
    document.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const seat = over && over.closest("[data-seat]");
    const p = findPerson(d.key);
    if (!p) return;
    if (seat) place(p, seat.dataset.seat);
    else if (over && over.closest("#pool")) unseat(p.key);
  });
  let suppressClick = false;

  /* ---------- クリック ---------- */
  document.addEventListener("click", e => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const seat = e.target.closest("#board [data-seat]");
    if (seat) { onSeat(seat.dataset.seat, seat.dataset.ghost || ""); return; }
    const pk = e.target.closest("#pool [data-pick]");
    if (pk) { pick(pk.dataset.pick); return; }
    const ff = e.target.closest("#pool [data-find-for]");
    if (ff) { openPicker("", ff.dataset.findFor); return; }
  }, true);

  /* ---------- 日付・種類・ボタン ---------- */
  function setUrl() {
    const q = new URLSearchParams({ date, kind });
    if (EDIT) q.set("edit", "1");
    try { history.replaceState(null, "", location.pathname + "?" + q); } catch (e) { /* ignore */ }
  }
  function go(nextDate, nextKind) {
    if (dirty && !confirm("保存していない変更があります。この端末には残しておくので、あとで戻れば続きから直せます。移りますか？")) return;
    date = nextDate;
    kind = nextKind;
    seats = {};
    server = null;
    previous = null;
    dirty = false;
    selected = null;
    notice = "";
    noticeAction = null;
    noticeAction2 = null;
    setUrl();
    reloadAll();
  }
  $("prev").addEventListener("click", () => go(addDays(date, -7), kind));
  $("next").addEventListener("click", () => go(addDays(date, 7), kind));
  $("btn-today").addEventListener("click", () => go(nextTuesday(today), kind));
  document.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => { if (b.dataset.kind !== kind) go(date, b.dataset.kind); }));
  $("btn-reload").addEventListener("click", () => {
    if (dirty) { notice = ""; noticeAction = null; }
    reloadAll(true);
  });
  $("btn-image").addEventListener("click", () => window.HAISEKI_IMAGE.share({
    layout: layout(), seats, date, kind, colors: COLORS, roles: ROLES, roleShort: ROLE_SHORT, attendantsOf,
    title: K.jaDate(date) + "　" + layout().title + "　配席", org: C.org,
    program: todayProgram()
  }));
  $("btn-link").addEventListener("click", async () => {
    const url = location.origin + location.pathname + "?" + new URLSearchParams({ date, kind });
    try { await navigator.clipboard.writeText(url); showNotice("見る用のリンクをコピーしました：" + url); }
    catch (e) { prompt("見る用のリンク", url); }
  });
  if (EDIT) {
    $("who").value = localStorage.getItem("haiseki.who") || "";
    $("who").addEventListener("change", () => localStorage.setItem("haiseki.who", who()));
    $("btn-save").addEventListener("click", () => save(false));
    $("picking-cancel").addEventListener("click", () => { selected = null; render(); });
    $("btn-template").addEventListener("click", () => {
      if (!previous) return;
      let n = 0;
      Object.keys(previous.data.seats).forEach(id => {
        const p = previous.data.seats[id];
        if (p.type === "guest" || !["chair", "leader", "mc"].includes(p.role) || seats[id] || !seatDef(id) || seatOf(p.key)) return;
        seats[id] = p;
        n++;
      });
      showNotice(n ? "前回の会長・司会・リーダー " + n + "名を同じ席に写しました。違う方は席を押して直してください。" : "写せる方がいませんでした。");
      if (n) changed();
    });
    $("btn-clear").addEventListener("click", () => {
      if (!Object.keys(seats).length || !confirm("この回の席をすべて空けます。保存するまではスプレッドシートには反映されません。よろしいですか？")) return;
      seats = {};
      changed();
    });
    window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && selected) { selected = null; render(); } });
  }

  K.loadMembers();
  setUrl();
  render();
  K.startLivePolling({ load: () => reloadAll(false).then(() => { if (loadError) throw new Error(loadError); }) });
})();
