// 一人一猫体重簿 - 主页逻辑(与网页版同构:录入 / 状态贴片 / 双趋势图 / 明细 / 设置)
const LS_R = "wd_records_v1";
const LS_S = "wd_settings_v1";
const DEFAULT_SETTINGS = {
  height: null,      // cm,影响 BMI
  targetMe: null,    // 我的目标体重
  catName: "小葵",
  catMin: 4.0,
  catMax: 5.5,
  sample: false
};

// 图表配色(与网页版一致,已过 OKLCH 六项校验)
const COLORS = {
  light: { surface: "#FFFFFF", line: "#E3DCCB", ink: "#29281F", ink2: "#6B675A", ink3: "#98937F", me: "#0B7F5B", cat: "#A8701F", good: "#1F7A4D" },
  dark:  { surface: "#262521", line: "#3B3931", ink: "#ECE7DA", ink2: "#B3AD9C", ink3: "#847E6D", me: "#45A98C", cat: "#C6822E", good: "#5BBF8E" }
};

/* ---------- 工具 ---------- */
function pad2(n){ return n < 10 ? "0" + n : "" + n; }
function todayStr(){
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function parseDate(s){ const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function fmtCN(s){ const p = s.split("-"); return (+p[1]) + "月" + (+p[2]) + "日"; }
function fmtMD(s){ const p = s.split("-"); return (+p[1]) + "/" + (+p[2]); }
function round1(x){ return Math.round(x * 10) / 10; }
function round2(x){ return Math.round(x * 100) / 100; }
function fmtSigned(x){
  if (x === null || x === undefined || isNaN(x)) return "—";
  const v = round2(x);
  if (Math.abs(v) < 0.005) return "±0";
  return v > 0 ? "+" + v.toFixed(2).replace(/0$/, "") : "−" + Math.abs(v).toFixed(2).replace(/0$/, "");
}
function niceTicks(lo, hi, n){
  let span = hi - lo;
  if (span <= 0){ hi = lo + 1; span = 1; }
  let step = span / n;
  const mag = Math.pow(10, Math.floor(Math.log(step) / Math.LN10));
  const norm = step / mag;
  if (norm > 5) step = 10 * mag; else if (norm > 2) step = 5 * mag; else if (norm > 1) step = 2 * mag; else step = mag;
  const ticks = [];
  const start = Math.ceil(lo / step) * step;
  for (let v = start; v <= hi + 1e-9; v += step) ticks.push(v);
  return ticks;
}
function bmiInfo(weight, height){
  if (!height || height < 80) return null;
  const bmi = weight / Math.pow(height / 100, 2);
  let grade, cls;
  if (bmi < 18.5){ grade = "偏瘦"; cls = "warn"; }
  else if (bmi < 24){ grade = "正常"; cls = "good"; }
  else if (bmi < 28){ grade = "偏重"; cls = "warn"; }
  else { grade = "肥胖"; cls = "bad"; }
  return { value: round1(bmi), grade: grade, cls: cls };
}
function catZone(weight, lo, hi){
  if (weight < lo) return { text: "低于理想区间", cls: "warn" };
  if (weight > hi) return { text: "高于理想区间", cls: "warn" };
  return { text: "理想区间内", cls: "good" };
}
function currentTheme(){
  try {
    if (wx.getAppBaseInfo) return wx.getAppBaseInfo().theme === "dark" ? "dark" : "light";
  } catch (e) {}
  try { return wx.getSystemInfoSync().theme === "dark" ? "dark" : "light"; } catch (e) { return "light"; }
}

Page({
  data: {
    today: "",
    todayLabel: "",
    hasSample: false,
    subject: "me",
    catName: "小葵",
    saveBtnText: "记下我的体重",
    weightValue: "",
    dateValue: "",
    noteValue: "",
    formMsg: "",
    tileMe: null,
    tileCat: null,
    liveMe: "",
    liveCat: "",
    liveBmi: "",
    noteMe: "",
    noteCat: "",
    noteBmi: "",
    rows: [],
    footerText: "数据保存在本机微信的小程序缓存里",
    openSettings: false,
    setHeight: "",
    setTarget: "",
    setCatName: "",
    setCatMin: "",
    setCatMax: ""
  },

  charts: {},      // { me:{pts,recs}, cat:{...} }
  records: [],
  settings: {},
  theme: "light",

  /* ---------- 生命周期 ---------- */
  onLoad(){
    this.theme = currentTheme();
    this.initStorage();
    const t = todayStr();
    this.setData({ today: t, dateValue: t, todayLabel: fmtCN(t) });
    this.fillSettingsForm();
    this.renderAll();
  },
  onReady(){
    this.drawCharts();
  },
  onThemeChange(e){
    this.theme = (e.theme === "dark") ? "dark" : "light";
    this.drawCharts();
  },

  /* ---------- 存储 ---------- */
  initStorage(){
    let r = null, s = null;
    try { r = wx.getStorageSync(LS_R); s = wx.getStorageSync(LS_S); } catch (e) {}
    this.records = Array.isArray(r) ? r : [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
    if (this.settings.catName === "小猫") this.settings.catName = "小葵"; // 旧默认名迁移
    if (this.records.length === 0 && !s) this.ensureSample();
    this.sortRecords();
    this.persistAll();
  },
  ensureSample(){
    const now = parseDate(todayStr()).getTime();
    const D = function(daysAgo){
      const d = new Date(now - daysAgo * 86400000);
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    };
    const samples = [
      { subject: "me",  date: D(21), weight: 73.2, note: "" },
      { subject: "me",  date: D(17), weight: 72.8, note: "" },
      { subject: "me",  date: D(12), weight: 72.5, note: "" },
      { subject: "me",  date: D(6),  weight: 72.1, note: "" },
      { subject: "me",  date: D(2),  weight: 71.9, note: "晚上称的" },
      { subject: "me",  date: D(0),  weight: 71.6, note: "" },
      { subject: "cat", date: D(18), weight: 4.58, note: "" },
      { subject: "cat", date: D(11), weight: 4.62, note: "" },
      { subject: "cat", date: D(4),  weight: 4.66, note: "换粮第 3 天" },
      { subject: "cat", date: D(0),  weight: 4.63, note: "" }
    ];
    this.records = samples.map(function(s){
      return { id: s.subject + "_" + s.date.replace(/-/g, ""), subject: s.subject, date: s.date, weight: s.weight, note: s.note, sample: true, ts: 0 };
    });
    this.settings.sample = true;
    if (!this.settings.height) this.settings.height = 175;
  },
  sortRecords(){
    this.records.sort(function(a, b){
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
  },
  persistRecords(){ try { wx.setStorageSync(LS_R, this.records); } catch (e) {} },
  persistSettings(){ try { wx.setStorageSync(LS_S, this.settings); } catch (e) {} },
  persistAll(){ this.persistRecords(); this.persistSettings(); },

  saveRecord(subject, date, weight, note){
    const id = subject + "_" + date.replace(/-/g, "");
    const existed = this.records.some(function(r){ return r.id === id; });
    if (existed) this.records = this.records.filter(function(r){ return r.id !== id; });
    const hadSample = this.records.some(function(r){ return r.sample; });
    if (hadSample){
      this.records = this.records.filter(function(r){ return !r.sample; });
      this.settings.sample = false;
      this.persistSettings();
    }
    this.records.push({ id: id, subject: subject, date: date, weight: weight, note: note, sample: false, ts: Date.now() });
    this.sortRecords();
    this.persistRecords();
    return existed;
  },
  deleteRecord(id){
    this.records = this.records.filter(function(r){ return r.id !== id; });
    this.persistRecords();
    this.renderAll();
    this.drawCharts();
  },

  /* ---------- 录入交互 ---------- */
  setSubject(e){
    const s = e.currentTarget.dataset.s;
    const catName = this.settings.catName || "小葵";
    this.setData({
      subject: s,
      saveBtnText: s === "me" ? "记下我的体重" : "记下 " + catName + " 的体重",
      formMsg: ""
    });
  },
  onWeightInput(e){ this.setData({ weightValue: e.detail.value }); },
  onDateChange(e){ this.setData({ dateValue: e.detail.value }); },
  onNoteInput(e){ this.setData({ noteValue: e.detail.value }); },

  onTapSave(){
    const w = parseFloat(this.data.weightValue);
    const d = this.data.dateValue || todayStr();
    const note = (this.data.noteValue || "").trim();
    if (!(w > 0) || w > 300){ this.setData({ formMsg: "请输入有效的体重数字" }); return; }
    if (this.data.subject === "cat" && (w < 0.5 || w > 20)){ this.setData({ formMsg: "猫咪体重看起来不太对,请确认单位是 kg" }); return; }
    if (this.data.subject === "me" && w < 20){ this.setData({ formMsg: "成人体重请以 kg 为单位" }); return; }
    const updated = this.saveRecord(this.data.subject, d, round2(w), note);
    this.setData({ weightValue: "", noteValue: "", formMsg: "", dateValue: todayStr() });
    this.renderAll();
    this.drawCharts();
    wx.showToast({ title: updated ? "同日已有记录,已更新" : "已记录", icon: "none" });
  },

  /* ---------- 明细 ---------- */
  onTapDelete(e){
    const idx = e.currentTarget.dataset.index;
    const row = this.data.rows[idx];
    if (!row) return;
    if (row.confirm){
      this.deleteRecord(row.id);
      wx.showToast({ title: "已删除", icon: "none" });
    } else {
      this.setData({ ["rows[" + idx + "].confirm"]: true });
      setTimeout(() => {
        const cur = this.data.rows[idx];
        if (cur && cur.id === row.id) this.setData({ ["rows[" + idx + "].confirm"]: false });
      }, 2600);
    }
  },

  /* ---------- 设置 ---------- */
  toggleSettings(){
    this.setData({ openSettings: !this.data.openSettings });
  },
  onSetInput(e){
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },
  fillSettingsForm(){
    const s = this.settings;
    this.setData({
      setHeight: s.height ? String(s.height) : "",
      setTarget: s.targetMe ? String(s.targetMe) : "",
      setCatName: s.catName || "",
      setCatMin: s.catMin ? String(s.catMin) : "",
      setCatMax: s.catMax ? String(s.catMax) : ""
    });
  },
  onTapSaveSettings(){
    const h = parseFloat(this.data.setHeight);
    const t = parseFloat(this.data.setTarget);
    const n = (this.data.setCatName || "").trim() || "小葵";
    const cmin = parseFloat(this.data.setCatMin);
    const cmax = parseFloat(this.data.setCatMax);
    this.settings.height = h > 0 ? h : null;
    this.settings.targetMe = t > 0 ? t : null;
    this.settings.catName = n;
    if (cmin > 0) this.settings.catMin = cmin;
    if (cmax > 0) this.settings.catMax = cmax;
    if (this.settings.catMin > this.settings.catMax){
      const tmp = this.settings.catMin; this.settings.catMin = this.settings.catMax; this.settings.catMax = tmp;
    }
    this.persistSettings();
    this.fillSettingsForm();
    this.renderAll();
    this.drawCharts();
    this.setData({ subject: this.data.subject, saveBtnText: this.data.subject === "me" ? "记下我的体重" : "记下 " + n + " 的体重" });
    wx.showToast({ title: "设置已保存", icon: "none" });
  },

  /* ---------- 导出 / 导入(剪贴板) ---------- */
  onTapExport(){
    const payload = { version: 1, exportedAt: new Date().toISOString(), settings: this.settings, records: this.records };
    wx.setClipboardData({
      data: JSON.stringify(payload, null, 2),
      success(){
        wx.showToast({ title: "已复制,粘贴到微信收藏即可保存", icon: "none", duration: 2500 });
      }
    });
  },
  onTapImport(){
    wx.getClipboardData({
      success: (res) => {
        let data;
        try { data = JSON.parse(res.data); } catch (e) { data = null; }
        if (!data || !Array.isArray(data.records)){
          wx.showToast({ title: "剪贴板里不是备份数据", icon: "none" });
          return;
        }
        wx.showModal({
          title: "导入备份",
          content: "解析出 " + data.records.length + " 条记录,与现有数据合并?",
          success: (m) => {
            if (!m.confirm) return;
            const byId = {};
            this.records.forEach(function(r){ byId[r.id] = r; });
            data.records.forEach(function(r){
              if (!r || !r.subject || !r.date || !(r.weight > 0)) return;
              const id = r.subject + "_" + String(r.date).slice(0, 10).replace(/-/g, "");
              byId[id] = {
                id: id, subject: r.subject === "cat" ? "cat" : "me",
                date: String(r.date).slice(0, 10), weight: +r.weight,
                note: r.note || "", sample: !!r.sample, ts: r.ts || 0
              };
            });
            this.records = Object.keys(byId).map(function(k){ return byId[k]; });
            if (data.settings) this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
            this.sortRecords();
            this.persistAll();
            this.fillSettingsForm();
            this.renderAll();
            this.drawCharts();
            wx.showToast({ title: "已导入,共 " + this.records.length + " 条", icon: "none" });
          }
        });
      }
    });
  },

  /* ---------- 渲染 ---------- */
  makeTile(subject){
    const arr = this.records.filter(function(r){ return r.subject === subject; });
    if (!arr.length) return null;
    const last = arr[arr.length - 1];
    const prev = arr.length > 1 ? arr[arr.length - 2] : null;
    const dec = subject === "cat" ? 2 : 1;
    const sub = (prev ? "较上次 " + fmtSigned(last.weight - prev.weight) + " kg · " : "") + fmtCN(last.date);
    let chip, chipCls;
    if (subject === "me"){
      const b = bmiInfo(last.weight, this.settings.height);
      if (b){ chip = "BMI " + b.value.toFixed(1) + " · " + b.grade; chipCls = b.cls; }
      else { chip = "填身高后显示 BMI"; chipCls = "neutral"; }
    } else {
      const z = catZone(last.weight, this.settings.catMin, this.settings.catMax);
      chip = z.text; chipCls = z.cls;
    }
    return { val: last.weight.toFixed(dec), sub: sub, chip: chip, chipCls: chipCls };
  },

  renderAll(){
    const catName = this.settings.catName || "小葵";
    const hasSample = this.records.some(function(r){ return r.sample; });
    const all = this.records.slice().sort(function(a, b){
      return a.date < b.date ? 1 : (a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0));
    });
    const rows = all.map((r, idx) => {
      let older = null;
      for (let j = idx + 1; j < all.length; j++){ if (all[j].subject === r.subject){ older = all[j]; break; } }
      const dec = r.subject === "cat" ? 2 : 1;
      let noteText = r.note || "";
      if (r.sample) noteText = noteText ? noteText + "(示例)" : "示例数据";
      return {
        id: r.id,
        dotCls: r.subject === "cat" ? "dot-cat" : "dot-me",
        date: fmtCN(r.date),
        who: r.subject === "cat" ? catName : "我",
        w: r.weight.toFixed(dec),
        delta: older ? fmtSigned(r.weight - older.weight) : "—",
        note: noteText,
        dim: !!r.sample,
        confirm: false
      };
    });
    this.setData({
      catName: catName,
      hasSample: hasSample,
      tileMe: this.makeTile("me"),
      tileCat: this.makeTile("cat"),
      rows: rows
    });
  },

  /* ---------- 图表(canvas 2d 手绘) ---------- */
  drawCharts(){
    this.drawChart("me");
    this.drawChart("cat");
    this.drawChart("bmi");
  },

  drawChart(subject, hoverIdx){
    const patchKey = subject === "me" ? "liveMe" : (subject === "cat" ? "liveCat" : "liveBmi");
    const noteKey = subject === "me" ? "noteMe" : (subject === "cat" ? "noteCat" : "noteBmi");
    const id = subject === "me" ? "#chart-me" : (subject === "cat" ? "#chart-cat" : "#chart-bmi");
    let recs;
    if (subject === "bmi"){
      const h = this.settings.height;
      const meArr = this.records.filter(function(r){ return r.subject === "me"; });
      if (!h || h < 80 || !meArr.length){
        this.charts[subject] = null;
        this.setData({
          [patchKey]: (h && h >= 80) ? "暂无数据" : "待设置",
          [noteKey]: (h && h >= 80) ? "记一笔体重后,这里会出现 BMI 曲线。" : "在设置里填身高后,这里会显示 BMI 曲线。"
        });
        return;
      }
      recs = meArr.map(function(r){
        return { date: r.date, weight: round1(r.weight / Math.pow(h / 100, 2)) };
      }).slice(-90);
    } else {
      recs = this.records.filter(function(r){ return r.subject === subject; }).slice(-90);
    }
    if (!recs.length){
      this.charts[subject] = null;
      this.setData({ [patchKey]: "暂无数据", [noteKey]: "在上方记一笔后,这里会出现趋势线。" });
      return;
    }
    wx.createSelectorQuery().in(this).select(id).fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext("2d");
      let dpr = 2;
      try { dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2; } catch (e) {}
      const W = res[0].width, H = res[0].height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const C = COLORS[this.theme];
      const color = subject === "cat" ? C.cat : (subject === "bmi" ? C.ink2 : C.me);
      const padL = 40, padR = 14, padT = 14, padB = 24;
      const last = recs[recs.length - 1];
      const prev = recs.length > 1 ? recs[recs.length - 2] : null;
      const dec = subject === "cat" ? 2 : 1;

      const target = subject === "me" ? this.settings.targetMe : null;
      const band = subject === "cat"
        ? { min: this.settings.catMin, max: this.settings.catMax }
        : (subject === "bmi" ? { min: 18.5, max: 24 } : null);
      let vals = recs.map(function(r){ return r.weight; });
      if (target) vals = vals.concat([target]);
      if (band) vals = vals.concat([band.min, band.max]);
      const lo2 = Math.min.apply(null, vals), hi2 = Math.max.apply(null, vals);
      const pad = Math.max((hi2 - lo2) * 0.18, dec === 2 ? 0.15 : 0.8);
      const yLo = lo2 - pad, yHi = hi2 + pad;

      const times = recs.map(function(r){ return parseDate(r.date).getTime(); });
      const tLo = times[0], tHi = times[times.length - 1];
      const useIndex = (tHi - tLo) < 86400000 && recs.length > 1;
      const X = function(i){
        if (useIndex) return padL + (W - padL - padR) * (recs.length === 1 ? 0.5 : i / (recs.length - 1));
        return padL + (W - padL - padR) * ((times[i] - tLo) / Math.max(tHi - tLo, 1));
      };
      const Y = function(v){ return padT + (H - padT - padB) * (1 - (v - yLo) / (yHi - yLo)); };

      // 理想区间带(猫)
      if (band){
        const y1 = Y(Math.min(band.max, yHi)), y2 = Y(Math.max(band.min, yLo));
        ctx.fillStyle = this.theme === "dark" ? "rgba(91,191,142,0.15)" : "rgba(31,122,77,0.13)";
        ctx.fillRect(padL, y1, W - padL - padR, Math.max(y2 - y1, 0));
        ctx.fillStyle = C.good;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText((subject === "bmi" ? "正常 " : "理想 ") + band.min.toFixed(1) + "–" + band.max.toFixed(1), W - padR, Math.max(y1 - 3, 10));
      }

      // 网格 + y 标签
      const ticks = niceTicks(yLo, yHi, 3);
      ctx.font = "10px sans-serif";
      ticks.forEach(function(v){
        const gy = Y(v);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
        ctx.fillStyle = C.ink3;
        ctx.textAlign = "right";
        ctx.fillText(String(Math.round(v * 10) / 10), padL - 6, gy + 3.5);
      });

      // 目标虚线(我)
      if (target && target >= yLo && target <= yHi){
        const ty = Y(target);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = C.ink3;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(W - padR, ty); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = C.ink2;
        ctx.textAlign = "right";
        ctx.fillText("目标 " + target.toFixed(1), W - padR, ty - 4);
      }

      const pts = recs.map(function(r, i){ return { x: X(i), y: Y(r.weight) }; });

      // 区域淡填充
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, H - padB);
      pts.forEach(function(p){ ctx.lineTo(p.x, p.y); });
      ctx.lineTo(pts[pts.length - 1].x, H - padB);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // 折线
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach(function(p, i){ if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();

      // 数据点
      if (pts.length <= 26){
        pts.forEach(function(p){
          ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = C.surface; ctx.stroke();
        });
      }
      // 末点强调 + 直接标注
      const lp = pts[pts.length - 1];
      ctx.beginPath(); ctx.arc(lp.x, lp.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.surface; ctx.stroke();
      // 数值标注:≤10 个点全标;更多则按间隔采样标注,首末必标
      const nPts = pts.length;
      const stepN = nPts <= 10 ? 1 : Math.ceil(nPts / 10);
      const idxs = [];
      for (let i = 0; i < nPts; i += stepN) idxs.push(i);
      if (idxs[idxs.length - 1] !== nPts - 1) idxs.push(nPts - 1);
      ctx.fillStyle = C.ink;
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "center";
      idxs.forEach(function(i){
        const p = pts[i];
        const ty = p.y - 8 < padT + 10 ? p.y + 14 : p.y - 8;
        const tx = Math.min(Math.max(p.x, padL + 14), W - padR - 14);
        ctx.fillText(recs[i].weight.toFixed(dec), tx, ty);
      });

      // x 标签:首/中/末
      ctx.fillStyle = C.ink3;
      ctx.font = "10px sans-serif";
      const mids = [[0, "left"], [Math.floor((recs.length - 1) / 2), "center"], [recs.length - 1, "right"]];
      mids.forEach(function(a){
        if (recs.length === 2 && a[0] === 1) return;
        ctx.textAlign = a[1];
        ctx.fillText(fmtMD(recs[a[0]].date), X(a[0]), H - 7);
      });

      // 悬停高亮环
      if (hoverIdx !== undefined && hoverIdx !== null && pts[hoverIdx]){
        const p = pts[hoverIdx];
        ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
      }

      const unit = subject === "bmi" ? "" : " kg";
      const prefix = subject === "bmi" ? "BMI " : "";
      const liveText = (hoverIdx !== undefined && hoverIdx !== null && recs[hoverIdx])
        ? fmtCN(recs[hoverIdx].date) + " · " + prefix + recs[hoverIdx].weight.toFixed(dec) + unit
        : prefix + last.weight.toFixed(dec) + unit + (prev ? " · 较上次 " + fmtSigned(last.weight - prev.weight) : "");
      const noteText = recs.length === 1 ? "只有 1 条记录,记满 2 条起显示趋势" : "显示最近 " + recs.length + " 条记录";
      this.setData({ [patchKey]: liveText, [noteKey]: noteText });
      this.charts[subject] = { pts: pts, recs: recs };
    });
  },

  /* ---------- 图表触摸 ---------- */
  onChartTouch(e){
    const subject = e.currentTarget.dataset.subject;
    const chart = this.charts[subject];
    if (!chart) return;
    const t = e.touches && e.touches[0] ? e.touches[0] : (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    let best = 0, bd = Infinity;
    chart.pts.forEach(function(p, i){
      const d = Math.abs(p.x - t.x);
      if (d < bd){ bd = d; best = i; }
    });
    this.drawChart(subject, best);
  },
  onChartTouchEnd(e){
    const subject = e.currentTarget.dataset.subject;
    if (!this.charts[subject]) return;
    this.drawChart(subject);
  }
});
