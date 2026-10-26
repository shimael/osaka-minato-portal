/* ============================================================
 *  MS・朝食会 配席 ― 画像（LINE で送る用）
 *
 *  画面を写すのではなく、席図の数字から直接描く（文字がにじまず、拡大しても読める）。
 *  上に日付と、右上にどちらの配席かの札。MS は進行（講話・会員スピーチ）を横並びのカードで。まん中に席図、いちばん下に色の見方。
 *  席図は、だれも座っていない下の段を切って短くする（layout.cuts）。
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

  /* 札の中の文字。画面（haiseki.html の .seat）と同じ大きさ・同じ折り返し方にする。
     段は { t, size, weight, color, lh, gap }。1行に入らなければ姓と名（ふりがなも）のところで2行に分け、
     それでも入らなければ小さくする */
  function seatText(ctx, rows, cx, cy, w, h, short) {
    /* 高さ半分の札（席番号なし）は、上の余白を詰める */
    const maxW = w - 18, room = short ? h - 8 : h - 25;   // 左右は枠線と余白のぶん（画面と同じ折り返し方になるように）、上は席番号のぶん 21、下は 4 あける
    const split = t => { const s = String(t || "").trim(); const at = s.indexOf(" "); return at < 0 ? [s] : [s.slice(0, at), s.slice(at + 1)]; };
    const width = (t, size, weight) => { font(ctx, size, weight); return ctx.measureText(t).width / S; };
    rows = rows.filter(r => r.t).map(r => Object.assign({ lh: 1.15, gap: 0 }, r, { lines: [r.t], base: r.size }));
    const height = () => rows.reduce((n, r) => n + r.lines.length * r.size * r.lh + r.gap * 2, 0);
    const tooWide = r => r.lines.some(l => width(l, r.size, r.weight) > maxW);
    const name = rows.find(r => r.name), kana = rows.find(r => r.kana);
    if (name && tooWide(name) && split(name.t).length > 1) name.lines = split(name.t);
    if (kana && tooWide(kana) && split(kana.t).length > 1) {
      kana.lines = split(kana.t);
      while (name && height() > room && name.size > name.base * 0.86) name.size *= 0.94;
      if (height() > room) { kana.lines = [kana.t]; if (name) name.size = name.base; }
    }
    rows.forEach(r => { while (tooWide(r) && r.size > r.base * 0.6) r.size *= 0.94; });
    if (name) while (height() > room && name.size > name.base * 0.6) name.size *= 0.94;
    if (kana) while (height() > room && kana.size > kana.base * 0.6) kana.size *= 0.94;
    let y = cy + (short ? 0 : 8.5) - height() / 2;
    rows.forEach(r => {
      y += r.gap;
      r.lines.forEach(l => {
        const mid = y + r.size * r.lh / 2;
        if (r.suffix && l === r.lines[r.lines.length - 1]) {
          /* 「様」は少し小さく、名前のすぐ後ろに */
          const small = r.size * 0.65;
          const lw = width(l, r.size, r.weight), sw = width(r.suffix, small, r.weight);
          const x0 = cx - (lw + sw) / 2;
          text(ctx, l, x0, mid, r.size, r.weight, r.color, "left");
          text(ctx, r.suffix, x0 + lw + 1, mid + r.size * 0.12, small, r.weight, r.color, "left");
        } else {
          text(ctx, l, cx, mid, r.size, r.weight, r.color, "center");
        }
        y += r.size * r.lh;
      });
      y += r.gap;
    });
  }

  /* ---------- MS の進行：講話と会員スピーチを横に並べたカードにする ----------
   *  いちばん見られるところなので文字は大きく。講話のカードを広く（会員スピーチの2倍）とり、
   *  文字の大きさは講話も会員スピーチも同じにする（どちらかが小さく見えないように） */
  const CARD_PAD = 20, CARD_GAP = 14;
  const P = { label: 20, name: 34, kana: 22, line: 22, title: 26 };
  function wrapLines(ctx, t, maxW, size, weight, maxLines) {
    /* 長いタイトルは2行まで */
    font(ctx, size, weight);
    const lines = [];
    let cur = "";
    Array.from(String(t || "")).forEach(ch => {
      if (ctx.measureText(cur + ch).width / S > maxW && cur && lines.length < maxLines - 1) { lines.push(cur); cur = ch; }
      else cur += ch;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  const width = (ctx, t, size, weight) => { font(ctx, size, weight); return ctx.measureText(t).width / S; };
  function cardRows(ctx, card, w) {
    const inner = w - CARD_PAD * 2;
    const rows = [{ t: card.label, size: P.label, weight: 800, color: card.accent, h: 30 }];
    /* お名前とふりがなは1行に入ればならべ、入らなければふりがなを次の行に */
    const together = card.kana && width(ctx, card.name, P.name, 800) + 14 + width(ctx, card.kana, P.kana, 700) <= inner;
    rows.push({ name: card.name, kana: together ? card.kana : "", h: 46 });
    if (card.kana && !together) rows.push({ t: card.kana, size: P.kana, weight: 700, color: card.accent, h: 32 });
    if (card.callAs) rows.push({ t: "呼び出し　" + card.callAs, size: P.line, weight: 600, color: "#30475e", h: 32 });
    if (card.title) wrapLines(ctx, card.title, inner, P.title, 800, 2).forEach(l => rows.push({ t: l, size: P.title, weight: 800, color: "#0f2f4f", h: 36 }));
    if (card.gear) {
      /* ホワイトボード・プロジェクターは1行に入らなければ2行に分ける */
      const gw = card.gear.reduce((n, [label, val]) => n + width(ctx, label, P.line, 700) + 8 + width(ctx, val, P.line, 800) + 12, 0)
        + width(ctx, "／", P.line, 700) + 6;
      if (gw <= inner) rows.push({ gear: card.gear, h: 36 });
      else card.gear.forEach(g => rows.push({ gear: [g], h: 34 }));
    }
    if (card.note) rows.push({ t: card.note, size: P.line, weight: 700, color: "#6b7686", h: 32 });
    return rows;
  }
  function programCards(p) {
    const cards = (p.speakers || []).map(s => ({
      label: s.label, accent: "#cf4f95", fill: "#fffafd", line: "#ead6e4", weight: 2, name: s.name, kana: s.kana,
      callAs: s.callAs, title: (s.title || "").replace(/\n/g, " "),
      gear: [["ホワイトボード", s.whiteboard], ["プロジェクター", s.projector]]
    }));
    const speech = { label: "会員スピーチ", accent: "#2f6f4e", fill: "#f6fbf7", line: "#d6e4d8", weight: 1 };
    cards.push(Object.assign(speech, p.speech ? { name: p.speech.name, kana: p.speech.kana, note: p.speech.role || "" } : { name: "なし", kana: "" }));
    return cards;
  }
  function programLayout(ctx, p, w) {
    if (!p) return null;
    const head = 62;
    if (p.recess) return { h: head + 46, cards: [] };
    const cards = programCards(p);
    const unit = (w - CARD_PAD * 2 - CARD_GAP * (cards.length - 1)) / cards.reduce((n, c) => n + c.weight, 0);
    cards.forEach(c => { c.w = unit * c.weight; });
    const ch = Math.max.apply(null, cards.map(c => cardRows(ctx, c, c.w).reduce((n, r) => n + r.h, 0))) + CARD_PAD * 2 - 6;
    return { h: head + ch + CARD_PAD, cards, ch };
  }
  function drawProgram(ctx, p, L, x, y, w) {
    round(ctx, x, y, w, L.h, 12);
    ctx.fillStyle = "#f4f7fb"; ctx.fill();
    ctx.lineWidth = 2 * S; ctx.strokeStyle = "#d5deea"; ctx.stroke();
    const heading = "今日のモーニングセミナー";
    text(ctx, heading, x + CARD_PAD, y + 33, 24, 800, "#0f2f4f", "left");
    /* 「会員スピーチあり」などは見出しの横に小さな札で */
    let tx = x + CARD_PAD + width(ctx, heading, 24, 800) + 16;
    (p.tags || []).forEach(t => {
      const tw = width(ctx, t, 18, 800) + 24;
      round(ctx, tx, y + 18, tw, 30, 15);
      ctx.fillStyle = "#e4eaf2"; ctx.fill();
      text(ctx, t, tx + 12, y + 33, 18, 800, "#30475e", "left");
      tx += tw + 10;
    });
    if (p.recess) {
      text(ctx, "この日は休会です", x + CARD_PAD, y + 82, 24, 800, "#a32a1c", "left");
      return;
    }
    let cx = x + CARD_PAD;
    L.cards.forEach(card => {
      const cy = y + 62;
      round(ctx, cx, cy, card.w, L.ch, 10);
      ctx.fillStyle = card.fill; ctx.fill();
      ctx.lineWidth = 1.5 * S; ctx.strokeStyle = card.line; ctx.stroke();
      const inner = card.w - CARD_PAD * 2;
      const left = cx + CARD_PAD;
      let yy = cy + CARD_PAD - 4;
      cardRows(ctx, card, card.w).forEach(r => {
        const mid = yy + r.h / 2;
        if (r.name !== undefined) {
          const size = fit(ctx, r.name, inner, P.name, 800, 22);
          text(ctx, r.name, left, mid, size, 800, "#16202e", "left");
          if (r.kana) text(ctx, r.kana, left + width(ctx, r.name, size, 800) + 14, mid + 3, P.kana, 700, card.accent, "left");
        } else if (r.gear) {
          /* ホワイトボード・プロジェクター：使うときは赤で目立たせる */
          let gx = left;
          r.gear.forEach(([label, val], i) => {
            if (i) { text(ctx, "／", gx, mid, P.line, 700, "#b4bcc8", "left"); gx += width(ctx, "／", P.line, 700) + 6; }
            text(ctx, label, gx, mid, P.line, 700, "#6b7686", "left");
            gx += width(ctx, label, P.line, 700) + 8;
            const on = /使う/.test(val);
            text(ctx, val, gx, mid, P.line, 800, on ? "#a32a1c" : "#6b7686", "left");
            gx += width(ctx, val, P.line, 800) + 12;
          });
        } else {
          text(ctx, r.t, left, mid, r.size, r.weight, r.color, "left", inner, 14);
        }
        yy += r.h;
      });
      cx += card.w + CARD_GAP;
    });
  }

  /* ---------- 色の見方（画像のいちばん下） ---------- */
  function drawLegend(ctx, o, x, y) {
    const legend = [["guest", "ゲスト"], ["attend", "アテンド"], ["chair", "会長"], ["speaker", "講話者"], ["leader", "リーダー"], ["yaku", "司会・お役"]];
    let lx = x;
    legend.forEach(([k, label]) => {
      const c = o.colors[k];
      round(ctx, lx, y - 11, 30, 22, 5);
      ctx.fillStyle = c.fill; ctx.fill();
      ctx.lineWidth = 3 * S; ctx.strokeStyle = c.line; ctx.stroke();
      text(ctx, label, lx + 38, y, 18, 700, "#16202e", "left");
      font(ctx, 18, 700);
      lx += 38 + ctx.measureText(label).width / S + 26;
    });
    [["#e0569a", "女性"], ["#2f6fd0", "男性"]].forEach(([color, label]) => {
      ctx.beginPath();
      ctx.arc((lx + 9) * S, y * S, 8 * S, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      text(ctx, label, lx + 24, y, 18, 700, "#16202e", "left");
      font(ctx, 18, 700);
      lx += 24 + ctx.measureText(label).width / S + 22;
    });
  }

  /* 下の段にだれも座っていなければ、画像はそこで切る（layout.cuts の高さのどれか） */
  function cutHeight(lay, seats) {
    const used = lay.seats.filter(s => seats[s.id]).map(s => s.y + (s.h || lay.seatH) / 2);
    const lowest = used.length ? Math.max.apply(null, used) : 0;
    return (lay.cuts || [lay.height]).find(c => c >= lowest) || lay.height;
  }

  function draw(o) {
    const lay = o.layout;
    const W = lay.width + PAD * 2;
    const headH = 104;
    const probe = document.createElement("canvas").getContext("2d");
    const prog = o.kind === "ms" ? programLayout(probe, o.program, W - PAD * 2) : null;
    const progH = prog ? prog.h + 16 : 0;
    const mapH = cutHeight(lay, o.seats);
    const legendH = 60;
    const H = headH + progH + mapH + legendH;
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);

    /* 見出し：左に会の名前と日付、右上にどちらの配席かを大きな札で */
    text(ctx, o.org || "", PAD, 30, 18, 700, "#6b7686", "left");
    const badge = (o.kindTitle || "") + " 配席";
    const badgeColor = o.kind === "ms" ? "#1f4e8c" : "#c2620e";
    font(ctx, 30, 800);
    const bw = ctx.measureText(badge).width / S + 44;
    const bx = W - PAD - bw;
    round(ctx, bx, 22, bw, 62, 14);
    ctx.fillStyle = badgeColor; ctx.fill();
    text(ctx, badge, bx + bw / 2, 53, 30, 800, "#ffffff", "center");
    text(ctx, o.dateLabel || o.title, PAD, 70, 36, 800, "#0f2f4f", "left", bx - PAD - 20, 22);

    if (prog) drawProgram(ctx, o.program, prog, PAD, headH, W - PAD * 2);

    /* 席図（切る高さより下は描かない） */
    const ox = PAD, oy = headH + progH;
    ctx.save();
    ctx.translate(ox * S, oy * S);
    ctx.beginPath();
    ctx.rect(-4 * S, -4 * S, (lay.width + 8) * S, (mapH + 4) * S);
    ctx.clip();
    round(ctx, 0, 0, lay.width, 44, 8);
    ctx.fillStyle = "#0f2f4f"; ctx.fill();
    text(ctx, lay.front, lay.width / 2, 22, 22, 800, "#ffffff");
    lay.tables.forEach(t => {
      if (t.y > mapH) return;
      ctx.beginPath();
      ctx.arc(t.x * S, t.y * S, t.r * S, 0, Math.PI * 2);
      ctx.fillStyle = "#eef1f6"; ctx.fill();
      ctx.lineWidth = 2 * S; ctx.strokeStyle = "#c3cbd7"; ctx.stroke();
      text(ctx, t.label, t.x, t.y - (t.note ? 12 : 0), 44, 800, "#8a96a8");
      if (t.note) text(ctx, t.note, t.x, t.y + 26, 18, 700, "#8a96a8");
    });
    lay.seats.forEach(s => {
      const p = o.seats[s.id];
      const w = s.w || lay.seatW, h = s.h || lay.seatH;
      const x = s.x - w / 2, y = s.y - h / 2;
      if (y + h > mapH) return;
      const narrow = !!s.w && s.w < lay.seatW;
      const short = !!s.h && s.h < lay.seatH;
      const duty = (o.duties || []).find(d => d.seat === s.id);
      const dutyName = duty ? duty.name : "";
      if (!p) {
        round(ctx, x, y, w, h, 8);
        ctx.fillStyle = "#f6f8fb"; ctx.fill();
        ctx.lineWidth = 1.5 * S; ctx.strokeStyle = "#dde3eb"; ctx.stroke();
        if (s.no) text(ctx, s.no, x + 7, y + 11, 14, 800, "#8a96a8", "left");
        const hint = dutyName || (s.hint === "chair" || s.hint === "speaker" || s.hint === "mc" ? s.label : "");
        if (hint) seatText(ctx, [{ t: hint, size: 19, weight: 800, color: dutyName ? "#b9861b" : "#8f99a8" }], s.x, s.y, w, h, short);
        return;
      }
      const c = o.colors[p.role] || o.colors.member;
      round(ctx, x, y, w, h, 8);
      ctx.fillStyle = c.fill; ctx.fill();
      ctx.lineWidth = (p.type === "guest" ? 3.5 : 2.5) * S; ctx.strokeStyle = c.line; ctx.stroke();
      if (s.no) text(ctx, s.no, x + 7, y + 11, 14, 800, "#8a96a8", "left");
      /* 性別の印：右上の小さな丸（女性はピンク、男性は青） */
      const sex = o.genderOf ? o.genderOf(p) : "";
      if (sex === "女性" || sex === "男性") {
        ctx.beginPath();
        ctx.arc((x + w - 15) * S, (y + 14) * S, 7 * S, 0, Math.PI * 2);
        ctx.fillStyle = sex === "女性" ? "#e0569a" : "#2f6fd0"; ctx.fill();
        ctx.lineWidth = 2 * S; ctx.strokeStyle = "#ffffff"; ctx.stroke();
      }
      /* アテンドは主役のゲストより控えめな大きさ */
      const nameSize = p.role === "attend" ? (narrow ? 22 : 25) : (narrow ? 27 : 31);
      const nameRow = { t: p.name, size: nameSize, weight: 800, color: c.ink, lh: 1.12, gap: 2, name: true };
      if (p.type === "guest") {
        seatText(ctx, [
          { t: p.kana, size: narrow ? 15 : 17, weight: 700, color: "#3c6a96", kana: true },
          Object.assign(nameRow, { suffix: "様" }),
          { t: p.referrer ? "紹介 " + p.referrer : "ゲスト", size: narrow ? 17 : 19, weight: 700, color: "#3c6a96" }
        ], s.x, s.y, w, h, short);
      } else {
        const tag = dutyName || o.roleShort[p.role] || "";
        seatText(ctx, [
          { t: tag, size: narrow ? 15 : 17, weight: 800, color: c.line },
          nameRow
        ], s.x, s.y, w, h, short);
      }
    });
    ctx.restore();

    drawLegend(ctx, o, PAD, headH + progH + mapH + 30);
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
