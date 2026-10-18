/* ============================================================
 *  モーニングセミナー運営 ― 設定
 *  スプレッドシート連携の URL と、画面側の既定値だけをここに置きます。
 * ============================================================ */
const MS_CONFIG = {
  org: "大阪みなと倫理法人会",

  api: {
    // GAS をデプロイして得た https://script.google.com/macros/s/××××/exec を貼る
    // 空のままだと、この端末の localStorage にだけ保存されます（共有されません）
    endpoint: "https://script.google.com/macros/s/AKfycbzKPkwtWowBknFPrTSc66OIQ5RraM5oeYt8yZx8vkR4W2qP5yM7KW0FJqOMnK8oznf0jw/exec"
  },

  /* いま運用している会員スピーチ／講話の担当表。ここが名前の正です。
     tabs は優先度の低い順（あとから読んだタブが同じ日付を上書き）。
     R9 の詳細タブ（呼び出し方・所属・役職）をいちばん後に読む。 */
  speechSheet: {
    id: "1DWyJy9Hst3ohPIme66oFf37dMbp7VwKiGyBb8JyC8Iw",
    gid: "1644925538",
    url: "https://docs.google.com/spreadsheets/d/1DWyJy9Hst3ohPIme66oFf37dMbp7VwKiGyBb8JyC8Iw/edit?gid=1644925538#gid=1644925538",
    tabs: [
      { gid: "1935899229", name: "履歴R5まで", kind: "archive", year: 2019 },
      { gid: "0", name: "R6会員スピーチ", kind: "simple", year: 2023 },
      { gid: "1579469730", name: "R7会員スピーチ", kind: "simple", year: 2024 },
      { gid: "821145414", name: "R8 会員スピーチ", kind: "ops", year: 2025 },
      { gid: "926049077", name: "R9 会員スピーチ", kind: "ops", year: 2026 },
      { gid: "1644925538", name: "R9 講話&会員スピーチ", kind: "detail", year: 2026 }
    ]
  },

  annual: {
    endpoint: "https://script.google.com/macros/s/AKfycbzTeyVLF9so2tljCe2Qb9MWq0pt15kWXXKo9fCXei5sWLIMTELMVoUce2d0QOTSCcbS/exec",
    msCatId: "c1"
  },

  months: 3,

  lanes: [
    { id: "speech", name: "会員スピーチ", kinds: ["会員スピーチ"] },
    { id: "kowa",   name: "講話",         kinds: ["講話", "ハーフ講話"] },
    { id: "other",  name: "その他",       kinds: [] }
  ],

  templates: [
    { key: "format_decide", title: "この回の構成を決める",         offset: -100, lane: "other", stage: 1 },
    { key: "ask",           title: "決まった",                     offset: -90,  lane: "slot",  stage: 2 },
    { key: "contact",       title: "連絡を取る",                   offset: -90,  lane: "slot",  stage: 2 },
    { key: "confirm",       title: "依頼を確定し、レジュメ作成を依頼する", offset: -60,  lane: "slot",  stage: 2 },
    { key: "resume_due",    title: "事前レジュメの提出期限",       offset: -30,  lane: "slot",  stage: 2 },
    { key: "resume_check",  title: "レジュメが届いたか確認する",   offset: -30,  lane: "slot",  stage: 2 },
    { key: "title_fill",    title: "演題をカレンダーに記入する",   offset: -28,  lane: "slot",  stage: 2 },
    { key: "handout",       title: "当日配布資料のデータを受け取る", offset: -14,  lane: "slot",  stage: 2 },
    { key: "print",         title: "印刷を完了する",               offset: -7,   lane: "slot",  stage: 2 }
  ],

  formats: [
    { id: "unset",     name: "未定" },
    { id: "normal",    name: "通常（講話＋会員スピーチ）", slots: [
      { kind: "講話", order: 1 },
      { kind: "会員スピーチ", order: 1 }
    ]},
    { id: "kowa_only", name: "講話のみ", slots: [
      { kind: "講話", order: 1 }
    ]},
    { id: "double",    name: "ダブル講話", slots: [
      { kind: "ハーフ講話", order: 1 },
      { kind: "ハーフ講話", order: 2 }
    ]},
    { id: "special",   name: "特別（枠を手動で追加）", slots: [] }
  ],

  roles: ["司会", "受付", "季のあいさつ", "進行"],

  messages: {
    ask: [
      "{name} 様",
      "",
      "お世話になっております。大阪みなと倫理法人会です。",
      "",
      "{date}（{weekday}）のモーニングセミナーにて、{kind}をお願いしたくご連絡いたしました。",
      "",
      "開催日：{date}（{weekday}）",
      "お願い：{kind}",
      "",
      "ご都合をお聞かせいただけますと幸いです。",
      "どうぞよろしくお願いいたします。"
    ].join("\n"),
    confirm: [
      "{name} 様",
      "",
      "このたびは {date}（{weekday}）のモーニングセミナーにて{kind}をお引き受けいただき、ありがとうございます。",
      "",
      "つきましては、事前のレジュメを {resumeDue} までにご提出いただけますと助かります。",
      "レジュメをいただきましたら、演題を年間カレンダーへ記入いたします。",
      "",
      "当日お配りする資料のデータが必要な場合は、{handoutDue} までにいただけますと、1週間前の印刷に間に合います。",
      "",
      "どうぞよろしくお願いいたします。"
    ].join("\n"),
    remind_resume: [
      "{name} 様",
      "",
      "{date}（{weekday}）の{kind}に向けて、事前レジュメの提出期限が {resumeDue} となっております。",
      "ご提出のほど、どうぞよろしくお願いいたします。"
    ].join("\n"),
    remind_handout: [
      "{name} 様",
      "",
      "{date}（{weekday}）の当日配布資料についてご連絡です。",
      "印刷を1週間前（{printDue}）までに済ませるため、データを {handoutDue} までにいただけますと助かります。",
      "どうぞよろしくお願いいたします。"
    ].join("\n")
  }
};
