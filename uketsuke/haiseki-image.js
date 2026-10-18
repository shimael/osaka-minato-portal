/* ============================================================
 *  MS・朝食会 配席 ― 画像（LINE で送る用）
 *
 *  画面を写すのではなく、席図の数字から直接描く（文字がにじまず、拡大しても読める）。
 *  上に見出しと色の見方、まん中に席図、下にゲストの一覧（卓・ふりがな・紹介者・アテンド）。
 *  スマホでは共有メニュー（LINE を選べる）を開き、パソコンでは PNG を保存する。
 * ============================================================ */
(function (global) {
  "use strict";
  const FONT = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
  const S = 1.6;          // 席図の方眼 1 を何ピクセルで描くか
  const PAD = 36;         // 余白（方眼の単位）

  function font(ctx, size, weight) { ctx.font = (weight || 400) + " " + size * S + "px " + FONT; }
  /* 幅に収まるまで文字を小さくする */
  function fit(ctx, text, maxW, size, weight, min) {
    let s = size;
    font(ctx, s, weight);
    while (s > (min || 9) && ctx.measureText(text).width > maxW * S) { s -= 1; font(ctx, s, weight); }
    return s;
  }
  function text(ctx, t, x, y, size, weight, color, align, maxW, min) {
    if (!t) return;
    if (maxW) fit(ctx, t, maxW, size, weight, min); else font(ctx, size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, x * S, y * S);
  }
  function round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x * S, y * S, w * S, h * S, r * S) : ctx.rect(x * S, y * S, w * S, h * S);
  }

  function programHeight(p) {
    if (!p) return 0;
    if (p.recess) return 110;
    return 90 + (p.speakers || []).length * 108 + 64;
  }

  function drawProgram(ctx, p, x, y, w) {
    if (!p) return 0;
    const h = programHeight(p);
    round(ctx, x, y, w, h, 12);
    ctx.fillStyle = "#f4f7fb"; ctx.fill();
    ctx.lineWidth = 2 * S; ctx.strokeStyle = "#d5deea"; ctx.stroke();
    text(ctx, "今日のモーニングセミナー", x + 18, y + 22, 20, 800, "#0f2f4f", "left");
    const tags = (p.tags || []).join("　");
    text(ctx, tags, x + 18, y + 48, 18, 800, "#30475e", "left", w - 36, 14);
    const wbOn = /使う/.test(p.whiteboard), pjOn = /使う/.test(p.projector);
    text(ctx, "ホワイトボード　" + p.whiteboard, x + 18, y + 76, 22, 800, wbOn ? "#a32a1c" : "#6b7686", "left", w / 2 - 24, 14);
    text(ctx, "プロジェクター　" + p.projector, x + w / 2, y + 76, 22, 800, pjOn ? "#a32a1c" : "#6b7686", "left", w / 2 - 24, 14);
    if (p.recess) {
      text(ctx, "この日は休会です", x + 18, y + 100, 20, 700, "#a32a1c", "left");
      return h;
    }
    let yy = y + 108;
    (p.speakers || []).forEach(s => {
      text(ctx, s.label, x + 18, yy, 15, 800, "#cf4f95", "left");
      text(ctx, s.name + (s.kana ? "　" + s.kana : ""), x + 18, yy + 22, 24, 800, "#16202e", "left", w - 36, 14);
      if (s.callAs) text(ctx, "呼び出し　" + s.callAs, x + 18, yy + 44, 16, 600, "#30475e", "left", w - 36, 11);
      const title = (s.title || "").replace(/\n/g, " ");
      if (title) text(ctx, title, x + 18, yy + 64, 18, 800, "#0f2f4f", "left", w - 36, 12);
      text(ctx, "ホワイトボード " + s.whiteboard + "　／　プロジェクター " + s.projector, x + 18, yy + 86, 15, 700, "#6b7686", "left", w - 36, 10);
      yy += 108;
    });
    if (p.speech) text(ctx, "会員スピーチ　" + p.speech.name + (p.speech.kana ? "　" + p.speech.kana : ""), x + 18, yy + 8, 22, 800, "#2f6f4e", "left", w - 36, 14);
    else text(ctx, "会員スピーチ　なし", x + 18, yy + 8, 22, 800, "#6b7686", "left");
    return h;
  }

  function draw(o) {
    const lay = o.layout;
    const guests = [];
    lay.seats.forEach(s => { const p = o.seats[s.id]; if (p && p.type === "guest") guests.push({ s, p }); });
    const tableOf = s => !s.table ? s.label : ((lay.blocks || []).find(b => b.id === s.table) || {}).label || s.table + "卓";
    const prog = o.kind === "ms" ? o.program : null;
    const progH = programHeight(prog);
    const headH = 150;
    const gap = progH ? 16 : 0;
    const listRowH = 54;
    const listH = guests.length ? 70 + guests.length * listRowH + 20 : 0;
    const W = lay.width + PAD * 2;
    const H = headH + gap + progH + lay.height + listH + PAD;
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);

    /* 見出しと色の見方 */
    text(ctx, o.org || "", PAD, 34, 20, 700, "#6b7686", "left");
    text(ctx, o.title, PAD, 76, 38, 800, "#0f2f4f", "left", W - PAD * 2, 24);
    const legend = [["guest", "ゲスト"], ["attend", "アテンド"], ["chair", "会長"], ["speaker", "講話者"], ["leader", "リーダー"], ["yaku", "司会・お役"]];
    let lx = PAD;
    legend.forEach(([k, label]) => {
      const c = o.colors[k];
      round(ctx, lx, 112, 30, 22, 5);
      ctx.fillStyle = c.fill; ctx.fill();
      ctx.lineWidth = 3 * S; ctx.strokeStyle = c.line; ctx.stroke();
      text(ctx, label, lx + 38, 123, 18, 700, "#16202e", "left");
      font(ctx, 18, 700);
      lx += 38 + ctx.measureText(label).width / S + 26;
    });

    if (prog) drawProgram(ctx, prog, PAD, headH, W - PAD * 2);

    /* 席図 */
    const ox = PAD, oy = headH + gap + progH;
    ctx.save();
    ctx.translate(ox * S, oy * S);
    round(ctx, 0, 0, lay.width, 44, 8);
    ctx.fillStyle = "#0f2f4f"; ctx.fill();
    text(ctx, lay.front, lay.width / 2, 22, 22, 800, "#ffffff");
    lay.tables.forEach(t => {
      ctx.beginPath();
      ctx.arc(t.x * S, t.y * S, t.r * S, 0, Math.PI * 2);
      ctx.fillStyle = "#eef1f6"; ctx.fill();
      ctx.lineWidth = 2 * S; ctx.strokeStyle = "#c3cbd7"; ctx.stroke();
      text(ctx, t.label, t.x, t.y - (t.note ? 12 : 0), 40, 800, "#8a96a8");
      if (t.note) text(ctx, t.note, t.x, t.y + 26, 18, 700, "#8a96a8");
    });
    lay.seats.forEach(s => {
      const p = o.seats[s.id];
      const w = s.w || lay.seatW, h = s.h || lay.seatH;
      const x = s.x - w / 2, y = s.y - h / 2;
      const narrow = !!s.w && s.w < lay.seatW;
      if (!p) {
        round(ctx, x, y, w, h, 8);
        ctx.fillStyle = "#f6f8fb"; ctx.fill();
        ctx.lineWidth = 1.5 * S; ctx.strokeStyle = "#dde3eb"; ctx.stroke();
        if (s.label) text(ctx, s.label, s.x, s.y, 17, 700, "#a6afbd", "center", w - 8, 10);
        return;
      }
      const c = o.colors[p.role] || o.colors.member;
      round(ctx, x, y, w, h, 8);
      ctx.fillStyle = c.fill; ctx.fill();
      ctx.lineWidth = (p.type === "guest" ? 3.5 : 2.5) * S; ctx.strokeStyle = c.line; ctx.stroke();
      const inner = w - 12;
      if (p.type === "guest") {
        text(ctx, p.kana, s.x, y + 15, narrow ? 12 : 14, 600, "#3c6a96", "center", inner, 8);
        text(ctx, p.name + "様", s.x, s.y + 2, narrow ? 21 : 25, 800, c.ink, "center", inner, 11);
        text(ctx, p.referrer ? "紹介 " + p.referrer : "", s.x, y + h - 13, narrow ? 11 : 13, 600, "#3c6a96", "center", inner, 8);
      } else {
        const tag = p.role === "yaku" && s.label ? s.label : o.roleShort[p.role] || "";
        if (tag) text(ctx, tag, s.x, y + 16, narrow ? 12 : 15, 800, c.line, "center", inner, 8);
        text(ctx, p.name, s.x, tag ? s.y + 9 : s.y, narrow ? 20 : 24, 800, c.ink, "center", inner, 11);
      }
    });
    ctx.restore();

    /* ゲストの一覧 */
    if (guests.length) {
      const top = headH + gap + progH + lay.height + 20;
      text(ctx, "ゲスト " + guests.length + "名", PAD, top + 20, 24, 800, "#0f2f4f", "left");
      guests.forEach(({ s, p }, i) => {
        const y = top + 62 + i * listRowH;
        if (i % 2 === 0) { ctx.fillStyle = "#f3f8fd"; ctx.fillRect(PAD * S, (y - listRowH / 2) * S, (W - PAD * 2) * S, listRowH * S); }
        const att = (o.attendantsOf ? o.attendantsOf(p) : []).map(a => a.name).join("、");
        text(ctx, tableOf(s), PAD + 12, y, 20, 800, "#2f86d6", "left", 150, 12);
        text(ctx, p.name + "様", PAD + 180, y - 8, 22, 800, "#16202e", "left", 300, 12);
        text(ctx, p.kana, PAD + 180, y + 15, 14, 600, "#6b7686", "left", 300, 9);
        text(ctx, "紹介 " + (p.referrer || "—"), PAD + 500, y, 18, 600, "#16202e", "left", 300, 10);
        text(ctx, "アテンド " + (att || "—"), PAD + 820, y, 18, 600, "#16202e", "left", W - PAD * 2 - 830, 10);
      });
    }
    return cv;
  }

  async function share(o) {
    const cv = draw(o);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    const name = "配席_" + o.date + "_" + (o.kind === "ms" ? "MS" : "朝食会") + ".png";
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: o.title }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  global.HAISEKI_IMAGE = { draw, share };
})(window);
