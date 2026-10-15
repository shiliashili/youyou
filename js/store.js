/* ============================================================
 * 柚柚今天吃什么 · 数据层 + 业务逻辑
 * 全部数据存 localStorage，首次打开写入内置种子，之后只改本地
 * ============================================================ */
window.Store = (function () {
  'use strict';

  var KEY = 'youyou_eat_db_v1';
  var DB = null;
  var memOnly = false; // localStorage 不可用时的兜底

  /* ---------------- 基础工具 ---------------- */
  function uid(p) {
    return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(key, n) {
    var d = parseDate(key); d.setDate(d.getDate() + n); return fmt(d);
  }
  function todayKey() { return fmt(new Date()); }
  function daysBetween(a, b) {
    var ms = parseDate(b) - parseDate(a);
    return Math.round(ms / 86400000);
  }
  function weekStartOf(key) {
    var d = parseDate(key);
    var w = d.getDay(); // 0=周日
    var diff = (w === 0 ? -6 : 1 - w); // 以周一为一周开始
    d.setDate(d.getDate() + diff);
    return fmt(d);
  }
  var WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  function weekdayCn(key) {
    var w = parseDate(key).getDay();
    return WEEK_CN[(w + 6) % 7];
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 默认设置 ---------------- */
  function defaultSettings() {
    return {
      people: 3,
      perMeal: { breakfast: 2, lunch: 3, dinner: 3 },
      withSoup: false,
      noRepeatInWeek: true,
      avoid: '',
      showNutrition: true,
      stage: '未填写'
    };
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { memOnly = true; }
    if (raw) {
      try {
        DB = JSON.parse(raw);
      } catch (e) { DB = null; }
    }
    if (!DB || !DB.version) {
      DB = seedData();
      save(true);
    }
    // 兼容补齐
    var ds = defaultSettings();
    DB.settings = Object.assign({}, ds, DB.settings || {});
    DB.settings.perMeal = Object.assign({}, ds.perMeal, DB.settings.perMeal || {});
    if (!DB.usage) DB.usage = {};
    if (!Array.isArray(DB.favs)) DB.favs = [];
    if (!DB.weeks) DB.weeks = {};
    if (!DB.currentWeek) DB.currentWeek = weekStartOf(todayKey());
    // 内置数据增量升级（旧设备也能拿到修正后的菜谱/食材）
    if (applySeedPatch() > 0) save(true);
    bindWeek(DB.currentWeek);
    return DB;
  }

  /** 把 DB.plan 指向 DB.weeks[ws]（同一对象引用，改动即时生效） */
  function bindWeek(ws) {
    if (!DB.weeks) DB.weeks = {};
    if (!DB.weeks[ws]) DB.weeks[ws] = {};
    DB.currentWeek = ws;
    DB.plan = { weekStart: ws, days: DB.weeks[ws] };
    weekKeys(ws).forEach(function (k) {
      if (!DB.plan.days[k]) {
        DB.plan.days[k] = {
          breakfast: { ids: [], locked: false },
          lunch: { ids: [], locked: false },
          dinner: { ids: [], locked: false }
        };
      }
    });
    return DB.plan;
  }

  function seedData() {
    var s = window.SEED;
    var ings = s.ingredients.map(function (x) {
      return Object.assign({ id: uid('ing'), source: 'seed', createdAt: todayKey() }, x);
    });
    var byName = {};
    ings.forEach(function (i) { byName[i.name] = i; i.alias.forEach(function (a) { byName[a] = i; }); });

    var recs = s.recipes.map(function (r) {
      return {
        id: uid('rec'),
        name: r.name,
        mealTypes: r.mealTypes || ['lunch', 'dinner'],
        role: r.role || guessRole(r.name, r.ingredients.map(function (i) { return i.name; })),
        tags: r.tags || [],
        ingredients: (r.ingredients || []).map(function (i) { return { name: i.name, amount: i.amount || '', ingId: byName[i.name] ? byName[i.name].id : '' }; }),
        seasonings: r.seasonings || [],
        steps: r.steps || '',
        note: r.note || '',
        source: 'seed',
        fav: false,
        createdAt: todayKey()
      };
    });

    var qs = s.quotes.map(function (q) { return { id: uid('q'), text: q.text, from: q.from || '佚名', custom: false }; });

    return {
      version: 1,
      seedRev: SEED_REV,
      createdAt: todayKey(),
      updatedAt: todayKey(),
      ingredients: ings,
      recipes: recs,
      quotes: qs,
      weeks: {},
      currentWeek: weekStartOf(todayKey()),
      usage: {},
      favs: [],
      settings: defaultSettings()
    };
  }

  /* ---------------- 内置数据增量升级（只补不改） ----------------
   * 旧设备本地库不会重灌种子，这里按 SEED_REV 逐级补齐：
   *  1) 缺哪条内置食材就补哪条，已存在的不动（不覆盖你的修改）
   *  2) 内置菜谱的食材变更，只在「内容仍是旧版原样」时才替换
   * 返回实际改动条数，0 表示无需升级。
   */
  var SEED_REV = window.SEED_REV || 1;

  function applySeedPatch() {
    var from = DB.seedRev || 1;
    if (from >= SEED_REV) return 0;
    var changed = 0;

    // 1) 补齐缺失的内置食材
    var taken = {};
    DB.ingredients.forEach(function (i) {
      taken[i.name] = 1;
      (i.alias || []).forEach(function (a) { taken[a] = 1; });
    });
    ((window.SEED && window.SEED.ingredients) || []).forEach(function (x) {
      if (taken[x.name]) return;
      DB.ingredients.push(Object.assign({ id: uid('ing'), source: 'seed', createdAt: todayKey() }, x));
      changed++;
    });

    // 2) 应用迁移规则
    (window.SEED_MIGRATIONS || []).forEach(function (mig) {
      if (from >= (mig.rev || 1)) return;
      var m = mig.match || {};
      var r = DB.recipes.filter(function (x) { return x.name === m.recipe; })[0];
      if (!r) return;
      var now = (r.ingredients || []).map(function (i) { return i.name; }).join('|');
      if (now !== (m.ingredients || []).join('|')) return; // 用户改过了，跳过
      r.ingredients = ((mig.apply || {}).ingredients || []).map(function (i) {
        var ing = findIngredient(i.name);
        return { name: i.name, amount: i.amount || '', ingId: ing ? ing.id : '' };
      });
      changed++;
    });

    DB.seedRev = SEED_REV;
    return changed;
  }

  var saveTimer = null;
  function serialize() {
    // plan 只是 weeks[currentWeek] 的指针，不重复写入
    return JSON.stringify(DB, function (k, v) { return k === 'plan' ? undefined : v; });
  }
  function save(immediate) {
    DB.updatedAt = todayKey();
    if (memOnly) return false;
    var doIt = function () {
      try { localStorage.setItem(KEY, serialize()); return true; }
      catch (e) { console.warn('保存失败', e); return false; }
    };
    if (immediate) { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } return doIt(); }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; doIt(); }, 120);
    return true;
  }

  /* ---------------- 角色推断 ---------------- */
  var MAIN_MEAT = ['猪', '牛', '羊', '鸡腿', '鸡翅', '鸡肉', '鸡胸', '鸭', '鱼', '虾', '肉', '排骨', '腩', '三文鱼', '鲈鱼', '火腿', '培根'];
  var EGG_BEAN = ['鸡蛋', '蛋', '豆腐', '豆干', '腐竹', '豆浆'];
  function guessRole(name, ingNames) {
    var n = name || '';
    var ings = (ingNames || []).join('/');
    if (/粥|豆浆|吐司|三明治|煎蛋|水煮蛋/.test(n)) return '早餐';
    if (/汤$|羹/.test(n)) return '汤';
    if (/饭|面|馒头|饺子|包子|花卷|饼|红薯|玉米|燕麦/.test(n)) return '主食';
    var meat = MAIN_MEAT.some(function (k) { return ings.indexOf(k) >= 0; });
    if (meat) return '主荤';
    var eb = EGG_BEAN.some(function (k) { return ings.indexOf(k) >= 0; });
    if (eb) return '半荤';
    return '素菜';
  }

  /* ---------------- 食材 ---------------- */
  function listIngredients() { return DB.ingredients; }
  function findIngredient(kw) {
    if (!kw) return null;
    var k = String(kw).trim();
    var byId = DB.ingredients.filter(function (i) { return i.id === k; })[0];
    if (byId) return byId;
    var exact = DB.ingredients.filter(function (i) { return i.name === k; })[0];
    if (exact) return exact;
    var alias = DB.ingredients.filter(function (i) { return (i.alias || []).indexOf(k) >= 0; })[0];
    if (alias) return alias;
    return DB.ingredients.filter(function (i) { return i.name.indexOf(k) >= 0 || k.indexOf(i.name) >= 0; })[0] || null;
  }
  function ensureIngredient(name) {
    var f = findIngredient(name);
    if (f) return f;
    var ing = {
      id: uid('ing'), name: String(name).trim(), alias: [], cat: '其他',
      kcal: null, protein: null, fat: null, carb: null, fiber: null,
      fn: [], tip: '', source: 'auto', createdAt: todayKey()
    };
    DB.ingredients.push(ing);
    return ing;
  }
  function upsertIngredient(data) {
    if (!data.id) delete data.id; // 防止 id: undefined 覆盖掉自动生成的 id
    if (data.id) {
      var cur = DB.ingredients.filter(function (i) { return i.id === data.id; })[0];
      if (cur) { Object.assign(cur, data); save(); return cur; }
    }
    var byName = DB.ingredients.filter(function (i) { return i.name === data.name; })[0];
    if (byName) { Object.assign(byName, data, { id: byName.id }); save(); return byName; }
    var ing = Object.assign({
      id: uid('ing'), alias: [], cat: '其他', kcal: null, protein: null, fat: null, carb: null,
      fiber: null, fn: [], tip: '', source: 'user', createdAt: todayKey()
    }, data);
    DB.ingredients.push(ing);
    save();
    return ing;
  }
  function removeIngredient(id) {
    DB.ingredients = DB.ingredients.filter(function (i) { return i.id !== id; });
    save(true);
  }
  function ingredientCategories() {
    var order = ['蔬菜', '肉蛋', '豆乳', '主食', '菌藻', '水果', '坚果', '调味', '其他'];
    var set = {};
    DB.ingredients.forEach(function (i) { set[i.cat || '其他'] = 1; });
    var arr = order.filter(function (c) { return set[c]; });
    Object.keys(set).forEach(function (c) { if (arr.indexOf(c) < 0) arr.push(c); });
    return arr;
  }

  /* ---------------- 菜谱 ---------------- */
  function listRecipes() { return DB.recipes; }
  function getRecipe(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    return DB.recipes.filter(function (r) { return r.id === id; })[0] || null;
  }
  function upsertRecipe(data) {
    if (!data.id) delete data.id; // 防止 id: undefined 覆盖掉自动生成的 id
    var names = (data.ingredients || []).map(function (i) { return i.name; });
    data.ingredients = (data.ingredients || []).map(function (i) {
      var ing = findIngredient(i.name);
      return { name: i.name, amount: i.amount || '', ingId: ing ? ing.id : '' };
    });
    if (!data.role) data.role = guessRole(data.name, names);
    if (!data.mealTypes || !data.mealTypes.length) data.mealTypes = ['lunch', 'dinner'];

    if (data.id) {
      var cur = getRecipe(data.id);
      if (cur) { Object.assign(cur, data); save(); return cur; }
    }
    var rec = Object.assign({
      id: uid('rec'), tags: [], seasonings: [], steps: '', note: '',
      source: 'user', fav: false, createdAt: todayKey()
    }, data);
    DB.recipes.push(rec);
    // 自动补齐未登记的食材
    names.forEach(function (n) { if (n) ensureIngredient(n); });
    save();
    return rec;
  }
  function removeRecipe(id) {
    DB.recipes = DB.recipes.filter(function (r) { return r.id !== id; });
    DB.favs = DB.favs.filter(function (f) { return f !== id; });
    delete DB.usage[id];
    Object.keys(DB.weeks || {}).forEach(function (w) {
      var days = DB.weeks[w] || {};
      Object.keys(days).forEach(function (d) {
        MEALS.forEach(function (m) {
          var slot = days[d][m];
          if (slot && slot.ids) slot.ids = slot.ids.filter(function (x) { return x !== id; });
        });
      });
    });
    save(true);
  }
  function toggleFav(id) {
    var r = getRecipe(id);
    if (!r) return;
    r.fav = !r.fav;
    save();
    return r.fav;
  }
  /** 菜谱拆解：返回每味食材 + 其营养功能 */
  function decompose(recipe) {
    var r = getRecipe(recipe);
    if (!r) return [];
    return (r.ingredients || []).map(function (it) {
      var ing = it.ingId ? findIngredient(it.ingId) : findIngredient(it.name);
      return {
        name: it.name,
        amount: it.amount,
        cat: ing ? ing.cat : '其他',
        fn: ing ? (ing.fn || []) : [],
        kcal: ing ? ing.kcal : null,
        tip: ing ? ing.tip : '',
        known: !!(ing && (ing.fn || []).length)
      };
    });
  }

  /* ---------------- 金句 ---------------- */
  function listQuotes() { return DB.quotes; }
  function quoteOfDay(key) {
    if (!DB.quotes.length) return { text: '今天也要好好吃饭。', from: '柚柚' };
    return DB.quotes[hash(key || todayKey()) % DB.quotes.length];
  }
  function addQuote(text, from) {
    var q = { id: uid('q'), text: String(text).trim(), from: (from || '佚名').trim(), custom: true };
    DB.quotes.push(q);
    save();
    return q;
  }
  function removeQuote(id) {
    DB.quotes = DB.quotes.filter(function (q) { return q.id !== id; });
    save(true);
  }

  /* ---------------- 周计划 ---------------- */
  var MEALS = ['breakfast', 'lunch', 'dinner'];
  var MEAL_CN = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };

  function getPlan() { return DB.plan; }
  function weekKeys(weekStart) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(weekStart, i));
    return out;
  }
  function ensureWeek(weekStart) {
    bindWeek(weekStart || DB.currentWeek || weekStartOf(todayKey()));
    save();
    return DB.plan;
  }
  function allPlannedIds(excludeDate, excludeMeal) {
    var set = {};
    Object.keys(DB.plan.days || {}).forEach(function (d) {
      MEALS.forEach(function (m) {
        if (d === excludeDate && m === excludeMeal) return;
        (DB.plan.days[d][m].ids || []).forEach(function (id) { set[id] = 1; });
      });
    });
    return set;
  }

  function avoided(recipe) {
    var kw = (DB.settings.avoid || '').split(/[,，、\s]+/).filter(Boolean);
    if (!kw.length) return false;
    var txt = (recipe.name || '') + '|' + (recipe.ingredients || []).map(function (i) { return i.name; }).join('|');
    return kw.some(function (k) { return txt.indexOf(k) >= 0; });
  }

  function poolFor(meal) {
    return DB.recipes.filter(function (r) {
      if (avoided(r)) return false;
      if (meal === 'breakfast') return (r.mealTypes || []).indexOf('breakfast') >= 0 || r.role === '早餐';
      return (r.mealTypes || []).indexOf(meal) >= 0 || (r.role !== '早餐' && (r.mealTypes || []).indexOf('breakfast') < 0);
    });
  }

  function weightOf(r, ctx) {
    var w = 1;
    var last = DB.usage[r.id];
    if (last) {
      var d = daysBetween(last, ctx.today);
      if (d <= 3) w *= 0.06;
      else if (d <= 7) w *= 0.28;
      else if (d <= 14) w *= 0.65;
    }
    // 本次生成中已用过越多次，权重越低 —— 让菜色尽量摊开
    var used = (ctx.count && ctx.count[r.id]) || 0;
    if (used) w *= 1 / (1 + 2.5 * used);
    if (r.fav) w *= 1.5;
    return w;
  }

  function pickOne(pool, banSet, ctx) {
    var cands = pool.filter(function (r) { return !banSet[r.id]; });
    if (!cands.length) cands = pool.slice();
    if (!cands.length) return null;
    // 1) 本周没用过的优先
    if (ctx.noRepeat) {
      var fresh = cands.filter(function (r) { return !ctx.usedWeek[r.id]; });
      if (fresh.length) cands = fresh;
    }
    // 2) 本次生成里用得最少的优先 —— 等价于洗牌后的轮转，保证摊得开
    var counts = ctx.count || {};
    var minC = Infinity;
    cands.forEach(function (r) { var c = counts[r.id] || 0; if (c < minC) minC = c; });
    var tier = cands.filter(function (r) { return (counts[r.id] || 0) === minC; });
    if (!tier.length) tier = cands;
    // 3) 同一档里按"最近吃过"和收藏加权
    var total = 0, scored = tier.map(function (r) { var w = weightOf(r, ctx); total += w; return { r: r, w: w }; });
    if (!total) return tier[Math.floor(Math.random() * tier.length)];
    var x = Math.random() * total;
    for (var i = 0; i < scored.length; i++) { x -= scored[i].w; if (x <= 0) return scored[i].r; }
    return scored[scored.length - 1].r;
  }

  function pickByRole(pool, role, banSet, ctx) {
    var sub = pool.filter(function (r) { return r.role === role; });
    if (!sub.length) return null;
    return pickOne(sub, banSet, ctx);
  }

  function buildMeal(meal, banSet, ctx) {
    var pool = poolFor(meal);
    var out = [];
    var localBan = Object.assign({}, banSet);
    if (!ctx.count) ctx.count = {};
    function take(r) {
      if (!r) return;
      if (out.some(function (x) { return x.id === r.id; })) return;
      out.push(r);
      localBan[r.id] = 1;
      ctx.usedWeek[r.id] = 1;
      ctx.count[r.id] = (ctx.count[r.id] || 0) + 1;
    }
    var n = DB.settings.perMeal[meal] || 3;
    if (meal === 'breakfast') {
      for (var i = 0; i < n; i++) take(pickOne(pool, localBan, ctx));
    } else {
      take(pickByRole(pool, '主食', localBan, ctx));
      // 荤菜：主荤与半荤放在同一个池子里轮转，否则半荤永远排不上
      var meatPool = pool.filter(function (r) { return r.role === '主荤' || r.role === '半荤'; });
      take(meatPool.length ? pickOne(meatPool, localBan, ctx) : null);
      var vegNeed = Math.max(0, n - out.length);
      for (var v = 0; v < vegNeed; v++) {
        take(pickByRole(pool, '素菜', localBan, ctx) || pickOne(pool, localBan, ctx));
      }
      if (DB.settings.withSoup) take(pickByRole(pool, '汤', localBan, ctx));
      // 数量不足时兜底补全
      var guard = 0;
      while (out.length < n && guard++ < 8) take(pickOne(pool, localBan, ctx));
    }
    return out.map(function (r) { return r.id; });
  }

  /** 生成一周食谱。keepLocked=true 时保留已锁定的餐次 */
  function generateWeek(weekStart, opts) {
    opts = opts || {};
    var ws = weekStart || DB.plan.weekStart || weekStartOf(todayKey());
    ensureWeek(ws);
    var ctx = { today: todayKey(), usedWeek: {}, noRepeat: DB.settings.noRepeatInWeek !== false };
    var days = DB.plan.days;

    // 锁定餐次先占位，且计入"本周已用"
    weekKeys(ws).forEach(function (d) {
      MEALS.forEach(function (m) {
        var slot = days[d][m];
        if (slot.locked && slot.ids.length) slot.ids.forEach(function (id) { ctx.usedWeek[id] = 1; });
      });
    });

    weekKeys(ws).forEach(function (d) {
      MEALS.forEach(function (m) {
        var slot = days[d][m];
        if (slot.locked && slot.ids.length) return;
        if (opts.onlyEmpty && slot.ids.length) return;
        // 同一天三顿互不重复
        var ban = {};
        MEALS.forEach(function (mm) {
          if (mm === m) return;
          (days[d][mm].ids || []).forEach(function (id) { ban[id] = 1; });
        });
        var ids = buildMeal(m, ban, ctx);
        slot.ids = ids;
        ids.forEach(function (id) { DB.usage[id] = d; });
      });
    });
    save(true);
    return DB.plan;
  }

  function swapMeal(dateKey, meal) {
    var days = daysFor(dateKey);
    var slot = days[dateKey][meal];
    var ban = allPlannedIds(dateKey, meal);
    slot.ids.forEach(function (id) { ban[id] = 1; });
    var ctx = { today: todayKey(), usedWeek: Object.assign({}, allPlannedIds(dateKey, meal)), noRepeat: DB.settings.noRepeatInWeek !== false };
    var ids = buildMeal(meal, ban, ctx);
    slot.ids = ids;
    ids.forEach(function (id) { DB.usage[id] = dateKey; });
    save(true);
    return slot;
  }

  function setMeal(dateKey, meal, ids) {
    var days = daysFor(dateKey);
    days[dateKey][meal].ids = ids.slice();
    save(true);
  }
  /** 拿到某个日期所属那一周的可写数据（必要时切换并补齐整周） */
  function daysFor(dateKey) {
    var ws = weekStartOf(dateKey);
    if (DB.currentWeek !== ws || !DB.weeks[ws] || !DB.weeks[ws][dateKey]) bindWeek(ws);
    return DB.weeks[ws];
  }
  function addToMeal(dateKey, meal, id) {
    var days = daysFor(dateKey);
    var slot = days[dateKey][meal];
    if (slot.ids.indexOf(id) < 0) slot.ids.push(id);
    save(true);
  }
  function removeFromMeal(dateKey, meal, id) {
    var days = daysFor(dateKey);
    var slot = days[dateKey][meal];
    slot.ids = slot.ids.filter(function (x) { return x !== id; });
    save(true);
  }
  function toggleLock(dateKey, meal) {
    var days = daysFor(dateKey);
    var slot = days[dateKey][meal];
    slot.locked = !slot.locked;
    save(true);
    return slot.locked;
  }
  function clearWeek() {
    // 注意：必须换掉 DB.weeks 里的那一格再重新绑定，不能只改 plan.days 的引用
    DB.weeks[DB.currentWeek] = {};
    bindWeek(DB.currentWeek);
    save(true);
  }
  function moveWeek(delta) {
    var ws = weekStartOf(addDays(DB.plan.weekStart, delta * 7));
    ensureWeek(ws);
    save(true);
    return ws;
  }

  /** 今天吃什么：为今天生成三餐（保留已锁定） */
  function generateToday(meal) {
    var t = todayKey();
    ensureWeek(weekStartOf(t));
    var days = DB.plan.days;
    if (!days[t]) {
      days[t] = { breakfast: { ids: [], locked: false }, lunch: { ids: [], locked: false }, dinner: { ids: [], locked: false } };
    }
    var ctx = { today: t, usedWeek: {}, noRepeat: false };
    var list = meal ? [meal] : MEALS.slice();
    // 不在本次生成范围内的餐次，仍然参与"同一天不重样"的判断
    var settled = {};
    MEALS.forEach(function (m) { if (list.indexOf(m) < 0) settled[m] = true; });
    list.forEach(function (m) {
      if (days[t][m].locked && days[t][m].ids.length) { settled[m] = true; return; }
      var ban = {};
      MEALS.forEach(function (mm) {
        if (mm === m || !settled[mm]) return;
        (days[t][mm].ids || []).forEach(function (id) { ban[id] = 1; });
      });
      var ids = buildMeal(m, ban, ctx);
      days[t][m].ids = ids;
      settled[m] = true;
      ids.forEach(function (id) { DB.usage[id] = t; });
    });
    save(true);
    return days[t];
  }

  /* ---------------- 购物清单 ---------------- */
  function shoppingList() {
    var days = DB.plan.days || {};
    var map = {};
    weekKeys(DB.plan.weekStart).forEach(function (d) {
      MEALS.forEach(function (m) {
        var slot = days[d] && days[d][m];
        if (!slot) return;
        slot.ids.forEach(function (id) {
          var r = getRecipe(id);
          if (!r) return;
          (r.ingredients || []).forEach(function (it) {
            var ing = it.ingId ? findIngredient(it.ingId) : findIngredient(it.name);
            var key = ing ? ing.name : it.name;
            if (!map[key]) map[key] = { name: key, cat: ing ? ing.cat : '其他', count: 0, amounts: [], dishes: [] };
            map[key].count++;
            if (it.amount) map[key].amounts.push(it.amount);
            if (map[key].dishes.indexOf(r.name) < 0) map[key].dishes.push(r.name);
          });
        });
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    var order = ['蔬菜', '肉蛋', '豆乳', '主食', '菌藻', '水果', '坚果', '调味', '其他'];
    arr.sort(function (a, b) {
      var ia = order.indexOf(a.cat), ib = order.indexOf(b.cat);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib || b.count - a.count;
    });
    return arr;
  }

  /* ---------------- 导入解析 ---------------- */
  var MEAL_ALIAS = {
    '早餐': 'breakfast', '早饭': 'breakfast', '早': 'breakfast', 'breakfast': 'breakfast', 'br': 'breakfast',
    '午餐': 'lunch', '午饭': 'lunch', '中': 'lunch', 'lunch': 'lunch', 'ln': 'lunch',
    '晚餐': 'dinner', '晚饭': 'dinner', '晚': 'dinner', 'dinner': 'dinner', 'dn': 'dinner'
  };
  function normMeal(v) {
    var out = [];
    String(v || '').split(/[,，、\/;；|]+/).forEach(function (x) {
      var k = x.trim().toLowerCase();
      var m = MEAL_ALIAS[k] || MEAL_ALIAS[x.trim()];
      if (m && out.indexOf(m) < 0) out.push(m);
    });
    return out;
  }
  function splitList(v) {
    return String(v || '').split(/[,，、;；|\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function parseIngItem(str) {
    var s = String(str).trim();
    if (!s) return null;
    var m = s.match(/^(.+?)\s*([\d].*|[一二三四五六七八九十半两]+.*|少许|适量|若干|小半.*|一大把.*)$/);
    if (m && m[2] && m[2] !== m[1]) return { name: m[1].trim(), amount: m[2].trim() };
    var sp = s.split(/\s+/);
    if (sp.length >= 2) return { name: sp[0], amount: sp.slice(1).join(' ') };
    return { name: s, amount: '' };
  }

  /** 解析结构化文本（一次可以写多道菜 + 多条食材定义） */
  function parseText(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var recipes = [], ingredients = [], cur = null, curIng = null, lastField = null;
    var FIELD_MAP = {
      '餐次': 'meal', 'meal': 'meal',
      '类型': 'role', '角色': 'role', 'role': 'role',
      '食材': 'ingredients', '主料': 'ingredients', '原料': 'ingredients',
      '调料': 'seasonings', '调味': 'seasonings',
      '做法': 'steps', '步骤': 'steps', 'steps': 'steps',
      '说明': 'note', '备注': 'note', 'note': 'note',
      '标签': 'tags', 'tags': 'tags',
      '分类': 'cat', 'cat': 'cat', 'category': 'cat',
      '功能': 'fn', '营养功能': 'fn', '功效': 'fn',
      '营养': 'nutrition', 'nutrition': 'nutrition',
      '贴士': 'tip', '小贴士': 'tip', 'tip': 'tip'
    };

    function flushRecipe() { if (cur) { recipes.push(cur); cur = null; } }
    function flushIng() { if (curIng) { ingredients.push(curIng); curIng = null; } }

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (line.indexOf('#') === 0) {           // # 菜名
        flushRecipe(); flushIng();
        cur = { name: line.replace(/^#+\s*/, '').trim(), mealTypes: [], tags: [], ingredients: [], seasonings: [], steps: '', note: '', role: '' };
        lastField = null;
        return;
      }
      if (/^@\s*(食材|ingredient)/i.test(line)) { // @食材 名称
        flushRecipe(); flushIng();
        curIng = { name: line.replace(/^@\s*(食材|ingredient)\s*/i, '').trim(), fn: [], alias: [] };
        lastField = null;
        return;
      }
      var kv = line.match(/^([^:：]{1,6})\s*[:：]\s*(.*)$/);
      if (kv && FIELD_MAP[kv[1].trim().toLowerCase()]) {
        var field = FIELD_MAP[kv[1].trim().toLowerCase()];
        var val = kv[2].trim();
        if (curIng && ['cat', 'fn', 'nutrition', 'tip', 'name'].indexOf(field) >= 0) {
          applyIngField(curIng, field, val); lastField = field; return;
        }
        if (!cur) { cur = { name: '未命名菜谱', mealTypes: [], tags: [], ingredients: [], seasonings: [], steps: '', note: '', role: '' }; }
        applyRecipeField(cur, field, val); lastField = field; return;
      }
      // 续行
      if (curIng && lastField) { applyIngField(curIng, lastField, line, true); return; }
      if (cur && lastField) { applyRecipeField(cur, lastField, line, true); return; }
      if (cur && !cur.ingredients.length) { cur.ingredients.push(parseIngItem(line)); return; }
      if (!cur && !curIng) { recipes.push({ name: line, mealTypes: [], tags: [], ingredients: [], seasonings: [], steps: '', note: '', role: '' }); cur = recipes[recipes.length - 1]; }
    });
    flushRecipe(); flushIng();
    return { recipes: cleanRecipes(recipes), ingredients: ingredients };
  }

  function applyRecipeField(r, field, val, append) {
    if (field === 'meal') r.mealTypes = normMeal(val);
    else if (field === 'ingredients') {
      if (append) { var it = parseIngItem(val); if (it) r.ingredients.push(it); }
      else splitList(val).forEach(function (s) { var it = parseIngItem(s); if (it) r.ingredients.push(it); });
    }
    else if (field === 'seasonings') r.seasonings = splitList(val);
    else if (field === 'tags') r.tags = splitList(val);
    else if (field === 'steps' || field === 'note') r[field] = r[field] ? r[field] + '\n' + val : val;
    else if (field === 'role') r.role = val;
    else if (field === 'name') r.name = val;
  }

  function applyIngField(ing, field, val, append) {
    if (field === 'cat') ing.cat = val;
    else if (field === 'fn') {
      splitList(val).forEach(function (s) { ing.fn.push(s); });
      if (append) splitList(val).forEach(function () {});
    }
    else if (field === 'tip') ing.tip = ing.tip ? ing.tip + ' ' + val : val;
    else if (field === 'nutrition') {
      var kcal = val.match(/([\d.]+)\s*(kcal|千卡|卡)/i);
      var pro = val.match(/(?:蛋白|protein)[^\d]*([\d.]+)/i);
      var fat = val.match(/(?:脂肪|fat)[^\d]*([\d.]+)/i);
      var carb = val.match(/(?:碳水|carb)[^\d]*([\d.]+)/i);
      var fib = val.match(/(?:纤维|fiber)[^\d]*([\d.]+)/i);
      if (kcal) ing.kcal = parseFloat(kcal[1]);
      if (pro) ing.protein = parseFloat(pro[1]);
      if (fat) ing.fat = parseFloat(fat[1]);
      if (carb) ing.carb = parseFloat(carb[1]);
      if (fib) ing.fiber = parseFloat(fib[1]);
    }
    else if (field === 'name') ing.name = val;
  }

  function cleanRecipes(arr) {
    return arr.filter(function (r) { return r.name && r.name !== '未命名菜谱'; })
      .map(function (r) {
        if (!r.mealTypes.length) r.mealTypes = ['lunch', 'dinner'];
        r.ingredients = r.ingredients.filter(Boolean);
        return r;
      });
  }

  /** 解析 CSV（首行表头，支持中英文列名，逗号/引号按 RFC4180） */
  function parseCSV(text) {
    var rows = csvRows(text);
    if (!rows.length) return { recipes: [], ingredients: [] };
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = function () {
      for (var i = 0; i < arguments.length; i++) {
        var k = head.indexOf(String(arguments[i]).toLowerCase());
        if (k >= 0) return k;
      }
      return -1;
    };
    var iName = idx('菜名', '名称', 'name', 'recipe');
    var iMeal = idx('餐次', 'meal', 'mealtype');
    var iRole = idx('类型', '角色', 'role');
    var iIng = idx('食材', '主料', '配料', 'ingredients');
    var iSeason = idx('调料', 'seasonings');
    var iSteps = idx('做法', '步骤', 'steps');
    var iNote = idx('说明', '备注', 'note');
    var iTags = idx('标签', 'tags');
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row.length || !row[iName === -1 ? 0 : iName]) continue;
      var ingStr = iIng >= 0 ? row[iIng] || '' : '';
      out.push({
        name: (row[iName === -1 ? 0 : iName] || '').trim(),
        mealTypes: iMeal >= 0 ? normMeal(row[iMeal]) : ['lunch', 'dinner'],
        role: iRole >= 0 ? (row[iRole] || '').trim() : '',
        ingredients: splitList(ingStr.replace(/\|/g, ' ')).map(parseIngItem).filter(Boolean),
        seasonings: iSeason >= 0 ? splitList(row[iSeason]) : [],
        steps: iSteps >= 0 ? (row[iSteps] || '') : '',
        note: iNote >= 0 ? (row[iNote] || '') : '',
        tags: iTags >= 0 ? splitList(row[iTags]) : []
      });
    }
    return { recipes: cleanRecipes(out), ingredients: [] };
  }

  function csvRows(text) {
    var rows = [], row = [], cell = '', q = false;
    text = String(text).replace(/\r\n?/g, '\n');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
  }

  /** 自动识别格式并导入 */
  function autoParse(text) {
    var t = String(text).trim();
    if (!t) return { kind: 'empty', recipes: [], ingredients: [], quotes: [] };
    if (t[0] === '{' || t[0] === '[') {
      try {
        var j = JSON.parse(t);
        if (Array.isArray(j)) return { kind: 'json-array', recipes: j, ingredients: [] };
        return {
          kind: 'json-backup',
          recipes: j.recipes || [], ingredients: j.ingredients || [],
          quotes: j.quotes || [], settings: j.settings || null,
          weeks: j.weeks || null, usage: j.usage || null,
          seedRev: j.seedRev || 1
        };
      } catch (e) { /* 落到文本解析 */ }
    }
    var firstLine = t.split('\n')[0];
    if ((firstLine.match(/,/g) || []).length >= 1 &&
        /(菜名|名称|name|recipe)/i.test(firstLine)) {
      var csv = parseCSV(t);
      return { kind: 'csv', recipes: csv.recipes, ingredients: [] };
    }
    var p = parseText(t);
    return { kind: 'text', recipes: p.recipes, ingredients: p.ingredients, quotes: [] };
  }

  /** 执行导入。mode: 'merge' | 'replace' */
  function doImport(parsed, mode) {
    if (mode === 'replace') {
      DB.recipes = []; DB.ingredients = []; if (parsed.quotes && parsed.quotes.length) DB.quotes = [];
      DB.weeks = {}; DB.usage = {}; bindWeek(weekStartOf(todayKey()));
    }
    var stat = { ingredients: 0, recipes: 0, quotes: 0, recipesSkipped: 0 };
    // 1) 食材（含营养功能）
    (parsed.ingredients || []).forEach(function (src) {
      var name = (src.name || '').trim();
      if (!name) return;
      var exist = findIngredient(name);
      if (exist) {
        var patch = {};
        ['cat', 'kcal', 'protein', 'fat', 'carb', 'fiber', 'tip'].forEach(function (k) {
          if (src[k] !== undefined && src[k] !== '' && src[k] !== null && patch[k] === undefined) patch[k] = src[k];
        });
        // 种子数据的功能说明优先保留，用户新增的追加
        if (src.fn && src.fn.length) {
          var merged = (exist.fn || []).slice();
          src.fn.forEach(function (f) { if (merged.indexOf(f) < 0) merged.push(f); });
          patch.fn = merged;
        }
        if (src.alias && src.alias.length) {
          var al = (exist.alias || []).slice();
          src.alias.forEach(function (a) { if (al.indexOf(a) < 0) al.push(a); });
          patch.alias = al;
        }
        Object.assign(exist, patch);
      } else {
        upsertIngredient({
          name: name, alias: src.alias || [], cat: src.cat || '其他',
          kcal: src.kcal === undefined ? null : src.kcal,
          protein: src.protein === undefined ? null : src.protein,
          fat: src.fat === undefined ? null : src.fat,
          carb: src.carb === undefined ? null : src.carb,
          fiber: src.fiber === undefined ? null : src.fiber,
          fn: src.fn || [], tip: src.tip || '', source: 'import'
        });
        stat.ingredients++;
      }
    });
    // 2) 菜谱
    (parsed.recipes || []).forEach(function (src) {
      var name = (src.name || '').trim();
      if (!name) return;
      var exist = DB.recipes.filter(function (r) { return r.name === name; })[0];
      if (exist && mode === 'merge') { stat.recipesSkipped++; return; }
      var obj = {
        name: name,
        mealTypes: src.mealTypes && src.mealTypes.length ? src.mealTypes : ['lunch', 'dinner'],
        role: src.role || '',
        tags: src.tags || [],
        ingredients: (src.ingredients || []).map(function (i) {
          return typeof i === 'string' ? parseIngItem(i) : { name: i.name, amount: i.amount || '', ingId: i.ingId || '' };
        }).filter(Boolean),
        seasonings: src.seasonings || [],
        steps: src.steps || '',
        note: src.note || '',
        fav: !!src.fav,
        source: src.source || 'import'
      };
      // 只有确实有 id 时才赋值：写成 id: undefined 会覆盖掉自动生成的 id
      if (src.id) obj.id = src.id;
      else if (exist && mode !== 'merge') obj.id = exist.id;
      upsertRecipe(obj);
      stat.recipes++;
    });
    // 3) 金句
    (parsed.quotes || []).forEach(function (q) {
      if (!q || !q.text) return;
      if (DB.quotes.some(function (x) { return x.text === q.text; })) return;
      DB.quotes.push({ id: uid('q'), text: q.text, from: q.from || '佚名', custom: true });
      stat.quotes++;
    });
    if (parsed.settings && mode === 'replace') {
      DB.settings = Object.assign(defaultSettings(), parsed.settings);
    }
    if (parsed.weeks && mode === 'replace') {
      DB.weeks = parsed.weeks;
      if (parsed.usage) DB.usage = parsed.usage;
      bindWeek(DB.currentWeek);
    }
    // 恢复的备份可能来自旧版本：回退版本号后重新体检一次，缺的补、改过的保留
    DB.seedRev = Math.min(DB.seedRev || 1, parsed.seedRev || 1);
    applySeedPatch();
    save(true);
    return stat;
  }

  function exportData() {
    return {
      app: '柚柚今天吃什么',
      exportAt: new Date().toISOString(),
      version: 1,
      seedRev: DB.seedRev || 1,
      ingredients: DB.ingredients,
      recipes: DB.recipes,
      quotes: DB.quotes,
      settings: DB.settings,
      weeks: DB.weeks,
      currentWeek: DB.currentWeek,
      usage: DB.usage
    };
  }

  function clearAll(what) {
    if (what === 'plan') { DB.weeks[DB.currentWeek] = {}; bindWeek(DB.currentWeek); }
    if (what === 'recipes') { DB.recipes = []; }
    if (what === 'ingredients') { DB.ingredients = []; }
    if (what === 'all') {
      var fresh = seedData();
      Object.keys(fresh).forEach(function (k) { DB[k] = fresh[k]; });
      bindWeek(DB.currentWeek);
    }
    save(true);
    return DB;
  }

  function stats() {
    var days = DB.plan.days || {};
    return {
      recipes: DB.recipes.length,
      ingredients: DB.ingredients.length,
      quotes: DB.quotes.length,
      planned: Object.keys(days).reduce(function (n, d) {
        return n + MEALS.reduce(function (m, mm) { return m + ((days[d][mm].ids || []).length ? 1 : 0); }, 0);
      }, 0),
      memOnly: memOnly,
      updatedAt: DB.updatedAt,
      createdAt: DB.createdAt
    };
  }

  function setSettings(patch) {
    DB.settings = Object.assign({}, DB.settings, patch || {});
    save(true);
    return DB.settings;
  }

  return {
    init: init, save: save, getDB: function () { return DB; },
    uid: uid, esc: esc, fmt: fmt, todayKey: todayKey, addDays: addDays, weekStartOf: weekStartOf,
    weekdayCn: weekdayCn, parseDate: parseDate, daysBetween: daysBetween, weekKeys: weekKeys,
    MEALS: MEALS, MEAL_CN: MEAL_CN,
    guessRole: guessRole,
    listIngredients: listIngredients, findIngredient: findIngredient, ensureIngredient: ensureIngredient,
    upsertIngredient: upsertIngredient, removeIngredient: removeIngredient, ingredientCategories: ingredientCategories,
    listRecipes: listRecipes, getRecipe: getRecipe, upsertRecipe: upsertRecipe, removeRecipe: removeRecipe,
    toggleFav: toggleFav, decompose: decompose,
    listQuotes: listQuotes, quoteOfDay: quoteOfDay, addQuote: addQuote, removeQuote: removeQuote,
    getPlan: getPlan, ensureWeek: ensureWeek, generateWeek: generateWeek, generateToday: generateToday,
    swapMeal: swapMeal, setMeal: setMeal, addToMeal: addToMeal, removeFromMeal: removeFromMeal,
    toggleLock: toggleLock, clearWeek: clearWeek, moveWeek: moveWeek, shoppingList: shoppingList,
    autoParse: autoParse, importData: doImport, exportData: exportData, clearAll: clearAll,
    stats: stats, setSettings: setSettings, defaultSettings: defaultSettings
  };
})();
