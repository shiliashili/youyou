/* ============================================================
 * 柚柚今天吃什么 · 分享海报
 * 纯 Canvas 手绘，零依赖、零构建，断网也能用（和主程序一样的原则）。
 *
 * 为什么不用 html2canvas 之类：这个 App 的立身之本就是「一个文件夹丢到
 * GitHub Pages 就能用」，多一个 200KB 的三方库既破例，又得跟着进离线缓存。
 * 海报版式不复杂，自己画反而更可控。
 *
 * 两种版式（按内容量决定展示深度）：
 *   今日 —— 内容少，每道菜展示到「备料 + 做法步骤」，一张图就是一个灶台清单
 *   本周 —— 内容多，每天一行菜名，重在总览，不做步骤
 *
 * 尺寸：宽 1080（手机原生像素，微信里点开清晰不糊），高度按内容自适应。
 * ============================================================ */
window.Poster = (function () {
  'use strict';

  var W = 1080;                 // 海报宽度
  var PAD = 76;                 // 页边距
  var CW = W - PAD * 2;         // 内容宽
  var CARD_PAD = 34;            // 卡片内边距
  var IN = PAD + CARD_PAD;      // 卡片内容左边界
  var INW = CW - CARD_PAD * 2;  // 卡片内容宽

  var FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", ' +
    '"Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif';

  var C = {
    bg: '#FDF7F0', bgSoft: '#F7EDE2', card: '#FFFFFF',
    line: '#F0E4D8', lineStrong: '#E5D3C2',
    text: '#3A2E26', text2: '#6E5B4E', muted: '#A08C7C',
    primary: '#FF8B3D', primaryDark: '#E9721F', primarySoft: '#FFF0E2',
    accent: '#FFC53D'
  };

  /* 三餐各自的色调：早餐清爽、午餐正午、晚餐偏暖褐 */
  var MEAL_TONE = {
    breakfast: { bg: '#E9F7F0', fg: '#2E7D57' },
    lunch: { bg: '#FFF0E2', fg: '#D2670F' },
    dinner: { bg: '#F1E7DA', fg: '#8A6A4E' }
  };

  /* ---------------- 文本排版 ---------------- */

  var CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;

  /* 切成排版单元：中文/全角标点逐字，西文数字按词 —— 这样 "300g" 不会被拆开 */
  function tokenize(str) {
    var out = [], buf = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === ' ') {
        if (buf) { out.push(buf); buf = ''; }
        out.push(' ');
      } else if (CJK.test(ch)) {
        if (buf) { out.push(buf); buf = ''; }
        out.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  function wrapLines(ctx, str, maxW) {
    var paras = String(str == null ? '' : str).split('\n');
    var lines = [];
    for (var p = 0; p < paras.length; p++) {
      var toks = tokenize(paras[p]);
      var cur = '';
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (cur && ctx.measureText(cur + t).width > maxW) {
          lines.push(cur);
          cur = (t === ' ') ? '' : t;
        } else {
          cur += t;
        }
      }
      lines.push(cur);
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  function ellipsis(ctx, line, maxW) {
    var e = '…';
    while (line.length && ctx.measureText(line + e).width > maxW) line = line.slice(0, -1);
    return line + e;
  }

  /* ---------------- 画笔 ----------------
   * dry = true 时只走排版、不落笔，用来先量出整张海报有多高。
   * 画布高度不影响文字测量，所以「量」和「画」用同一套代码，不会对不上。
   */
  function P(ctx, dry) { this.c = ctx; this.dry = dry; this.y = 0; }

  P.prototype.font = function (weight, size) {
    this.c.font = weight + ' ' + size + 'px ' + FONT;
  };

  P.prototype.width = function (str, weight, size) {
    this.font(weight, size);
    return this.c.measureText(String(str)).width;
  };

  P.prototype.gap = function (h) { this.y += h; };

  /** 一段可换行的文字；返回占高 */
  P.prototype.text = function (str, o) {
    o = o || {};
    var size = o.size || 30, weight = o.weight || 400, lh = o.lh || 1.5;
    var x = (o.x == null ? PAD : o.x), w = (o.w == null ? CW : o.w);
    var align = o.align || 'left';
    var lineH = Math.round(size * lh);
    this.font(weight, size);
    var lines = wrapLines(this.c, str, w);
    if (o.maxLines && lines.length > o.maxLines) {
      lines = lines.slice(0, o.maxLines);
      lines[lines.length - 1] = ellipsis(this.c, lines[lines.length - 1], w);
    }
    if (!this.dry) {
      this.c.fillStyle = o.color || C.text;
      this.c.textBaseline = 'top';
      this.c.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
      var tx = align === 'center' ? x + w / 2 : (align === 'right' ? x + w : x);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i]) this.c.fillText(lines[i], tx, this.y + i * lineH);
      }
      this.c.textAlign = 'left';
    }
    var h = lines.length * lineH;
    this.y += h + (o.gap || 0);
    return h;
  };

  /** 带悬挂标签的一段文字，如「备料  鳕鱼 2 块 · 生姜 4 片」 */
  P.prototype.hang = function (label, txt, o) {
    o = o || {};
    var size = o.size || 27, weight = o.weight || 400, lh = o.lh || 1.6;
    var x = (o.x == null ? PAD : o.x), w = (o.w == null ? CW : o.w);
    var lineH = Math.round(size * lh);
    var lw = this.width(label, o.labelWeight || 700, o.labelSize || size) + (o.labelGap == null ? 12 : o.labelGap);
    this.font(weight, size);
    var inner = w - lw;
    var lines = wrapLines(this.c, txt, inner);
    if (o.maxLines && lines.length > o.maxLines) {
      lines = lines.slice(0, o.maxLines);
      lines[lines.length - 1] = ellipsis(this.c, lines[lines.length - 1], inner);
    }
    if (!this.dry) {
      this.c.textAlign = 'left'; this.c.textBaseline = 'top';
      this.font(o.labelWeight || 700, o.labelSize || size);
      this.c.fillStyle = o.labelColor || C.primaryDark;
      this.c.fillText(label, x, this.y);
      this.font(weight, size);
      this.c.fillStyle = o.color || C.text2;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i]) this.c.fillText(lines[i], x + lw, this.y + i * lineH);
      }
    }
    var h = lines.length * lineH;
    this.y += h + (o.gap || 0);
    return h;
  };

  /** 编号步骤：圆形数字徽章 + 正文 */
  P.prototype.steps = function (list, o) {
    o = o || {};
    var size = o.size || 27, lh = o.lh || 1.7, lineH = Math.round(size * lh);
    var x = o.x == null ? PAD : o.x, w = o.w == null ? CW : o.w;
    var bx = o.badge || 32;
    var indent = bx + 18;
    var rowGap = o.rowGap == null ? 12 : o.rowGap;
    var items = list.slice(), clipped = false;
    if (o.maxSteps && items.length > o.maxSteps) { items = items.slice(0, o.maxSteps); clipped = true; }

    var self = this;
    items.forEach(function (txt, i) {
      self.font(400, size);
      var inner = w - indent;
      var lines = wrapLines(self.c, txt, inner);
      if (!lines.length) lines = [''];
      if (clipped && i === items.length - 1) {
        lines[lines.length - 1] = ellipsis(self.c, lines[lines.length - 1], inner);
      }
      var rowH = Math.max(lines.length * lineH, bx + 4);
      if (!self.dry) {
        var cy = self.y + bx / 2 + 3;
        self.c.beginPath();
        self.c.arc(x + bx / 2, cy, bx / 2, 0, Math.PI * 2);
        self.c.fillStyle = C.primary;
        self.c.fill();
        self.c.fillStyle = '#fff';
        self.c.textAlign = 'center'; self.c.textBaseline = 'middle';
        self.c.font = '700 ' + Math.round(bx * 0.5) + 'px ' + FONT;
        self.c.fillText(String(i + 1), x + bx / 2, cy + 1);
        self.c.textAlign = 'left'; self.c.textBaseline = 'top';
        self.font(400, size);
        self.c.fillStyle = o.color || C.text;
        for (var j = 0; j < lines.length; j++) {
          if (lines[j]) self.c.fillText(lines[j], x + indent, self.y + j * lineH + 3);
        }
      }
      self.y += rowH + rowGap;
    });
    if (items.length) this.y -= rowGap;

    /* 内置菜谱最长 4 步，够用；自建菜谱可能很长，超出就明说还有多少步，
       不要让人以为「这道菜就 5 步」 */
    if (clipped) {
      this.gap(8);
      this.text('……还有 ' + (list.length - items.length) + ' 步，打开 App 看完整做法',
        { x: x + indent, w: w - indent, size: 24, lh: 1.5, color: C.muted });
    }
  };

  /* ---------------- 图形 ---------------- */

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function topBar(pl) {
    if (pl.dry) return;
    var g = pl.c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#FFC53D');
    g.addColorStop(.5, C.primary);
    g.addColorStop(1, '#F2751F');
    pl.c.fillStyle = g;
    pl.c.fillRect(0, 0, W, 12);
  }

  function accentRule(pl) {
    if (!pl.dry) {
      var y = pl.y;
      var g = pl.c.createLinearGradient(PAD, y, PAD + 140, y);
      g.addColorStop(0, C.accent);
      g.addColorStop(1, C.primary);
      roundRect(pl.c, PAD, y, 140, 6, 3);
      pl.c.fillStyle = g;
      pl.c.fill();
    }
    pl.y += 6;
  }

  /** 分隔线；默认虚线 */
  function hr(pl, o) {
    o = o || {};
    pl.gap(o.mt == null ? 20 : o.mt);
    if (!pl.dry) {
      pl.c.save();
      pl.c.strokeStyle = o.color || C.line;
      pl.c.lineWidth = o.lw || 2;
      if (o.dash) pl.c.setLineDash(o.dash);
      var x0 = o.x == null ? PAD : o.x, x1 = x0 + (o.w == null ? CW : o.w);
      var y = Math.round(pl.y) + 1;
      pl.c.beginPath();
      pl.c.moveTo(x0, y);
      pl.c.lineTo(x1, y);
      pl.c.stroke();
      pl.c.restore();
    }
    pl.gap(o.mb == null ? 20 : o.mb);
  }

  /** 圆角卡片：先量内容高度，再铺底，再把内容画上去 */
  function card(pl, padTop, padBot, content) {
    var probe = new P(pl.c, true);
    probe.y = pl.y;
    content(probe);
    var inner = probe.y - pl.y;
    var h = inner + padTop + padBot;
    if (!pl.dry) {
      var y = pl.y;
      pl.c.save();
      pl.c.shadowColor = 'rgba(160,120,80,.10)';
      pl.c.shadowBlur = 26;
      pl.c.shadowOffsetY = 8;
      roundRect(pl.c, PAD, y, CW, h, 28);
      pl.c.fillStyle = C.card;
      pl.c.fill();
      pl.c.restore();
      roundRect(pl.c, PAD, y, CW, h, 28);
      pl.c.strokeStyle = C.line;
      pl.c.lineWidth = 2;
      pl.c.stroke();
    }
    var save = pl.y;
    pl.y = save + padTop;
    content(pl);
    pl.y = save + h;
  }

  /* ---------------- 页头 ---------------- */

  function brandRow(pl) {
    var y = pl.y;
    if (!pl.dry) {
      var g = pl.c.createLinearGradient(PAD, y, PAD + 46, y + 46);
      g.addColorStop(0, '#FFB35C');
      g.addColorStop(1, C.primaryDark);
      roundRect(pl.c, PAD, y, 46, 46, 15);
      pl.c.fillStyle = g;
      pl.c.fill();

      pl.c.textBaseline = 'middle';
      pl.c.textAlign = 'center';
      pl.c.font = '800 25px ' + FONT;
      pl.c.fillStyle = '#fff';
      pl.c.fillText('柚', PAD + 23, y + 24);

      pl.c.textAlign = 'left';
      pl.c.font = '600 27px ' + FONT;
      pl.c.fillStyle = C.muted;
      pl.c.fillText('柚柚今天吃什么', PAD + 62, y + 24);
    }
    pl.y += 46;
  }

  /* ---------------- 今日海报 ---------------- */

  function quoteCard(pl, q) {
    var padX = 40, padY = 32, labelH = 40;
    var inner = CW - padX * 2;

    var probe = new P(pl.c, true);
    probe.font(700, 38);
    var ql = wrapLines(pl.c, q.text, inner);
    if (ql.length > 4) { ql = ql.slice(0, 4); ql[3] = ellipsis(pl.c, ql[3], inner); }
    var qh = ql.length * Math.round(38 * 1.6);
    var fromH = Math.round(26 * 1.5);
    var h = labelH + 12 + qh + 14 + fromH + padY * 2;

    if (!pl.dry) {
      var x = PAD, y = pl.y;
      var g = pl.c.createLinearGradient(x, y, x + CW, y + h);
      g.addColorStop(0, '#FFE9C7');
      g.addColorStop(.6, '#FFF6E4');
      g.addColorStop(1, '#FFFFFF');
      roundRect(pl.c, x, y, CW, h, 30);
      pl.c.fillStyle = g;
      pl.c.fill();
      pl.c.strokeStyle = '#FBE0B8';
      pl.c.lineWidth = 2;
      pl.c.stroke();

      /* 角上的引号水印，裁在卡片里 */
      pl.c.save();
      roundRect(pl.c, x, y, CW, h, 30);
      pl.c.clip();
      pl.c.textAlign = 'right';
      pl.c.textBaseline = 'alphabetic';
      pl.c.font = '800 170px ' + FONT;
      pl.c.fillStyle = 'rgba(255,165,70,.20)';
      pl.c.fillText('”', x + CW - 26, y + h + 44);
      pl.c.restore();

      /* 小方块 + 「今日金句」 */
      var ly = y + padY + 6;
      roundRect(pl.c, x + padX, ly, 12, 12, 4);
      pl.c.fillStyle = C.accent;
      pl.c.fill();
      pl.c.textAlign = 'left';
      pl.c.textBaseline = 'top';
      pl.c.font = '700 24px ' + FONT;
      pl.c.fillStyle = '#C07600';
      pl.c.fillText('今日金句', x + padX + 24, y + padY);

      pl.c.font = '700 38px ' + FONT;
      pl.c.fillStyle = '#7A4E12';
      for (var i = 0; i < ql.length; i++) {
        pl.c.fillText(ql[i], x + padX, y + padY + labelH + 12 + i * Math.round(38 * 1.6));
      }
      pl.c.font = '400 26px ' + FONT;
      pl.c.fillStyle = '#B08243';
      pl.c.fillText('—— ' + (q.from || '佚名'), x + padX, y + padY + labelH + 12 + qh + 14);
    }
    pl.y += h;
  }

  function mealHead(pl, meal, n) {
    var tone = MEAL_TONE[meal] || MEAL_TONE.lunch;
    var label = Store.MEAL_CN[meal];
    var h = 52;
    if (!pl.dry) {
      var y = pl.y;
      pl.c.font = '700 32px ' + FONT;
      var bw = pl.c.measureText(label).width + 36;
      roundRect(pl.c, PAD, y, bw, h, 16);
      pl.c.fillStyle = tone.bg;
      pl.c.fill();
      pl.c.fillStyle = tone.fg;
      pl.c.textAlign = 'center';
      pl.c.textBaseline = 'middle';
      pl.c.fillText(label, PAD + bw / 2, y + h / 2 + 1);
      pl.c.textAlign = 'right';
      pl.c.font = '500 25px ' + FONT;
      pl.c.fillStyle = C.muted;
      pl.c.fillText(n + ' 道', W - PAD, y + h / 2 + 1);
      pl.c.textAlign = 'left';
    }
    pl.y += h;
  }

  function drawDish(pl, r, maxSteps) {
    var x = IN + 26;
    var w = INW - 26;
    var y0 = pl.y;

    if (!pl.dry) {
      pl.c.beginPath();
      pl.c.arc(x - 15, y0 + 21, 5.5, 0, Math.PI * 2);
      pl.c.fillStyle = C.primary;
      pl.c.fill();
    }

    pl.text(r.name, { x: x, w: w, size: 36, weight: 700, lh: 1.28, color: C.text });

    var dec = Store.decompose(r);
    if (dec.length) {
      pl.gap(8);
      var txt = dec.map(function (d) {
        return d.name + (d.amount ? ' ' + d.amount : '');
      }).join(' · ');
      pl.hang('备料', txt, {
        x: x, w: w, size: 26, lh: 1.55, color: C.text2,
        labelSize: 25, labelColor: C.primaryDark, labelGap: 12, maxLines: 4
      });
    }

    /* 做法是这张图的主体，留够地方；maxSteps 是「安全上限」，
       内容太多时由 build() 逐级下调，避免长到手机存不下 */
    var steps = Store.parseSteps(r.steps);
    var show = (maxSteps == null) ? steps.length : Math.min(steps.length, maxSteps);
    if (show > 0) {
      pl.gap(11);
      pl.steps(steps, { x: x, w: w, size: 26, lh: 1.6, badge: 31, rowGap: 11, maxSteps: show });
    } else if (steps.length) {
      pl.gap(8);
      pl.text('做法 ' + steps.length + ' 步，打开 App 看', { x: x, w: w, size: 24, lh: 1.5, color: C.muted });
    } else {
      pl.gap(8);
      pl.text('做法还没写', { x: x, w: w, size: 24, lh: 1.5, color: C.muted });
    }
  }

  function mealSection(pl, meal, ids, maxSteps, maxDishes) {
    var all = ids.map(function (id) { return Store.getRecipe(id); }).filter(Boolean);
    if (!all.length) return;
    var shown = (maxDishes && all.length > maxDishes) ? all.slice(0, maxDishes) : all;
    mealHead(pl, meal, all.length);
    pl.gap(14);
    card(pl, 28, 26, function (p) {
      shown.forEach(function (r, i) {
        if (i) hr(p, { mt: 20, mb: 20, dash: [6, 9], x: IN, w: INW });
        drawDish(p, r, maxSteps);
      });
    });
    if (shown.length < all.length) {
      pl.gap(10);
      pl.text('另有 ' + (all.length - shown.length) + ' 道没画下，完整清单在 App 里',
        { size: 23, lh: 1.5, color: C.muted });
    }
  }

  /* ---------------- 本周海报 ---------------- */

  function statStrip(pl, items) {
    var h = 120, gap = 14, n = items.length;
    var bw = (CW - gap * (n - 1)) / n;
    if (!pl.dry) {
      pl.c.textAlign = 'center';
      pl.c.textBaseline = 'top';
      items.forEach(function (it, i) {
        var x = PAD + i * (bw + gap);
        roundRect(pl.c, x, pl.y, bw, h, 22);
        pl.c.fillStyle = C.bgSoft;
        pl.c.fill();
        pl.c.font = '700 44px ' + FONT;
        pl.c.fillStyle = C.primaryDark;
        pl.c.fillText(it.b, x + bw / 2, pl.y + 22);
        pl.c.font = '500 24px ' + FONT;
        pl.c.fillStyle = C.muted;
        pl.c.fillText(it.t, x + bw / 2, pl.y + 76);
      });
      pl.c.textAlign = 'left';
    }
    pl.y += h;
  }

  function dayCard(pl, key, day) {
    var isToday = key === Store.todayKey();
    var LABW = 92;
    card(pl, 28, 26, function (p) {
      var y0 = p.y;
      if (!p.dry) {
        p.c.textAlign = 'left';
        p.c.textBaseline = 'top';
        p.c.font = '700 34px ' + FONT;
        p.c.fillStyle = C.text;
        p.c.fillText(Store.weekdayCn(key), IN, y0);
        var wd = p.c.measureText(Store.weekdayCn(key)).width;
        p.c.font = '500 25px ' + FONT;
        p.c.fillStyle = C.muted;
        p.c.fillText(mdShort(key), IN + wd + 14, y0 + 9);
        if (isToday) {
          p.c.font = '700 22px ' + FONT;
          var bw = p.c.measureText('今天').width + 28;
          var bx = PAD + CW - CARD_PAD - bw;
          roundRect(p.c, bx, y0 + 2, bw, 34, 12);
          p.c.fillStyle = C.primary;
          p.c.fill();
          p.c.fillStyle = '#fff';
          p.c.textAlign = 'center';
          p.c.textBaseline = 'middle';
          p.c.fillText('今天', bx + bw / 2, y0 + 20);
          p.c.textAlign = 'left';
        }
      }
      p.y += 46;

      Store.MEALS.forEach(function (m, idx) {
        if (idx) p.gap(11);
        var ids = (day && day[m] && day[m].ids) || [];
        var names = ids.map(function (id) {
          var r = Store.getRecipe(id);
          return r ? r.name : '';
        }).filter(Boolean);
        var tone = MEAL_TONE[m] || { fg: C.text2 };
        var labelY = p.y;
        if (!p.dry) {
          p.c.font = '700 26px ' + FONT;
          p.c.fillStyle = tone.fg;
          p.c.textAlign = 'left';
          p.c.textBaseline = 'top';
          p.c.fillText(Store.MEAL_CN[m], IN, labelY + 3);
        }
        var startY = p.y;
        p.text(names.length ? names.join('  ·  ') : '—', {
          x: IN + LABW, w: INW - LABW, size: 27, lh: 1.55,
          color: names.length ? C.text : C.muted
        });
        p.y = Math.max(p.y, startY + 42);
      });
    });
  }

  /* ---------------- 页脚 ---------------- */

  function footer(pl, right) {
    hr(pl, { mt: 4, mb: 22, dash: null, color: C.lineStrong });
    if (!pl.dry) {
      pl.c.textAlign = 'left';
      pl.c.textBaseline = 'top';
      pl.c.font = '600 24px ' + FONT;
      pl.c.fillStyle = C.text2;
      pl.c.fillText('柚柚今天吃什么', PAD, pl.y);
      pl.c.textAlign = 'right';
      pl.c.font = '400 23px ' + FONT;
      pl.c.fillStyle = C.muted;
      pl.c.fillText(right, W - PAD, pl.y + 1);
      pl.c.textAlign = 'left';
    }
    pl.y += 34 + 70;   // 文字 + 底部留白
  }

  /* ---------------- 版式 ---------------- */

  function layoutDaily(pl, opt) {
    opt = opt || {};
    var maxSteps = (opt.maxSteps === undefined) ? 5 : opt.maxSteps;
    var t = Store.todayKey();
    var plan = Store.getPlan();
    var day = (plan.days && plan.days[t]) || {};
    var q = Store.quoteOfDay(t);
    var meals = Store.MEALS.filter(function (m) { return day[m] && day[m].ids.length; });
    var dishN = meals.reduce(function (n, m) { return n + day[m].ids.length; }, 0);

    /* 今天最长的那道菜有几步 —— 只有真的被砍了才需要解释 */
    var stepMax = 0;
    meals.forEach(function (m) {
      day[m].ids.forEach(function (id) {
        var r = Store.getRecipe(id);
        if (r) stepMax = Math.max(stepMax, Store.parseSteps(r.steps).length);
      });
    });

    if (!pl.dry) { pl.c.fillStyle = C.bg; pl.c.fillRect(0, 0, W, 100000); }

    topBar(pl);
    pl.y = PAD;
    brandRow(pl);
    pl.gap(40);

    var ty = pl.y;
    var main = mdFull(t);
    pl.text(main, { size: 62, weight: 700, lh: 1.26 });
    if (!pl.dry) {
      var tw = pl.width(main, 700, 62);
      var pw = 112, ph = 46;
      roundRect(pl.c, PAD + tw + 22, ty + 17, pw, ph, 16);
      pl.c.fillStyle = C.primarySoft;
      pl.c.fill();
      pl.c.fillStyle = C.primaryDark;
      pl.c.font = '700 26px ' + FONT;
      pl.c.textAlign = 'center';
      pl.c.textBaseline = 'middle';
      pl.c.fillText(Store.weekdayCn(t), PAD + tw + 22 + pw / 2, ty + 17 + ph / 2 + 1);
      pl.c.textAlign = 'left';
    }
    pl.gap(12);
    pl.text(meals.length ? ('今日 ' + meals.length + ' 餐 · ' + dishN + ' 道菜 · 照着做就行')
      : '今天还没有安排', { size: 27, color: C.muted, lh: 1.5 });
    pl.gap(26);
    accentRule(pl);
    pl.gap(30);

    quoteCard(pl, q);
    pl.gap(36);

    if (!meals.length) {
      card(pl, 40, 40, function (p) {
        p.text('今天还没排菜', { x: IN, w: INW, size: 34, weight: 700, lh: 1.4 });
        p.gap(10);
        p.text('打开「柚柚今天吃什么」，点右上角「今天吃什么」就能一键排好，再回来分享。',
          { x: IN, w: INW, size: 27, lh: 1.6, color: C.text2 });
      });
    } else {
      meals.forEach(function (m, i) {
        if (i) pl.gap(26);
        mealSection(pl, m, day[m].ids, maxSteps, opt.maxDishes);
      });
    }

    if (stepMax > maxSteps) {
      pl.gap(20);
      pl.text(maxSteps > 0
        ? '为了让整张图能存进相册，做法这里只画了前 ' + maxSteps + ' 步；完整做法在 App 里。'
        : '为了让整张图能存进相册，今天只列到备料；完整做法在 App 里。',
        { size: 24, lh: 1.55, color: C.muted });
    }

    pl.gap(34);
    footer(pl, mdFull(t) + ' · ' + Store.weekdayCn(t));
  }

  function layoutWeek(pl) {
    var plan = Store.getPlan();
    var ws = plan.weekStart;
    var keys = Store.weekKeys(ws);
    var days = plan.days || {};

    var slots = 0, ids = {};
    keys.forEach(function (k) {
      var d = days[k];
      if (!d) return;
      Store.MEALS.forEach(function (m) {
        ((d[m] && d[m].ids) || []).forEach(function (id) {
          slots++;
          ids[id] = 1;
        });
      });
    });
    var distinct = Object.keys(ids).length;

    if (!pl.dry) { pl.c.fillStyle = C.bg; pl.c.fillRect(0, 0, W, 100000); }

    topBar(pl);
    pl.y = PAD;
    brandRow(pl);
    pl.gap(40);
    pl.text('本周食谱', { size: 62, weight: 700, lh: 1.26 });
    pl.gap(12);
    pl.text(mdShort(ws) + ' - ' + mdShort(keys[6]) + ' · 7 天三餐', { size: 27, color: C.muted, lh: 1.5 });
    pl.gap(26);
    accentRule(pl);
    pl.gap(30);

    statStrip(pl, [
      { b: String(slots), t: '菜次' },
      { b: String(distinct), t: '道不重复' },
      { b: slots ? String(Math.round(distinct / slots * 100)) + '%' : '0%', t: '不重复率' }
    ]);
    pl.gap(34);

    keys.forEach(function (k, i) {
      if (i) pl.gap(22);
      dayCard(pl, k, days[k]);
    });

    pl.gap(34);
    footer(pl, '共 ' + slots + ' 菜次 · ' + distinct + ' 道菜');
  }

  /* ---------------- 日期小工具 ---------------- */

  function mdFull(key) {
    var d = Store.parseDate(key);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function mdShort(key) {
    var d = Store.parseDate(key);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function fileName(kind) {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    var s = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    return (kind === 'week' ? '柚柚一周食谱-' : '柚柚今日食谱-') + s + '.png';
  }

  /* ---------------- 出口 ---------------- */

  /** kind: 'today' | 'week' → { canvas, width, height, name, title }
   *
   *  画布安全线：iOS WebKit 单张画布上限 4096px / 16.7M 像素，超限**不报错**，
   *  而是静默给一张白图，甚至直接闪退。所以这里取 3840 做保守阈值，
   *  并保证「今日」版无论内容多少都不会越过它。
   */
  var MAX_H = 3840;

  /* 降级阶梯：先少画几步，实在不行再少列几道菜。
     正常一天 8~9 道菜用第一档就够了，后面几档是给「手动加了一堆菜」兜底的。 */
  var LADDER = (function () {
    var L = [];
    for (var s = 5; s >= 1; s--) L.push({ maxSteps: s, maxDishes: null });
    L.push({ maxSteps: 0, maxDishes: null });
    L.push({ maxSteps: 0, maxDishes: 5 });
    L.push({ maxSteps: 0, maxDishes: 4 });
    L.push({ maxSteps: 0, maxDishes: 3 });
    return L;
  })();

  function measure(ctx, kind, opt) {
    var probe = new P(ctx, true);
    if (kind === 'week') layoutWeek(probe); else layoutDaily(probe, opt);
    return Math.max(900, Math.ceil(probe.y));
  }

  function build(kind) {
    var isWeek = kind === 'week';
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = 8;
    var ctx = cv.getContext('2d');

    /* 「本周」版一行一天，天然短；「今日」版要把做法铺开，菜多了会很长，
       所以按阶梯试排，取第一个放得下的档位。 */
    var opt = null, H;
    if (isWeek) {
      H = measure(ctx, 'week');
    } else {
      for (var i = 0; i < LADDER.length; i++) {
        H = measure(ctx, 'today', LADDER[i]);
        if (H <= MAX_H || i === LADDER.length - 1) { opt = LADDER[i]; break; }
      }
    }

    cv.height = H;
    var pl = new P(cv.getContext('2d'), false);
    if (isWeek) layoutWeek(pl); else layoutDaily(pl, opt);

    var t = Store.todayKey();
    return {
      canvas: cv,
      width: W,
      height: H,
      maxSteps: opt ? opt.maxSteps : null,
      maxDishes: opt ? opt.maxDishes : null,
      name: fileName(kind),
      title: isWeek ? '柚柚的一周食谱' : ('柚柚今天吃什么 · ' + mdFull(t))
    };
  }

  return { build: build, MEAL_TONE: MEAL_TONE };
})();
