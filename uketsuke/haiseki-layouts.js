/* ============================================================
 *  MS・朝食会 配席 ― 会場の席図
 *
 *  座標は実物の縮尺ではなく「名前の札が重ならず読める」ことを優先した、
 *  横 width × 縦 height の仮の方眼。上が前方（演台側）。
 *  札（席）は中心の位置 x, y で置き、大きさは seatW × seatH（中央列だけ細い札）。
 *  文字の大きさもこの方眼の単位で決めている（画面も画像も同じ）。
 *  札は左上の席番号・ふりがな・お名前（長いときは2行）・紹介者が入る高さにしてある。
 *  席番号（no）は卓ごとに上の左から時計まわりに A1〜A8、中央の列は前の段の左から M1, M2 …
 *
 *  席の hint：名前が入っていないときに薄く出す役の目安。
 *    chair / speaker / mc / yaku … 会長・講話者・司会・お役の席（label が席の上に出る）
 *  cuts：LINE用の画像を下で切ってよい高さ（上から順）。そこより下にだれも座っていなければ、画像はそこで切る。
 *  会場が変わったら、このファイルの数字だけを直す（札の大きさを変えれば、卓の位置は計算で決まる）。
 * ============================================================ */
(function (global) {
  "use strict";

  /* 丸テーブルのまわりの席。pos は t=上 l=左 r=右 b=下 の2席ずつ。
   *  左右の席は上下の席のあいだの高さに置くので、横は上下の席と重なってよい（そのぶん札を大きくできる） */
  function roundTable(id, label, cx, cy, sides, o) {
    const at = {
      t1: [cx - o.dx, cy - o.vy], t2: [cx + o.dx, cy - o.vy],
      l1: [cx - o.side, cy - o.sy], l2: [cx - o.side, cy + o.sy],
      r1: [cx + o.side, cy - o.sy], r2: [cx + o.side, cy + o.sy],
      b1: [cx - o.dx, cy + o.vy], b2: [cx + o.dx, cy + o.vy]
    };
    const hints = o.hints || {};
    const seats = [];
    sides.split("").forEach(s => {
      [1, 2].forEach(n => {
        const pos = s + n;
        const h = hints[pos] || {};
        seats.push({ id: id + "-" + pos, table: id, pos, x: at[pos][0], y: at[pos][1], hint: h.hint || "", label: h.label || "" });
      });
    });
    /* 席の番号：上の左から時計まわりに A1, A2 …（上 → 右 → 下 → 左） */
    const order = ["t1", "t2", "r1", "r2", "b2", "b1", "l2", "l1"].filter(pos => seats.some(x => x.pos === pos));
    seats.forEach(x => { x.no = label + (order.indexOf(x.pos) + 1); delete x.pos; });
    return { table: { id, label, x: cx, y: cy, r: o.r, note: o.note || "", vy: o.vy }, seats };
  }

  /* 札の大きさ（w × h）と卓の半径 r から、席の置き場所を決める。
   *  縦は「段」（rowStep ごと）にそろえる：上の2席・左右の上・左右の下・下の2席が、それぞれ1段ずつ下がる。
   *  中央の列も同じ段に並べるので、卓の席と中央の列の頭のツラがそろう */
  const rowStep = 146 + 12;
  function tableGeometry(w, h, r) {
    const sy = rowStep / 2;               // 左右の2席の、卓の中心からの上下のずれ（半段）
    const vy = rowStep * 1.5;             // 上下の席の、卓の中心からの距離（1段半）
    return {
      r,
      dx: w / 2 + 4,                      // 上下の2席の左右のずれ
      side: r + 6 + w / 2,                // 左右の席の、卓の中心からの距離（円のすぐ外）
      sy,
      vy,
      half: vy + h / 2                    // 卓の中心から、上下の札の外側の端まで
    };
  }

  function build(def) {
    const tables = [], seats = [];
    def.parts.forEach(p => {
      if (p.table) tables.push(p.table);
      p.seats.forEach(s => seats.push(s));
    });
    return { id: def.id, title: def.title, width: def.width, height: def.height, seatW: def.seatW, seatH: def.seatH,
      front: def.front, tables, seats, blocks: def.blocks || [], cuts: (def.cuts || []).concat([def.height]) };
  }

  /* 中央の列（前を向いて座る席）。cols 列 × rows 段。番号は前の段の左から M1, M2 …
   *  hints は番号ごとの役（{ M1: { hint, label } }） */
  function centerBlock(id, x0, y0, cols, rows, gapX, gapY, hints) {
    const seats = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const no = id + (r * cols + c + 1);
        const h = hints[no] || {};
        seats.push({ id: no, table: id, no, x: x0 + c * gapX, y: y0 + r * gapY, hint: h.hint || "", label: h.label || "" });
      }
    }
    return { table: null, seats };
  }

  /* 札の高さ（全部の札で同じ）。左上の席番号・ふりがな・お名前（2行まで）・紹介者が入る高さ */
  const seatH = 146;
  /* 前方の帯（高さ 44）の下に司会・講話者・会長の札を置き、卓はその下の段から始める */
  const topY = 44 + 16 + seatH / 2;
  const firstRow = topY + seatH + 24;     // 卓の上の2席（いちばん上の段）の高さ
  /* 卓の3段の中心の高さ。step は卓の中心から次の卓の中心まで */
  function rowsFor(g, step) {
    const first = firstRow + g.vy;
    return [first, first + step, first + step * 2];
  }

  /* ---------- 朝食会：丸テーブル 6卓 × 8席、前方の右に司会 2席 ----------
   *  A1 が講話者、A2 が会長の席（どちらも開いたときに自動で入る）。ほかの卓に決まった役の席はない */
  const cW = 190;
  const cg = tableGeometry(cW, seatH, 50);
  const cRows = rowsFor(cg, cg.half * 2 + 70);
  const cLeft = 10 + cg.side + cW / 2;          // 左の卓の中心
  const cWidth = 4 * cLeft + 70;                // 左右の卓のあいだを 90 あけて、どちらの卓の席か見分けやすくする
  const cRight = cWidth - cLeft;
  const choshoku = build({
    id: "choshoku",
    title: "朝食会",
    width: cWidth,
    height: cRows[2] + cg.half + 20,
    cuts: [cRows[0] + cg.half + 20, cRows[1] + cg.half + 20],
    seatW: cW,
    seatH,
    front: "前方",
    parts: [
      { seats: [
        { id: "mc-1", table: "", x: cWidth - 10 - cW * 1.5 - 10, y: topY, hint: "mc", label: "司会" },
        { id: "mc-2", table: "", x: cWidth - 10 - cW / 2, y: topY, hint: "mc", label: "司会" }
      ] },
      roundTable("A", "A", cLeft, cRows[0], "tlrb", Object.assign({}, cg, {
        hints: { t1: { hint: "speaker", label: "講話者" }, t2: { hint: "chair", label: "会長" } }
      })),
      roundTable("B", "B", cRight, cRows[0], "tlrb", cg),
      roundTable("C", "C", cLeft, cRows[1], "tlrb", cg),
      roundTable("D", "D", cRight, cRows[1], "tlrb", cg),
      roundTable("E", "E", cLeft, cRows[2], "tlrb", cg),
      roundTable("F", "F", cRight, cRows[2], "tlrb", cg)
    ]
  });

  /* ---------- MS：左右に丸テーブル 3卓ずつ（各8席）、そのあいだに前を向く中央の2列 ----------
   *  右上の卓（B）がお役席。講話者席は前方の左、前方の右は会長と進行の2段。
   *  卓の席と中央の列のあいだは通路としてあける。
   *  横は「卓の左の席・右の席 × 2卓 ＋ 中央の2列」の6席ぶんしかないので、卓の円と余白はぎりぎりまで詰めて札を広くする。
   *  中央の列は卓と同じ段にそろえて、いちばん前の卓の上の席から後ろの卓の下の席まですき間なく並べる。
   *  （A1・A2 = M1・M2、A3/A8 = M3・M4、A4/A7 = M5・M6、A5・A6 = M7・M8、M9・M10 は卓のあいだ、C1・C2 = M11・M12 …）
   *  M1 はタイムキーパーの席。 */
  /* B卓のお役の席：B2 朝の挨拶から右回りに B3 会員スピーチ、B4 連絡事項、B5 誓いの言葉 */
  const yaku = {
    t2: { hint: "yaku", label: "朝の挨拶" }, r1: { hint: "yaku", label: "会員スピーチ" },
    r2: { hint: "yaku", label: "連絡事項" }, b2: { hint: "yaku", label: "誓いの言葉" }
  };
  const mW = 190;                         // 札の横幅（どの席も同じ）
  const aisle = 40;                       // 通路の幅
  const mg = tableGeometry(mW, seatH, 36);
  const reach = mg.side + mW / 2;         // 卓の中心から、左右の席の外側の端まで
  /* 卓は4段（上・左右の上・左右の下・下）を使い、1段あけて次の卓。中央の列はそのあいだも切らさず並べる */
  const mRows = rowsFor(mg, rowStep * 5);
  const mLeft = 8 + reach;                // 左の卓の中心
  const midX0 = mLeft + reach + aisle + mW / 2;
  const midX1 = midX0 + mW + 6;
  const mRight = midX1 + mW / 2 + aisle + reach;
  const msW = mRight + reach + 8;
  const msH = mRows[2] + mg.half + 16;
  const midRows = 5 * 3 - 1;              // いちばん上の卓の上の段から、いちばん下の卓の下の段まで
  const ms = build({
    id: "ms",
    title: "モーニングセミナー",
    width: msW,
    height: msH,
    cuts: [firstRow + rowStep * 8 + seatH / 2 + 10],   // C・D 卓の下（M17・M18）まで。M19 から下はだれかいるときだけ
    seatW: mW,
    seatH,
    front: "前方（演台）",
    parts: [
      { seats: [
        { id: "speaker", table: "", x: 8 + mW / 2, y: topY, hint: "speaker", label: "講話者席" },
        /* 前方の右は、上が会長・下が進行の2段（ここだけ高さ半分の札） */
        { id: "chair", table: "", x: msW - 8 - mW / 2, y: topY - (seatH + 6) / 4, h: (seatH - 6) / 2, hint: "chair", label: "会長" },
        { id: "shinko", table: "", x: msW - 8 - mW / 2, y: topY + (seatH + 6) / 4, h: (seatH - 6) / 2, hint: "yaku", label: "進行" }
      ] },
      roundTable("A", "A", mLeft, mRows[0], "tlrb", mg),
      roundTable("B", "B", mRight, mRows[0], "tlrb", Object.assign({}, mg, { hints: yaku, note: "お役席" })),
      roundTable("C", "C", mLeft, mRows[1], "tlrb", mg),
      roundTable("D", "D", mRight, mRows[1], "tlrb", mg),
      roundTable("E", "E", mLeft, mRows[2], "tlrb", mg),
      roundTable("F", "F", mRight, mRows[2], "tlrb", mg),
      centerBlock("M", midX0, firstRow, 2, midRows, midX1 - midX0, rowStep, {
        M1: { hint: "yaku", label: "タイムキーパー" }
      })
    ],
    blocks: [{ id: "M", label: "中央の列" }]
  });

  /* 朝食会：卓を9人席にしたとき、A5 と A6 のあいだ（下の2席のまんなか）に1席足す。
   *  番号は時計まわりのまま付け直す（もともと A8 だった席は A9 になる）。席の id は変えない。
   *  下に3席並ぶぶん、はみ出すときは左右に余白を足す。 */
  const NINE_ORDER = ["t1", "t2", "r1", "r2", "b2", "x", "b1", "l2", "l1"];

  function padLayout(lay) {
    let minX = 0, maxX = lay.width;
    lay.seats.forEach(s => {
      const w = s.w || lay.seatW;
      minX = Math.min(minX, s.x - w / 2);
      maxX = Math.max(maxX, s.x + w / 2);
    });
    const padL = minX < 8 ? 8 - minX : 0;
    const padR = maxX > lay.width - 8 ? maxX - (lay.width - 8) : 0;
    if (!padL && !padR) return lay;
    return Object.assign({}, lay, {
      width: lay.width + padL + padR,
      seats: lay.seats.map(s => Object.assign({}, s, { x: s.x + padL })),
      tables: lay.tables.map(t => Object.assign({}, t, { x: t.x + padL }))
    });
  }

  function withExtras(lay, extras) {
    extras = extras || {};
    const used = Object.keys(extras).filter(id => extras[id] === 9);
    if (!used.length || lay.id !== "choshoku") return lay;
    const seats = [];
    const byTable = {};
    lay.seats.forEach(s => {
      const copy = Object.assign({}, s);
      if (!copy.table || extras[copy.table] !== 9) {
        seats.push(copy);
        return;
      }
      (byTable[copy.table] = byTable[copy.table] || []).push(copy);
    });
    const tables = lay.tables.map(t => Object.assign({}, t));
    tables.forEach(t => {
      const list = byTable[t.id];
      if (!list) return;
      const spread = lay.seatW + 8;
      list.forEach(s => {
        const pos = s.id.slice(t.id.length + 1);
        if (pos === "b2") s.x = t.x + spread;
        if (pos === "b1") s.x = t.x - spread;
      });
      list.push({ id: t.id + "-x", table: t.id, no: t.label + "6", x: t.x, y: t.y + (t.vy || 0) });
      list.forEach(s => {
        const pos = s.id.slice(t.id.length + 1);
        const i = NINE_ORDER.indexOf(pos);
        if (i >= 0) s.no = t.label + (i + 1);
      });
      list.forEach(s => seats.push(s));
    });
    return padLayout(Object.assign({}, lay, { seats, tables }));
  }

  global.HAISEKI_LAYOUTS = { ms, choshoku, withExtras };
})(window);
