/* ============================================================
 * 柚柚今天吃什么 · 界面与交互
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = Store.esc;
  var MEAL_EMOJI = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' };
  var ROLE_LIST = ['主食', '主荤', '半荤', '素菜', '汤', '早餐', '甜点'];
  var CAT_LIST = ['蔬菜', '肉蛋', '豆制品', '主食', '菌藻', '水果', '坚果', '饮品', '调味', '其他'];

  /* 把做法文本拆成步骤数组。数据里存的是一个字符串（导入导出都按字符串走），
   * 这里只负责读的时候排版，不改数据格式。
   * 能吃下的写法：
   *   "1. 甲\n2. 乙"      → ['甲','乙']
   *   "1. 甲 2. 乙"        → ['甲','乙']      （整段挤在一行）
   *   "洗净\n切块\n下锅"    → ['洗净','切块','下锅']  （没编号就按行）
   *   没编号但有换行的续行  → 并进上一步
   */
  function parseSteps(s) {
    s = (s || '').trim();
    if (!s) return [];
    var lines = s.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!lines.length) return [];
    var NUM = /^\d+\s*[.、)）．]\s*/;                 // 行首编号
    var INLINE = /\d+\s*[.、)）．]\s\S/;              // 行内还有编号（要求编号后有空格，免得把 0.5 这种小数切开）

    // 整段挤在一行、里面塞了多个编号："1. 甲 2. 乙 3. 丙" → 先按编号切
    if (lines.length === 1 && INLINE.test(lines[0])) {
      var parts = lines[0].split(/\s*(?=\d+\s*[.、)）．]\s)/)
        .map(function (x) { return x.trim(); }).filter(Boolean);
      if (parts.length > 1) return parts.map(function (x) { return x.replace(NUM, ''); });
    }

    var hasNum = lines.some(function (ln) { return NUM.test(ln); });
    if (!hasNum) return lines;                        // 没编号就按行当步骤

    var out = [];
    lines.forEach(function (ln) {
      if (NUM.test(ln)) out.push(ln.replace(NUM, ''));
      else if (out.length) out[out.length - 1] += ' ' + ln;   // 续行并进上一步
      else out.push(ln);
    });
    return out;
  }

  function stepCount(s) { return parseSteps(s).length; }

  var state = {
    view: 'today',
    recipeFilter: 'all',
    ingFilter: 'all',
    recipeQuery: '',
    ingQuery: '',
    weekSub: 'plan',
    pickTarget: null,
    fileMode: 'import',
    shopDone: {}
  };

  /* ---------------- 小工具 ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2000);
  }

  function openSheet(title, html, after) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheetMask').hidden = false;
    document.body.style.overflow = 'hidden';
    if (after) after($('#sheetBody'));
  }
  function closeSheet() {
    $('#sheetMask').hidden = true;
    $('#sheetBody').innerHTML = '';
    document.body.style.overflow = '';
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function dateLabel(key) {
    var d = Store.parseDate(key);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ---------------- 菜品渲染 ---------------- */
  function dishCompactHtml(recipe) {
    var showNut = Store.getDB().settings.showNutrition;
    var dec = Store.decompose(recipe);
    var sc = stepCount(recipe.steps);
    var h = '<div class="dish-compact" data-recipe="' + recipe.id + '">';
    h += '<span class="dot"></span><div class="dc-body">';
    h += '<div class="dc-name">' + esc(recipe.name)
      + (sc ? '<span class="dc-step">做法 ' + sc + ' 步</span>' : '<span class="dc-step dc-step-no">缺做法</span>')
      + '</div>';
    if (showNut && dec.length) {
      dec.forEach(function (d) {
        var txt = (d.fn && d.fn.length) ? d.fn[0] : '';
        if (!txt) return;
        h += '<div class="dc-ing"><b>' + esc(d.name) + '</b> ' + esc(txt) + '</div>';
      });
    }
    h += '</div></div>';
    return h;
  }

  function mealCardHtml(meal, ids, opts) {
    opts = opts || {};
    var h = '<div class="meal-card"><div class="meal-card-head"><div class="meal-name">'
      + '<span class="meal-emoji">' + MEAL_EMOJI[meal] + '</span>' + Store.MEAL_CN[meal] + '</div>';
    if (opts.tools) {
      h += '<div class="slot-tools">'
        + '<button class="icon-btn" data-act="swap" data-date="' + opts.date + '" data-meal="' + meal + '">↻</button>'
        + '<button class="icon-btn" data-act="pick" data-date="' + opts.date + '" data-meal="' + meal + '">＋</button>'
        + '</div>';
    }
    h += '</div><div class="dish-list">';
    if (!ids.length) {
      h += '<div class="empty-line">还没安排 · 点「今天吃什么」或到「本周」生成</div>';
    } else {
      ids.forEach(function (id) {
        var r = Store.getRecipe(id);
        if (r) h += dishCompactHtml(r);
      });
    }
    h += '</div></div>';
    return h;
  }

  /* ---------------- 今日 ---------------- */
  function renderToday() {
    var t = Store.todayKey();
    var q = Store.quoteOfDay(t);
    $('#quoteCard').innerHTML =
      '<div class="quote-card">' +
      '<div class="q-label">✦ 今日金句</div>' +
      '<div class="q-text">' + esc(q.text) + '</div>' +
      '<div class="q-from">—— ' + esc(q.from) + '</div></div>';

    $('#todayDate').textContent = dateLabel(t) + ' · ' + Store.weekdayCn(t);
    var day = Store.getPlan().days[t];
    var filled = day ? Store.MEALS.filter(function (m) { return day[m].ids.length; }).length : 0;
    $('#todaySub').textContent = filled ? (filled + ' 餐已排好') : '还没安排，点右边一键生成';

    var h = '';
    Store.MEALS.forEach(function (m) {
      var ids = day ? day[m].ids : [];
      if (!ids.length && m === 'breakfast' && !day) return;
      h += mealCardHtml(m, ids, { tools: true, date: t });
    });
    $('#todayMeals').innerHTML = h;

    var s = Store.stats();
    $('#qWeek').textContent = s.planned ? '本周已排 ' + s.planned + ' 餐' : '生成 7 天不重样';
    $('#qRecipes').textContent = s.recipes + ' 道菜谱';
    $('#qIng').textContent = s.ingredients + ' 种食材';
  }

  /* ---------------- 本周 ---------------- */
  function renderWeek() {
    var plan = Store.getPlan();
    var ws = plan.weekStart, we = Store.addDays(ws, 6);
    $('#weekRange').textContent = (Store.parseDate(ws).getMonth() + 1) + '/' + Store.parseDate(ws).getDate()
      + ' - ' + (Store.parseDate(we).getMonth() + 1) + '/' + Store.parseDate(we).getDate();
    var today = Store.todayKey();
    var h = '';
    Store.weekKeys(ws).forEach(function (k) {
      var day = plan.days[k];
      h += '<div class="day-card' + (k === today ? ' is-today' : '') + '">';
      h += '<div class="day-head"><div class="day-title">' + Store.weekdayCn(k)
        + (k === today ? '<span class="badge-today">今天</span>' : '') + '</div>'
        + '<div class="day-date">' + dateLabel(k) + '</div></div>';
      Store.MEALS.forEach(function (m) {
        var slot = day[m];
        h += '<div class="slot"><div class="slot-head"><div class="slot-label">'
          + '<span>' + MEAL_EMOJI[m] + '</span>' + Store.MEAL_CN[m] + '</div><div class="slot-tools">'
          + '<button class="icon-btn" data-act="swap" data-date="' + k + '" data-meal="' + m + '" title="换一换">↻</button>'
          + '<button class="icon-btn' + (slot.locked ? ' on' : '') + '" data-act="lock" data-date="' + k + '" data-meal="' + m + '" title="锁定">'
          + (slot.locked ? '🔒' : '🔓') + '</button>'
          + '<button class="icon-btn" data-act="pick" data-date="' + k + '" data-meal="' + m + '" title="手动加菜">＋</button>'
          + '</div></div>';
        if (!slot.ids.length) {
          h += '<div class="empty-line">— 空 —</div>';
        } else {
          slot.ids.forEach(function (id) {
            var r = Store.getRecipe(id);
            if (r) h += dishCompactHtml(r);
          });
        }
        h += '</div>';
      });
      h += '</div>';
    });
    $('#weekList').innerHTML = h;
  }

  function renderShop() {
    var list = Store.shoppingList();
    $('#shopCount').textContent = list.length ? ('共 ' + list.length + ' 项') : '';
    if (!list.length) {
      $('#shopList').innerHTML = '<div class="empty"><div class="e-ico">🛒</div><div class="e-t">还没有可采购的内容</div><div class="e-d">先生成本周食谱，这里会自动汇总所有食材。</div></div>';
      return;
    }
    var groups = {};
    list.forEach(function (it) { (groups[it.cat] = groups[it.cat] || []).push(it); });
    var h = '';
    Object.keys(groups).forEach(function (cat) {
      h += '<div class="shop-group"><div class="shop-group-title">' + esc(cat) + '</div>';
      groups[cat].forEach(function (it) {
        var key = cat + '|' + it.name;
        var done = state.shopDone[key] ? ' done' : '';
        h += '<div class="shop-item' + done + '" data-act="shopdone" data-key="' + esc(key) + '">'
          + '<div class="chk">✓</div><div class="si-body">'
          + '<div class="si-name">' + esc(it.name) + '</div>'
          + '<div class="si-need">' + esc(it.amounts.slice(0, 3).join(' / ') || '按需')
          + (it.amounts.length > 3 ? '　等 ' + it.amounts.length + ' 处' : '') + '</div>'
          + '</div><div class="si-cnt">×' + it.count + '</div></div>';
      });
      h += '</div>';
    });
    $('#shopList').innerHTML = h;
  }

  function copyShopText() {
    var list = Store.shoppingList();
    if (!list.length) { toast('还没有可复制的清单'); return; }
    var lines = ['【一周采购清单】' + Store.getPlan().weekStart + ' 起'];
    var cur = '';
    list.forEach(function (it) {
      if (it.cat !== cur) { cur = it.cat; lines.push('', '· ' + cur + ' ·'); }
      lines.push('□ ' + it.name + '  ' + (it.amounts.join(' / ') || '') + '  ×' + it.count);
    });
    copyText(lines.join('\n')).then(function (ok) {
      toast(ok ? '采购清单已复制' : '复制失败，请长按选择文本');
    });
  }

  /* ---------------- 菜谱 ---------------- */
  function renderRecipes() {
    var all = Store.listRecipes();
    var filters = [
      { k: 'all', t: '全部' }, { k: 'breakfast', t: '早餐' }, { k: 'main', t: '午晚餐' },
      { k: 'fav', t: '⭐ 收藏' }, { k: 'todo', t: '待补营养' }
    ];
    $('#recipeFilters').innerHTML = filters.map(function (f) {
      return '<button class="chip' + (state.recipeFilter === f.k ? ' active' : '') + '" data-act="rfilter" data-k="' + f.k + '">'
        + f.t + '</button>';
    }).join('');

    var q = state.recipeQuery.trim().toLowerCase();
    var list = all.filter(function (r) {
      if (state.recipeFilter === 'breakfast' && (r.mealTypes || []).indexOf('breakfast') < 0 && r.role !== '早餐') return false;
      if (state.recipeFilter === 'main' && r.role === '早餐') return false;
      if (state.recipeFilter === 'fav' && !r.fav) return false;
      if (state.recipeFilter === 'todo') {
        var miss = Store.decompose(r).some(function (d) { return !d.known; });
        if (!miss) return false;
      }
      if (q) {
        var txt = (r.name + ' ' + (r.tags || []).join(' ') + ' ' + (r.ingredients || []).map(function (i) { return i.name; }).join(' ')).toLowerCase();
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    });
    list = list.slice().sort(function (a, b) {
      if (a.fav !== b.fav) return a.fav ? -1 : 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    if (!list.length) {
      $('#recipeList').innerHTML = '<div class="empty"><div class="e-ico">📖</div><div class="e-t">'
        + (all.length ? '没有匹配的菜谱' : '还没有菜谱') + '</div><div class="e-d">'
        + (all.length ? '换个关键词，或清空筛选条件。' : '点上方「+ 新增」手动加一道，或点「导入」一次性把菜单文件导进来。</div>')
        + '</div>';
      return;
    }

    $('#recipeList').innerHTML = list.map(function (r) {
      var dec = Store.decompose(r);
      var todo = dec.filter(function (d) { return !d.known; }).length;
      var st = stepCount(r.steps);
      var ingLine = dec.map(function (d) { return d.name + (d.amount ? ' ' + d.amount : ''); }).join('、');
      var fnLine = dec.filter(function (d) { return d.fn && d.fn.length; })
        .map(function (d) { return '<b>' + esc(d.name) + '</b>：' + esc(d.fn[0]); }).join(' · ');
      var meals = (r.mealTypes || []).map(function (m) { return '<span class="tag tag-meal">' + Store.MEAL_CN[m] + '</span>'; }).join('');
      return '<div class="list-item" data-recipe="' + r.id + '">'
        + '<div class="li-head"><div class="li-name">' + esc(r.name)
        + '<span class="tag tag-role">' + esc(r.role || '') + '</span></div>'
        + '<button class="fav-btn' + (r.fav ? ' on' : '') + '" data-act="fav" data-id="' + r.id + '">★</button></div>'
        + '<div class="li-tags">' + meals
        + (r.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('')
        + (st ? '<span class="tag tag-step">做法 ' + st + ' 步</span>'
              : '<span class="tag tag-warn">缺做法</span>')
        + (todo ? '<span class="tag tag-warn">' + todo + ' 项营养待补</span>' : '')
        + '</div>'
        + '<div class="li-sub">食材：' + esc(ingLine || '未填写') + '</div>'
        + (fnLine ? '<div class="li-nut">' + fnLine + '</div>' : '')
        + '</div>';
    }).join('');
  }

  /* ---------------- 食材 ---------------- */
  function renderIngredients() {
    var cats = Store.ingredientCategories();
    var chips = [{ k: 'all', t: '全部' }].concat(cats.map(function (c) { return { k: c, t: c }; }));
    $('#ingFilters').innerHTML = chips.map(function (f) {
      return '<button class="chip' + (state.ingFilter === f.k ? ' active' : '') + '" data-act="ifilter" data-k="' + esc(f.k) + '">'
        + esc(f.t) + '</button>';
    }).join('');

    var q = state.ingQuery.trim().toLowerCase();
    var list = Store.listIngredients().filter(function (i) {
      if (state.ingFilter !== 'all' && (i.cat || '其他') !== state.ingFilter) return false;
      if (q) {
        var txt = (i.name + ' ' + (i.alias || []).join(' ') + ' ' + (i.fn || []).join(' ')).toLowerCase();
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    }).slice().sort(function (a, b) {
      var ea = (a.fn || []).length ? 0 : 1, eb = (b.fn || []).length ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return (a.name || '').localeCompare(b.name || '', 'zh');
    });

    if (!list.length) {
      $('#ingredientList').innerHTML = '<div class="empty"><div class="e-ico">🥬</div><div class="e-t">没有匹配的食材</div><div class="e-d">换个关键词，或点右上角「+ 新增」自己加一条。</div></div>';
      return;
    }

    $('#ingredientList').innerHTML = list.map(function (i) {
      var nut = [];
      if (i.kcal != null) nut.push(i.kcal + ' kcal');
      if (i.protein != null) nut.push('蛋白 ' + i.protein + 'g');
      if (i.fat != null) nut.push('脂肪 ' + i.fat + 'g');
      if (i.carb != null) nut.push('碳水 ' + i.carb + 'g');
      var fn = (i.fn || []);
      return '<div class="list-item" data-act="ingdetail" data-id="' + i.id + '">'
        + '<div class="li-head"><div class="li-name">' + esc(i.name) + '<span class="tag">' + esc(i.cat || '其他') + '</span></div>'
        + (fn.length ? '' : '<span class="tag tag-warn">待补充</span>') + '</div>'
        + (fn.length ? '<div class="li-nut">' + fn.slice(0, 2).map(esc).join(' · ') + '</div>' : '<div class="li-sub">还没有营养功能说明，点开补充。</div>')
        + (nut.length ? '<div class="li-nut">每 100g 参考：' + nut.join(' / ') + '</div>' : '')
        + '</div>';
    }).join('');
  }

  /* ---------------- 我的 ---------------- */
  function renderMe() {
    var st = Store.getDB().settings;
    $('#nBreakfast').textContent = st.perMeal.breakfast;
    $('#nLunch').textContent = st.perMeal.lunch;
    $('#nDinner').textContent = st.perMeal.dinner;
    $('#swSoup').checked = !!st.withSoup;
    $('#swNoRepeat').checked = st.noRepeatInWeek !== false;
    $('#swShowNut').checked = st.showNutrition !== false;
    $('#inpAvoid').value = st.avoid || '';

    var qs = Store.listQuotes();
    $('#quoteManage').innerHTML = qs.slice().reverse().map(function (q) {
      return '<div class="qm-item"><div class="qm-t">' + esc(q.text) + '</div>'
        + '<div class="qm-f">' + esc(q.from || '') + '</div>'
        + (q.custom ? '<button class="rm-btn" data-act="qdel" data-id="' + q.id + '">×</button>' : '')
        + '</div>';
    }).join('') || '<p class="hint">还没有金句</p>';

    var s = Store.stats();
    $('#statGrid').innerHTML =
      '<div class="stat"><b>' + s.recipes + '</b><span>道菜谱</span></div>'
      + '<div class="stat"><b>' + s.ingredients + '</b><span>种食材</span></div>'
      + '<div class="stat"><b>' + s.quotes + '</b><span>条金句</span></div>'
      + '<div class="stat"><b>' + s.planned + '</b><span>本周已排餐次</span></div>';
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(v) {
    state.view = v;
    $$('.view').forEach(function (el) { el.classList.toggle('active', el.id === 'view-' + v); });
    $$('.tab').forEach(function (el) { el.classList.toggle('active', el.dataset.view === v); });
    if (v === 'today') renderToday();
    if (v === 'week') { renderWeek(); renderShop(); }
    if (v === 'recipes') renderRecipes();
    if (v === 'ingredients') renderIngredients();
    if (v === 'me') renderMe();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function refresh() {
    if (state.view === 'today') renderToday();
    else if (state.view === 'week') { renderWeek(); renderShop(); }
    else if (state.view === 'recipes') renderRecipes();
    else if (state.view === 'ingredients') renderIngredients();
    else if (state.view === 'me') renderMe();
  }
  function refreshAll() { renderToday(); renderWeek(); renderShop(); renderRecipes(); renderIngredients(); renderMe(); }

  /* ---------------- 弹层：菜谱详情 ----------------
   * 排序原则：这是一张「要做菜」的页面。
   * 第一屏必须同时看到「备料（含用量）」和「做法」，
   * 所以顺序是 备料 → 做法 → 小贴士 → 调料 → 营养功能，
   * 营养功能虽然内容最多，但它属于参考信息，压在做菜前面就没人看得到做法了。
   */
  function openRecipeDetail(id) {
    var r = Store.getRecipe(id);
    if (!r) return;
    var dec = Store.decompose(r);
    var meals = (r.mealTypes || []).map(function (m) { return Store.MEAL_CN[m]; }).join(' / ');
    var h = '<div class="detail-hero"><h2>' + esc(r.name) + '</h2>'
      + '<div class="dh-sub">' + esc(r.role || '') + ' · ' + esc(meals)
      + (r.tags && r.tags.length ? ' · ' + esc(r.tags.join(' ')) : '') + '</div></div>';

    /* 1) 备料：站在灶台前第一眼要看到"拿什么、拿多少" */
    h += '<div class="block-title">备料<span class="bt-sub">' + (dec.length ? dec.length + ' 味' : '未填写') + '</span></div>';
    if (!dec.length) {
      h += '<p class="hint">这道菜还没有填写食材 · 点下面「编辑」补上就能算采购量了。</p>';
    } else {
      h += '<div class="prep-list">' + dec.map(function (d) {
        return '<div class="prep-row"><span class="prep-name">' + esc(d.name) + '</span>'
          + '<span class="prep-amt">' + esc(d.amount || '适量') + '</span></div>';
      }).join('') + '</div>';
    }

    /* 2) 做法：菜谱的主体 */
    var steps = parseSteps(r.steps);
    h += '<div class="block-title">做法<span class="bt-sub">' + (steps.length ? steps.length + ' 步' : '没写') + '</span></div>';
    if (steps.length) {
      h += '<div class="step-list">' + steps.map(function (s, i) {
        return '<div class="step-item"><span class="step-no">' + (i + 1) + '</span>'
          + '<span class="step-tx">' + esc(s) + '</span></div>';
      }).join('') + '</div>';
    } else {
      h += '<p class="hint">还没有做法 · 点下面「编辑」，写上 3~4 步就能在这里按步骤显示。</p>';
    }

    if (r.note) h += '<div class="note-box">💡 ' + esc(r.note) + '</div>';

    if (r.seasonings && r.seasonings.length) {
      h += '<div class="block-title">调料</div><p class="steps-text">' + esc(r.seasonings.join('、')) + '</p>';
    }

    /* 3) 营养功能：内容最多，但属于参考信息，放在做法后面 */
    h += '<div class="decomp-title">食材拆解与营养功能（' + dec.length + ' 味）</div>';
    if (!dec.length) h += '<p class="hint">这道菜还没有填写食材。</p>';
    dec.forEach(function (d) {
      h += '<div class="decomp"><div class="decomp-head"><span class="decomp-name">' + esc(d.name) + '</span>'
        + '<span class="decomp-amt">' + esc(d.amount || '') + '</span></div>';
      if (d.fn && d.fn.length) {
        h += '<ul class="decomp-fn">' + d.fn.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
      } else {
        h += '<div class="decomp-todo">营养功能待补充 · 到「食材」页补一句就能在这里显示</div>';
      }
      var nut = [];
      if (d.kcal != null) nut.push(d.kcal + ' kcal');
      if (d.tip) h += '<div class="decomp-tip">' + esc(d.tip) + '</div>';
      if (nut.length) h += '<div class="decomp-nut">每 100g 约 ' + nut.join(' / ') + '</div>';
      h += '</div>';
    });

    h += '<div class="block-title">加进今天（' + dateLabel(Store.todayKey()) + '）</div>'
      + '<div class="bar-actions wrap">'
      + Store.MEALS.map(function (m) {
        return '<button class="btn btn-ghost btn-sm" data-act="addmeal" data-id="' + r.id + '" data-meal="' + m + '">' + Store.MEAL_CN[m] + '</button>';
      }).join('')
      + '</div>'
      + '<div class="bar-actions wrap" style="margin-top:10px">'
      + '<button class="btn btn-ghost" data-act="redit" data-id="' + r.id + '">编辑</button>'
      + '<button class="btn btn-danger" data-act="rdel" data-id="' + r.id + '">删除</button>'
      + '</div>';
    openSheet('菜谱详情', h);
  }

  /* ---------------- 弹层：菜谱表单 ---------------- */
  function ingredientRowsHtml(items) {
    items = items && items.length ? items : [{ name: '', amount: '' }];
    return items.map(function (i) {
      return '<div class="ing-row"><input class="input" data-f="ing-name" placeholder="食材，如 番茄" value="' + esc(i.name || '') + '">'
        + '<input class="input amt" data-f="ing-amt" placeholder="用量" value="' + esc(i.amount || '') + '">'
        + '<button type="button" class="rm-btn" data-act="rmrow">×</button></div>';
    }).join('');
  }

  function openRecipeForm(id) {
    var r = id ? Store.getRecipe(id) : null;
    var isNew = !r;
    r = r || { name: '', mealTypes: ['lunch', 'dinner'], role: '', tags: [], ingredients: [], seasonings: [], steps: '', note: '' };
    var mealChips = Store.MEALS.map(function (m) {
      var on = (r.mealTypes || []).indexOf(m) >= 0;
      return '<button type="button" class="chip' + (on ? ' active' : '') + '" data-act="mtoggle" data-m="' + m + '">' + Store.MEAL_CN[m] + '</button>';
    }).join('');
    var roleOpts = ROLE_LIST.map(function (x) {
      return '<option value="' + x + '"' + (r.role === x ? ' selected' : '') + '>' + x + '</option>';
    }).join('');

    var h = '<div class="field"><label>菜名 *</label><input class="input" id="fName" value="' + esc(r.name) + '" placeholder="如 番茄炒鸡蛋"></div>'
      + '<div class="field"><label>属于哪几餐</label><div class="chips" id="fMeals" style="padding-bottom:0;overflow:visible;flex-wrap:wrap">' + mealChips + '</div></div>'
      + '<div class="field-row"><div class="field"><label>类型</label><select class="input" id="fRole">'
      + '<option value="">自动判断</option>' + roleOpts + '</select></div>'
      + '<div class="field"><label>标签（逗号分隔）</label><input class="input" id="fTags" value="' + esc((r.tags || []).join(',')) + '" placeholder="家常,快手"></div></div>'
      + '<div class="field"><label>食材拆解（名称 + 用量）</label><div id="fIngs">' + ingredientRowsHtml(r.ingredients) + '</div>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-act="addrow" style="margin-top:2px">＋ 添加食材</button>'
      + '<p class="hint" style="margin-top:6px">食材名会去「食材库」里匹配，匹配上就自动带出营养功能；没匹配上的会新建一条，之后可以在食材页补充。</p></div>'
      + '<div class="field"><label>调料（逗号分隔）</label><input class="input" id="fSeason" value="' + esc((r.seasonings || []).join(',')) + '" placeholder="食用油,食盐,生抽"></div>'
      + '<div class="field"><label>做法</label><textarea class="input" id="fSteps" placeholder="1. ...&#10;2. ...">' + esc(r.steps || '') + '</textarea></div>'
      + '<div class="field"><label>小技巧 / 说明</label><textarea class="input" id="fNote" style="min-height:60px">' + esc(r.note || '') + '</textarea></div>'
      + '<button class="btn btn-primary btn-block" data-act="rsave" data-id="' + (r.id || '') + '">' + (isNew ? '保存菜谱' : '保存修改') + '</button>';
    openSheet(isNew ? '新增菜谱' : '编辑菜谱', h);
  }

  function collectRecipeForm() {
    var ings = $$('#fIngs .ing-row').map(function (row) {
      return { name: $('[data-f="ing-name"]', row).value.trim(), amount: $('[data-f="ing-amt"]', row).value.trim() };
    }).filter(function (i) { return i.name; });
    return {
      name: $('#fName').value.trim(),
      mealTypes: $$('#fMeals .chip.active').map(function (c) { return c.dataset.m; }),
      role: $('#fRole').value,
      tags: $('#fTags').value.split(/[,，、]+/).map(function (s) { return s.trim(); }).filter(Boolean),
      ingredients: ings,
      seasonings: $('#fSeason').value.split(/[,，、]+/).map(function (s) { return s.trim(); }).filter(Boolean),
      steps: $('#fSteps').value.trim(),
      note: $('#fNote').value.trim()
    };
  }

  /* ---------------- 弹层：食材表单 ---------------- */
  function openIngForm(id) {
    var i = null;
    if (id) i = Store.listIngredients().filter(function (x) { return x.id === id; })[0];
    var isNew = !i;
    i = i || { name: '', alias: [], cat: '蔬菜', kcal: '', protein: '', fat: '', carb: '', fiber: '', fn: [], tip: '' };
    var h = '<div class="field"><label>食材名称 *</label><input class="input" id="gName" value="' + esc(i.name) + '" placeholder="如 番茄"></div>'
      + '<div class="field"><label>别名（逗号分隔，用于自动匹配）</label><input class="input" id="gAlias" value="' + esc((i.alias || []).join(',')) + '" placeholder="西红柿"></div>'
      + '<div class="field"><label>分类</label><select class="input" id="gCat">'
      + CAT_LIST.map(function (c) { return '<option' + ((i.cat || '其他') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field"><label>营养功能（一行一条，会显示在菜名下面）</label>'
      + '<textarea class="input" id="gFn" style="min-height:110px" placeholder="富含番茄红素，抗氧化&#10;加热并加油后番茄红素吸收率提升">'
      + esc((i.fn || []).join('\n')) + '</textarea></div>'
      + '<div class="field"><label>小贴士</label><textarea class="input" id="gTip" style="min-height:56px">' + esc(i.tip || '') + '</textarea></div>'
      + '<div class="field"><label>每 100g 参考营养（可留空）</label>'
      + '<div class="field-row">'
      + '<input class="input" id="gKcal" type="number" step="any" value="' + (i.kcal == null ? '' : i.kcal) + '" placeholder="kcal">'
      + '<input class="input" id="gPro" type="number" step="any" value="' + (i.protein == null ? '' : i.protein) + '" placeholder="蛋白g">'
      + '</div><div class="field-row" style="margin-top:8px">'
      + '<input class="input" id="gFat" type="number" step="any" value="' + (i.fat == null ? '' : i.fat) + '" placeholder="脂肪g">'
      + '<input class="input" id="gCarb" type="number" step="any" value="' + (i.carb == null ? '' : i.carb) + '" placeholder="碳水g">'
      + '<input class="input" id="gFib" type="number" step="any" value="' + (i.fiber == null ? '' : i.fiber) + '" placeholder="纤维g">'
      + '</div></div>'
      + '<button class="btn btn-primary btn-block" data-act="gsave" data-id="' + (i.id || '') + '">' + (isNew ? '保存食材' : '保存修改') + '</button>'
      + (isNew ? '' : '<button class="btn btn-danger btn-block" style="margin-top:8px" data-act="gdel" data-id="' + i.id + '">删除这个食材</button>');
    openSheet(isNew ? '新增食材' : '编辑食材', h);
  }

  function openIngDetail(id) {
    var i = Store.listIngredients().filter(function (x) { return x.id === id; })[0];
    if (!i) return;
    var h = '<div class="detail-hero"><h2>' + esc(i.name) + '</h2><div class="dh-sub">'
      + esc(i.cat || '其他') + ((i.alias || []).length ? ' · 又名 ' + esc(i.alias.join('、')) : '') + '</div></div>';
    if ((i.fn || []).length) {
      h += '<div class="decomp-title">营养功能</div><ul class="decomp-fn" style="font-size:13.5px">'
        + i.fn.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
    } else {
      h += '<p class="decomp-todo">还没有营养功能说明。</p>';
    }
    var nut = [];
    if (i.kcal != null) nut.push(i.kcal + ' kcal');
    if (i.protein != null) nut.push('蛋白 ' + i.protein + 'g');
    if (i.fat != null) nut.push('脂肪 ' + i.fat + 'g');
    if (i.carb != null) nut.push('碳水 ' + i.carb + 'g');
    if (i.fiber != null) nut.push('纤维 ' + i.fiber + 'g');
    if (nut.length) h += '<div class="block-title">每 100g 参考值</div><p class="steps-text">' + nut.join(' / ') + '</p><p class="hint">数值来自常见食物成分表的近似值，仅供日常参考。</p>';
    if (i.tip) h += '<div class="note-box">💡 ' + esc(i.tip) + '</div>';
    var used = Store.listRecipes().filter(function (r) {
      return (r.ingredients || []).some(function (x) { return x.name === i.name || x.ingId === i.id; });
    });
    if (used.length) {
      h += '<div class="block-title">用在 ' + used.length + ' 道菜里</div><p class="steps-text">'
        + used.slice(0, 20).map(function (r) { return esc(r.name); }).join('、') + '</p>';
    }
    h += '<div class="bar-actions" style="margin-top:16px"><button class="btn btn-primary" data-act="gedit" data-id="' + i.id + '">编辑</button></div>';
    openSheet('食材详情', h);
  }

  /* ---------------- 弹层：导入 ---------------- */
  var SAMPLE = [
    '# 番茄炒鸡蛋',
    '餐次: 午餐, 晚餐',
    '类型: 半荤',
    '食材: 番茄 2个; 鸡蛋 3个; 小葱 1根',
    '调料: 食用油; 食盐; 白糖',
    '做法: 1. 鸡蛋打散加一点盐，番茄去皮切块。',
    '2. 热油滑炒鸡蛋至半凝固，盛出备用。',
    '3. 下番茄炒出沙，加少许糖；倒回鸡蛋翻匀，撒葱花出锅。',
    '说明: 番茄要炒到出汁，蛋才嫩。',
    '',
    '# 青椒炒豆干',
    '餐次: 午餐, 晚餐',
    '类型: 半荤',
    '标签: 快手, 下饭',
    '食材: 豆干 200g; 青椒 2个; 大蒜 3瓣',
    '调料: 食用油; 生抽; 食盐',
    '做法: 1. 豆干切条，青椒切丝。',
    '2. 热油爆香蒜末，下豆干煸至微黄。',
    '3. 下青椒大火炒 1 分钟，加生抽和盐炒匀。',
    '说明: 豆干先煸一下更香，也更有嚼头。',
    '',
    '@食材 豆干',
    '分类: 豆制品',
    '功能: 大豆制品，提供植物完全蛋白（配谷物可互补氨基酸）',
    '功能: 钙含量较高，是很好的植物钙来源',
    '营养: 140 kcal, 蛋白16.2g, 脂肪3.6g, 碳水11.5g, 纤维0.8g'
  ].join('\n');

  function openImport() {
    var h = '<div class="seg-full" id="impSeg">'
      + '<button class="active" data-act="imptab" data-t="text">粘贴文本</button>'
      + '<button data-act="imptab" data-t="file">选择文件</button>'
      + '</div>'
      + '<div id="impText">'
      + '<div class="format-help">'
      + '一行一个字段，一道菜用 <code># 菜名</code> 开头；想同时定义食材营养，用 <code>@食材 名称</code>。<br>'
      + '支持的字段：<code>餐次</code> <code>类型</code> <code>食材</code> <code>调料</code> <code>做法</code> <code>说明</code> <code>标签</code>；<br>'
      + '食材用 <code>;</code> 分隔，名称和用量用空格隔开；<code>做法</code> 下面可以继续写多行。<br>'
      + '<code>做法</code> 建议写成 <code>1. …</code> 每步一行，详情页会自动编号排版；不分行也认，会按行拆开。<br>'
      + '也可以直接粘贴 JSON 备份文件的内容，或 <code>菜名,餐次,食材,...</code> 表头的 CSV。'
      + '</div>'
      + '<textarea class="input textarea-lg" id="impArea" placeholder="在这里粘贴菜谱文本…"></textarea>'
      + '<button class="btn btn-ghost btn-sm" data-act="impfill" style="margin-top:8px">填入示例看看格式</button>'
      + '</div>'
      + '<div id="impFile" hidden>'
      + '<p class="hint">支持 .txt / .md / .csv / .json（本应用导出的备份）。手机上从微信、备忘录或文件 App 里选一个文件即可，文件只在你手机本地读取，不会上传。</p>'
      + '<button class="btn btn-primary btn-block" data-act="impchoose" style="margin-top:12px">选择文件…</button>'
      + '<p class="hint" style="margin-top:10px">小提示：Excel 存成 CSV 时选 UTF-8 编码，中文才不会乱码。<br>CSV 表头写 <code>菜名,餐次,类型,食材,调料,做法,说明</code>，食材列里用 <code>;</code> 分隔。</p>'
      + '</div>'
      + '<div class="field" style="margin-top:16px"><label>导入方式</label>'
      + '<select class="input" id="impMode">'
      + '<option value="merge">合并（同名菜谱跳过，不动现有数据）—— 推荐</option>'
      + '<option value="replace">覆盖（清空现有菜谱和计划，只留导入内容）</option>'
      + '</select></div>'
      + '<button class="btn btn-primary btn-block" data-act="impgo">解析并导入</button>';
    openSheet('导入菜单', h);
  }

  function handleParsed(parsed, mode) {
    var n = (parsed.recipes || []).length, m = (parsed.ingredients || []).length, qq = (parsed.quotes || []).length;
    if (!n && !m && !qq) {
      toast('没解析出内容，检查一下格式'); return;
    }
    var detail = '识别到：' + n + ' 道菜谱' + (m ? '、' + m + ' 条食材定义' : '') + (qq ? '、' + qq + ' 条金句' : '');
    openSheet('确认导入', '<p class="steps-text">' + detail + '</p>'
      + '<p class="hint" style="margin-top:8px">导入方式：' + (mode === 'replace' ? '覆盖（会清空现有菜谱与计划）' : '合并（同名跳过）') + '</p>'
      + '<div class="bar-actions" style="margin-top:16px">'
      + '<button class="btn btn-primary" data-act="impconfirm">确认导入</button>'
      + '<button class="btn btn-ghost" data-act="impback">返回修改</button>'
      + '</div>', function () {
        window.__pendingParsed = parsed;
        window.__pendingMode = mode;
      });
  }

  function onFileChosen(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result;
      var text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (err) {
        try { text = new TextDecoder('gbk').decode(buf); }
        catch (err2) { text = new TextDecoder('utf-8').decode(buf); }
      }
      if (state.fileMode === 'restore') { restoreFromText(text, f.name); return; }
      var parsed = Store.autoParse(text);
      handleParsed(parsed, $('#impMode') ? $('#impMode').value : 'merge');
    };
    reader.readAsArrayBuffer(f);
  }

  function restoreFromText(text, name) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { toast('这不是有效的备份文件'); return; }
    if (!parsed || (!parsed.recipes && !parsed.ingredients)) { toast('备份文件里没有菜谱数据'); return; }
    openSheet('恢复备份', '<p class="steps-text">文件：' + esc(name) + '<br>包含 '
      + (parsed.recipes || []).length + ' 道菜谱、' + (parsed.ingredients || []).length + ' 种食材'
      + ((parsed.weeks || parsed.plan) ? '，以及周计划' : '') + '。</p>'
      + '<p class="hint" style="margin-top:8px">恢复会替换手机上现有的菜谱与计划，确定继续？</p>'
      + '<div class="bar-actions" style="margin-top:16px">'
      + '<button class="btn btn-primary" data-act="restoredo" data-payload="' + encodeURIComponent(JSON.stringify(parsed)) + '">确认恢复</button>'
      + '<button class="btn btn-ghost" data-act="close">取消</button></div>');
  }

  /* ---------------- 弹层：选菜加入某餐 ---------------- */
  function openPicker(dateKey, meal, add) {
    state.pickTarget = { date: dateKey, meal: meal, add: !!add };
    var plan = Store.getPlan();
    var cur = (plan.days[dateKey] && plan.days[dateKey][meal].ids) || [];
    var all = Store.listRecipes();
    var h = '<p class="hint">点一下加进 ' + dateLabel(dateKey) + ' 的' + Store.MEAL_CN[meal] + '；已加入的再点一次可以移除。</p>'
      + '<div class="search" style="margin:10px 0"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
      + '<input id="pkSearch" type="search" placeholder="搜索菜名或食材" autocomplete="off"></div>';
    if (!all.length) {
      h += '<div class="empty"><div class="e-ico">📖</div><div class="e-t">菜谱库是空的</div><div class="e-d">先去「菜谱」页新增或导入几道菜。</div></div>';
    } else {
      h += '<div id="pkList">' + pickerItems(all, cur) + '</div>';
    }
    openSheet('选择菜品', h);
  }

  function pickerItems(list, cur) {
    var plan = Store.getPlan();
    var target = state.pickTarget;
    var live = (plan.days[target.date] && plan.days[target.date][target.meal].ids) || [];
    return list.map(function (r) {
      var on = live.indexOf(r.id) >= 0;
      return '<div class="list-item" data-act="pktoggle" data-id="' + r.id + '" style="' + (on ? 'border-color:var(--primary);background:var(--primary-soft)' : '') + '">'
        + '<div class="li-head"><div class="li-name">' + esc(r.name) + '</div>'
        + '<span class="tag' + (on ? ' tag-role' : '') + '">' + (on ? '已加入' : (r.role || '')) + '</span></div>'
        + '<div class="li-sub">' + esc((r.ingredients || []).map(function (i) { return i.name; }).join('、') || '未填写食材') + '</div>'
        + '</div>';
    }).join('');
  }

  /* ---------------- 使用说明 ---------------- */
  function openHelp() {
    openSheet('怎么用', '<div class="steps-text">'
      + '<b>1. 先把菜谱导进来</b>\n'
      + '菜谱页 → 「导入」→ 粘贴文本或选文件，一次可导入几十道。也支持手动「+ 新增」一道一道加。\n\n'
      + '<b>2. 给食材配营养功能</b>\n'
      + '导入后自动拆解出食材。内置的常见食材已带营养功能；自己带来的新食材会在「食材」页显示「待补充」，点开写一句话即可。\n\n'
      + '<b>3. 生成一周食谱</b>\n'
      + '本周页 → 「生成本周食谱」。会按早餐/主食/荤/素/汤的配比自动搭配，优先避开这一周和最近半个月已经出现过的菜。\n\n'
      + '<b>4. 微调</b>\n'
      + '每餐右边的 ↻ 是重掷这一餐，🔒 是锁定（重新生成时不会被覆盖），＋ 是手动加菜。点任意菜名可以看到完整拆解和营养功能。\n\n'
      + '<b>5. 数据在哪</b>\n'
      + '全部存在你这台手机的浏览器本地，不联网、不上传。换手机或清理浏览器数据前，到「我的」页导出备份文件。\n\n'
      + '<b>6. 每日金句</b>\n'
      + '每天按日期固定一条，自己也可以在「我的」页添加，加满 100 条就是 100 天不重样。'
      + '</div>');
  }

  /* ---------------- 事件分发 ---------------- */
  function handleAct(el) {
    var act = el.dataset.act;

    if (act === 'close') { closeSheet(); return; }
    if (act === 'rfilter') { state.recipeFilter = el.dataset.k; renderRecipes(); return; }
    if (act === 'ifilter') { state.ingFilter = el.dataset.k; renderIngredients(); return; }
    if (act === 'fav') {
      var nowFav = Store.toggleFav(el.dataset.id);
      toast(nowFav ? '已收藏' : '已取消收藏');
      renderRecipes();
      return;
    }
    if (act === 'ingdetail') { openIngDetail(el.dataset.id); return; }
    if (act === 'gedit') { closeSheet(); setTimeout(function () { openIngForm(el.dataset.id); }, 60); return; }
    if (act === 'gdel') {
      if (!confirm('删除这个食材？已引用它的菜谱不会受影响，只是营养功能不再显示。')) return;
      Store.removeIngredient(el.dataset.id);
      closeSheet(); toast('已删除'); refreshAll(); return;
    }
    if (act === 'redit') { var rid = el.dataset.id; closeSheet(); setTimeout(function () { openRecipeForm(rid); }, 60); return; }
    if (act === 'rdel') {
      if (!confirm('删除这道菜谱？本周计划里引用到它的地方会一并移除。')) return;
      Store.removeRecipe(el.dataset.id);
      closeSheet(); toast('已删除'); refreshAll(); return;
    }
    if (act === 'addmeal') {
      var t2 = Store.todayKey();
      Store.addToMeal(t2, el.dataset.meal, el.dataset.id);
      var rr = Store.getRecipe(el.dataset.id);
      closeSheet(); refreshAll();
      toast('已加入今天' + Store.MEAL_CN[el.dataset.meal] + '：' + (rr ? rr.name : ''), 2400);
      return;
    }

    /* --- 菜谱表单 --- */
    if (act === 'mtoggle') { el.classList.toggle('active'); return; }
    if (act === 'addrow') {
      var box = $('#fIngs');
      var div = document.createElement('div');
      div.className = 'ing-row';
      div.innerHTML = '<input class="input" data-f="ing-name" placeholder="食材，如 番茄">'
        + '<input class="input amt" data-f="ing-amt" placeholder="用量">'
        + '<button type="button" class="rm-btn" data-act="rmrow">×</button>';
      box.appendChild(div);
      $('[data-f="ing-name"]', div).focus();
      return;
    }
    if (act === 'rmrow') {
      var rows = $$('#fIngs .ing-row');
      if (rows.length <= 1) { $('[data-f="ing-name"]', el.parentNode).value = ''; $('[data-f="ing-amt"]', el.parentNode).value = ''; return; }
      el.parentNode.parentNode.removeChild(el.parentNode);
      return;
    }
    if (act === 'rsave') {
      var data = collectRecipeForm();
      if (!data.name) { toast('先填一个菜名'); return; }
      if (!data.ingredients.length) { toast('至少填一样食材，营养功能才能显示'); return; }
      var ing0 = data.ingredients;
      if (el.dataset.id) data.id = el.dataset.id;
      var missing = ing0.filter(function (i) {
        var f = Store.findIngredient(i.name);
        return !f || !(f.fn || []).length;
      });
      Store.upsertRecipe(data);
      closeSheet(); refreshAll(); toast('已保存');
      if (missing.length) {
        setTimeout(function () {
          openSheet('补充营养功能',
            '<p class="steps-text">这些食材还没有营养功能说明：<b>' + esc(missing.map(function (i) { return i.name; }).join('、')) + '</b><br>'
            + '补一句，它就会显示在菜名下面。</p>'
            + '<div class="bar-actions wrap" style="margin-top:14px">'
            + missing.slice(0, 6).map(function (i) {
              var f = Store.findIngredient(i.name);
              return '<button class="btn btn-ghost btn-sm" data-act="gfill" data-id="' + (f ? f.id : '') + '">' + esc(i.name) + '</button>';
            }).join('')
            + '<button class="btn btn-ghost btn-sm" data-act="close">稍后再说</button></div>');
        }, 260);
      }
      return;
    }
    if (act === 'gfill') { closeSheet(); setTimeout(function () { openIngForm(el.dataset.id); }, 60); return; }

    /* --- 食材表单 --- */
    if (act === 'gsave') {
      var num = function (id) { var v = $(id).value.trim(); return v === '' ? null : parseFloat(v); };
      var name = $('#gName').value.trim();
      if (!name) { toast('先填名称'); return; }
      var obj = {
        name: name,
        alias: $('#gAlias').value.split(/[,，、]+/).map(function (s) { return s.trim(); }).filter(Boolean),
        cat: $('#gCat').value,
        fn: $('#gFn').value.split('\n').map(function (s) { return s.trim().replace(/^[-·•]\s*/, ''); }).filter(Boolean),
        tip: $('#gTip').value.trim(),
        kcal: num('#gKcal'), protein: num('#gPro'), fat: num('#gFat'), carb: num('#gCarb'), fiber: num('#gFib')
      };
      if (el.dataset.id) obj.id = el.dataset.id;
      Store.upsertIngredient(obj);
      closeSheet(); refreshAll(); toast('已保存');
      return;
    }
    if (act === 'qdel') { Store.removeQuote(el.dataset.id); renderMe(); toast('已删除'); return; }

    /* --- 导入 --- */
    if (act === 'imptab') {
      var t = el.dataset.t;
      $$('#impSeg button').forEach(function (b) { b.classList.toggle('active', b === el); });
      $('#impText').hidden = t !== 'text';
      $('#impFile').hidden = t !== 'file';
      return;
    }
    if (act === 'impfill') { $('#impArea').value = SAMPLE; toast('示例已填入，可直接点导入'); return; }
    if (act === 'impchoose') { state.fileMode = 'import'; $('#fileInput').click(); return; }
    if (act === 'impgo') {
      var txt = $('#impArea').value;
      if (!txt.trim()) { toast('先粘贴内容或选择文件'); return; }
      handleParsed(Store.autoParse(txt), $('#impMode').value);
      return;
    }
    if (act === 'impback') { openImport(); return; }
    if (act === 'impconfirm') {
      var st = Store.importData(window.__pendingParsed, window.__pendingMode || 'merge');
      closeSheet(); refreshAll();
      toast('导入完成：新增 ' + st.recipes + ' 道菜谱' + (st.recipesSkipped ? '，跳过重名 ' + st.recipesSkipped + ' 道' : ''));
      return;
    }
    if (act === 'restoredo') {
      var payload = JSON.parse(decodeURIComponent(el.dataset.payload));
      var st2 = Store.importData({ recipes: payload.recipes || [], ingredients: payload.ingredients || [], quotes: payload.quotes || [], settings: payload.settings, weeks: payload.weeks || null, usage: payload.usage || null }, 'replace');
      closeSheet(); refreshAll();
      toast('已恢复 ' + st2.recipes + ' 道菜谱');
      return;
    }

    /* --- 周计划 --- */
    if (act === 'swap') {
      Store.swapMeal(el.dataset.date, el.dataset.meal);
      renderWeek(); renderToday();
      var day = Store.getPlan().days[el.dataset.date][el.dataset.meal];
      var names = day.ids.map(function (id) { var r = Store.getRecipe(id); return r ? r.name : ''; }).filter(Boolean);
      toast('换成了：' + names.join('、'));
      return;
    }
    if (act === 'lock') {
      var on = Store.toggleLock(el.dataset.date, el.dataset.meal);
      renderWeek(); renderToday();
      toast(on ? '已锁定，重新生成时不动它' : '已解锁');
      return;
    }
    if (act === 'pick') { openPicker(el.dataset.date, el.dataset.meal, true); return; }
    if (act === 'pktoggle') {
      var id2 = el.dataset.id;
      var tgt = state.pickTarget;
      var cur2 = Store.getPlan().days[tgt.date][tgt.meal].ids;
      if (cur2.indexOf(id2) >= 0) Store.removeFromMeal(tgt.date, tgt.meal, id2);
      else Store.addToMeal(tgt.date, tgt.meal, id2);
      var all = Store.listRecipes();
      var q2 = $('#pkSearch') ? $('#pkSearch').value : '';
      if (q2) all = all.filter(function (r) { return (r.name + (r.ingredients || []).map(function (i) { return i.name; }).join('')).indexOf(q2) >= 0; });
      $('#pkList').innerHTML = pickerItems(all, []);
      renderWeek(); renderToday();
      return;
    }
    if (act === 'shopdone') {
      var k = el.dataset.key;
      state.shopDone[k] = !state.shopDone[k];
      el.classList.toggle('done', !!state.shopDone[k]);
      return;
    }
    if (act === 'clear') {
      var what = el.dataset.clear;
      var msg = what === 'all' ? '恢复出厂设置？会清空所有自定义菜谱和计划，回到内置示例。' : '确定清空？';
      if (!confirm(msg)) return;
      Store.clearAll(what);
      refreshAll(); toast('已清空');
      return;
    }
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (el) { e.preventDefault(); handleAct(el); return; }
      var rc = e.target.closest('[data-recipe]');
      if (rc) { openRecipeDetail(rc.dataset.recipe); return; }
      var gt = e.target.closest('[data-goto]');
      if (gt) { switchView(gt.dataset.goto); return; }
    });

    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });

    $('#sheetClose').addEventListener('click', closeSheet);
    $('#sheetMask').addEventListener('click', function (e) { if (e.target === $('#sheetMask')) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    /* 今日 */
    $('#btnTodayRoll').addEventListener('click', function () {
      var day = Store.generateToday();
      renderToday(); renderWeek();
      var names = Store.MEALS.map(function (m) {
        return Store.MEAL_CN[m] + '：' + (day[m].ids.map(function (id) { var r = Store.getRecipe(id); return r ? r.name : ''; }).filter(Boolean).join('、') || '—');
      });
      toast('今天吃这些 · ' + names.join(' / '), 3200);
    });

    /* 本周 */
    $('#btnGenWeek').addEventListener('click', function () {
      if (!Store.listRecipes().length) { toast('菜谱库是空的，先去导入几道菜'); switchView('recipes'); return; }
      Store.generateWeek(Store.getPlan().weekStart);
      renderWeek(); renderToday(); renderShop();
      toast('本周食谱已生成');
    });
    $('#btnFillEmpty').addEventListener('click', function () {
      Store.generateWeek(Store.getPlan().weekStart, { onlyEmpty: true });
      renderWeek(); renderToday(); renderShop();
      toast('已补充空着的餐次');
    });
    $('#btnResetWeek').addEventListener('click', function () {
      if (!confirm('清空本周计划？')) return;
      Store.clearWeek(); renderWeek(); renderToday(); renderShop();
      toast('已清空');
    });
    $('#btnPrevWeek').addEventListener('click', function () { Store.moveWeek(-1); state.shopDone = {}; renderWeek(); renderShop(); });
    $('#btnNextWeek').addEventListener('click', function () { Store.moveWeek(1); state.shopDone = {}; renderWeek(); renderShop(); });
    $$('#weekSeg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.weekSub = b.dataset.sub;
        $$('#weekSeg .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        $('#weekPlan').hidden = state.weekSub !== 'plan';
        $('#weekShop').hidden = state.weekSub !== 'shop';
        if (state.weekSub === 'shop') renderShop();
      });
    });
    $('#btnCopyShop').addEventListener('click', copyShopText);

    /* 菜谱 */
    $('#btnAddRecipe').addEventListener('click', function () { openRecipeForm(''); });
    $('#btnImport').addEventListener('click', openImport);
    $('#searchRecipe').addEventListener('input', debounce(function (e) {
      state.recipeQuery = e.target.value; renderRecipes();
    }, 180));

    /* 食材 */
    $('#btnAddIng').addEventListener('click', function () { openIngForm(''); });
    $('#searchIng').addEventListener('input', debounce(function (e) {
      state.ingQuery = e.target.value; renderIngredients();
    }, 180));

    /* 我的 */
    $$('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.step.split('|');
        var st = Store.getDB().settings;
        var v = Math.min(6, Math.max(1, st.perMeal[p[0]] + parseInt(p[1], 10)));
        var perMeal = Object.assign({}, st.perMeal);
        perMeal[p[0]] = v;
        Store.setSettings({ perMeal: perMeal });
        renderMe();
      });
    });
    $('#swSoup').addEventListener('change', function (e) { Store.setSettings({ withSoup: e.target.checked }); });
    $('#swNoRepeat').addEventListener('change', function (e) { Store.setSettings({ noRepeatInWeek: e.target.checked }); });
    $('#swShowNut').addEventListener('change', function (e) {
      Store.setSettings({ showNutrition: e.target.checked });
      renderToday(); renderWeek();
      toast(e.target.checked ? '菜名下面会显示食材营养' : '已隐藏食材营养');
    });
    $('#inpAvoid').addEventListener('change', function (e) { Store.setSettings({ avoid: e.target.value }); toast('忌口已保存'); });
    $('#btnAddQuote').addEventListener('click', function () {
      var t = $('#inpQuoteText').value.trim();
      if (!t) { toast('先写一句话'); return; }
      Store.addQuote(t, $('#inpQuoteFrom').value.trim() || '佚名');
      $('#inpQuoteText').value = ''; $('#inpQuoteFrom').value = '';
      renderMe(); toast('已添加');
    });
    $('#btnExport').addEventListener('click', function () {
      var data = Store.exportData();
      var d = new Date();
      var name = '柚柚吃什么-备份-'
        + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
      download(name, JSON.stringify(data, null, 2));
      toast('已导出，建议存到云盘或发给自己的微信');
    });
    $('#btnImportBackup').addEventListener('click', function () { state.fileMode = 'restore'; $('#fileInput').click(); });
    $('#btnLoadSample').addEventListener('click', function () {
      var parsed = Store.autoParse(SAMPLE);
      var st = Store.importData(parsed, 'merge');
      refreshAll();
      toast('示例已载入：' + st.recipes + ' 道菜谱' + (st.recipesSkipped ? '（跳过重名 ' + st.recipesSkipped + '）' : ''));
    });
    $$('[data-clear]').forEach(function (b) {
      b.addEventListener('click', function () { handleAct(b); });
    });
    $('#btnThemeHelp').addEventListener('click', openHelp);

    $('#fileInput').addEventListener('change', onFileChosen);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    Store.init();
    bind();
    switchView('today');
    // 离线缓存（本地双击打开文件时协议是 file:，跳过即可）
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 不影响使用 */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
