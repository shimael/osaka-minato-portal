/* ============================================================
 *  MS・朝食会 配席 ― 会場の席図
 *
 *  座標は実物の縮尺ではなく「名前の札が重ならず読める」ことを優先した、
 *  横 width × 縦 height の仮の方眼。上が前方（演台側）。
 *  札（席）は中心の位置 x, y で置き、大きさは seatW × seatH（中央列だけ細い札）。
 *
 *  席の hint：名前が入っていないときに薄く出す役の目安。
 *    leader … テーブルリーダーの席（会員を置くと最初からリーダーになる）
 *    chair / speaker / mc / yaku … 会長・講話者・司会・お役の席（label が席の上に出る）
 *  会場が変わったら、このファイルの数字だけを直す。
 * ============================================================ */
(function (global) {
  "use strict";

  /* 丸テーブルのまわりの席。pos は t=上 l=左 r=右 b=下 の2席ずつ */
  function roundTable(id, label, cx, cy, sides, opts) {
    const o = Object.assign({ dx: 78, side: 172, vy: 126, sy: 44, hints: {} }, opts || {});
    const at = {
      t1: [cx - o.dx, cy - o.vy], t2: [cx + o.dx, cy - o.vy],
      l1: [cx - o.side, cy - o.sy], l2: [cx - o.side, cy + o.sy],
      r1: [cx + o.side, cy - o.sy], r2: [cx + o.side, cy + o.sy],
      b1: [cx - o.dx, cy + o.vy], b2: [cx + o.dx, cy + o.vy]
    };
    const seats = [];
    sides.split("").forEach(s => {
      [1, 2].forEach(n => {
        const pos = s + n;
        const h = o.hints[pos] || {};
        seats.push({ id: id + "-" + pos, table: id, x: at[pos][0], y: at[pos][1], hint: h.hint || "", label: h.label || "" });
      });
    });
    return { table: { id, label, x: cx, y: cy, r: 74, note: o.note || "" }, seats };
  }

  function build(def) {
    const tables = [], seats = [];
    def.parts.forEach(p => {
      if (p.table) tables.push(p.table);
      p.seats.forEach(s => seats.push(s));
    });
    return { id: def.id, title: def.title, width: def.width, height: def.height, seatW: def.seatW, seatH: def.seatH,
      front: def.front, tables, seats, blocks: def.blocks || [] };
  }

  /* 中央の列（前を向いて座る席）。cols × rows の細い札 */
  function centerBlock(id, label, x0, y0, cols, rows, gapX, gapY, w, h) {
    const seats = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        seats.push({ id: id + "-" + (r + 1) + "-" + (c + 1), table: id, x: x0 + c * gapX, y: y0 + r * gapY, w, h, hint: "", label: "" });
      }
    }
    return { table: null, block: { id, label }, seats };
  }

  /* ---------- 朝食会：丸テーブル 6卓 × 8席、前方の左に司会 2席 ---------- */
  const leaderTop = { t1: { hint: "leader" } };
  const choshoku = build({
    id: "choshoku",
    title: "朝食会",
    width: 1120,
    height: 1345,
    seatW: 150,
    seatH: 74,
    front: "前方",
    parts: [
      { seats: [
        { id: "mc-1", table: "", x: 120, y: 104, hint: "mc", label: "司会" },
        { id: "mc-2", table: "", x: 286, y: 104, hint: "mc", label: "司会" }
      ] },
      roundTable("A", "A", 280, 380, "tlrb", { hints: leaderTop }),
      roundTable("B", "B", 840, 380, "tlrb", { hints: leaderTop }),
      roundTable("C", "C", 280, 760, "tlrb", { hints: leaderTop }),
      roundTable("D", "D", 840, 760, "tlrb", { hints: leaderTop }),
      roundTable("E", "E", 280, 1140, "tlrb", { hints: leaderTop }),
      roundTable("F", "F", 840, 1140, "tlrb", { hints: leaderTop })
    ]
  });

  /* ---------- MS：左右に丸テーブル 3卓ずつ、そのあいだに前を向く中央の列 ----------
   *  右上の卓（B）がお役席。講話者席は前方の左、会長・進行の席は前方の右。 */
  const yaku = {
    t1: { hint: "yaku", label: "朝の挨拶" }, t2: { hint: "yaku", label: "会員スピーチ" },
    r1: { hint: "yaku", label: "連絡事項" }, r2: { hint: "yaku", label: "誓いの言葉" }
  };
  const msW = 1240;
  const msRows = [370, 770, 1170];
  const ms = build({
    id: "ms",
    title: "モーニングセミナー",
    width: msW,
    height: 1380,
    seatW: 140,
    seatH: 74,
    front: "前方（演台）",
    parts: [
      { seats: [
        { id: "speaker", table: "", x: 96, y: 104, hint: "speaker", label: "講話者席" },
        { id: "chair", table: "", x: msW - 96, y: 104, hint: "chair", label: "会長・進行" }
      ] },
      roundTable("A", "A", 262, msRows[0], "tlb", { side: 162 }),
      roundTable("B", "B", msW - 262, msRows[0], "trb", { side: 162, hints: yaku, note: "お役席" }),
      roundTable("C", "C", 262, msRows[1], "tlb", { side: 162 }),
      roundTable("D", "D", msW - 262, msRows[1], "trb", { side: 162 }),
      roundTable("E", "E", 262, msRows[2], "tlb", { side: 162 }),
      roundTable("F", "F", msW - 262, msRows[2], "trb", { side: 162 }),
      centerBlock("M1", "中央の列（前）", 470, msRows[0] - 46, 4, 2, 100, 92, 92, 80),
      centerBlock("M2", "中央の列（中）", 470, msRows[1] - 46, 4, 2, 100, 92, 92, 80),
      centerBlock("M3", "中央の列（後ろ）", 470, msRows[2] - 46, 4, 2, 100, 92, 92, 80)
    ],
    blocks: [
      { id: "M1", label: "中央（前）" }, { id: "M2", label: "中央（中）" }, { id: "M3", label: "中央（後ろ）" }
    ]
  });

  global.HAISEKI_LAYOUTS = { ms, choshoku };
})(window);
