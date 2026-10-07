/* Camada fina sobre o Chart.js com o tema do app */
const Charts = (() => {
  const instancias = [];

  const css = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  const paleta = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'].map(css);

  function alpha(cor, a) {
    const hex = cor.replace('#', '');
    const n = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function gradiente(ctx, cor) {
    const { chartArea } = ctx.chart;
    if (!chartArea) return alpha(cor, 0.15);
    const g = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, alpha(cor, 0.28));
    g.addColorStop(1, alpha(cor, 0));
    return g;
  }

  function base(fmtY, fmtTooltip) {
    const texto2 = css('--text-3');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--text'),
          titleColor: css('--bg'),
          bodyColor: css('--bg'),
          padding: 10,
          cornerRadius: 10,
          boxPadding: 4,
          titleFont: { weight: '600' },
          callbacks: {
            label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${(fmtTooltip || fmtY)(c.parsed.y ?? c.parsed)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: texto2, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: css('--grid') }, border: { display: false }, ticks: { color: texto2, font: { size: 11 }, callback: (v) => fmtY(v), maxTicksLimit: 5 } },
      },
    };
  }

  function criar(canvas, config) {
    const ch = new Chart(canvas, config);
    instancias.push(ch);
    return ch;
  }

  return {
    paleta,
    alpha,

    destroyAll() {
      while (instancias.length) instancias.pop().destroy();
    },

    spark(canvas, valores, cor = css('--c1')) {
      return criar(canvas, {
        type: 'line',
        data: { labels: valores.map((_, i) => i), datasets: [{ data: valores, borderColor: alpha(cor, 0.9), borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true, backgroundColor: (ctx) => gradiente(ctx, cor) }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, layout: { padding: 0 } },
      });
    },

    line(canvas, { labels, series, fmtY, fmtTooltip, area = true }) {
      const cores = paleta();
      return criar(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: series.map((s, i) => {
            const cor = s.color || cores[i];
            return { label: s.label, data: s.data, borderColor: cor, borderWidth: 2.5, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: cor, fill: area, backgroundColor: (ctx) => gradiente(ctx, cor) };
          }),
        },
        options: base(fmtY, fmtTooltip),
      });
    },

    bar(canvas, { labels, series, fmtY, fmtTooltip, stacked = false, horizontal = false, signColors = false }) {
      const cores = paleta();
      const pos = css('--pos'), neg = css('--neg');
      const opts = base(fmtY, fmtTooltip);
      if (horizontal) {
        opts.indexAxis = 'y';
        opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
        opts.plugins.tooltip.callbacks.label = (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${(fmtTooltip || fmtY)(c.parsed.x)}`;
        const [x, y] = [opts.scales.y, opts.scales.x];
        opts.scales = { x: { ...x }, y: { ...y, ticks: { ...y.ticks, autoSkip: false } } };
      }
      if (stacked) { opts.scales.x.stacked = true; opts.scales.y.stacked = true; }
      return criar(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: series.map((s, i) => {
            const cor = s.color || cores[i];
            return {
              label: s.label, data: s.data,
              backgroundColor: signColors ? s.data.map((v) => alpha(v >= 0 ? pos : neg, 0.85)) : alpha(cor, 0.88),
              hoverBackgroundColor: signColors ? s.data.map((v) => (v >= 0 ? pos : neg)) : cor,
              borderRadius: 6, borderSkipped: false, maxBarThickness: horizontal ? 18 : 34,
            };
          }),
        },
        options: opts,
      });
    },

    combo(canvas, { labels, bar, line, fmtBar, fmtLine }) {
      const [c1, c2] = paleta();
      const opts = base(fmtBar);
      opts.scales.y1 = { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: css('--text-3'), font: { size: 11 }, callback: (v) => fmtLine(v), maxTicksLimit: 5 } };
      opts.plugins.tooltip.callbacks.label = (c) => ` ${c.dataset.label}: ${(c.dataset.yAxisID === 'y1' ? fmtLine : fmtBar)(c.parsed.y)}`;
      return criar(canvas, {
        data: {
          labels,
          datasets: [
            { type: 'line', label: line.label, data: line.data, yAxisID: 'y1', borderColor: c2, borderWidth: 2.5, tension: 0.35, pointRadius: 3, pointBackgroundColor: c2, order: 0 },
            { type: 'bar', label: bar.label, data: bar.data, yAxisID: 'y', backgroundColor: alpha(c1, 0.85), hoverBackgroundColor: c1, borderRadius: 6, maxBarThickness: 34, order: 1 },
          ],
        },
        options: opts,
      });
    },

    doughnut(canvas, { labels, data, fmt }) {
      const cores = paleta();
      const total = data.reduce((a, b) => a + (b || 0), 0);
      return criar(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: cores.slice(0, data.length), borderColor: css('--surface'), borderWidth: 3, hoverOffset: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: css('--text'), titleColor: css('--bg'), bodyColor: css('--bg'), padding: 10, cornerRadius: 10,
              callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)} (${Fmt.dec1((c.parsed / total) * 100)}%)` },
            },
          },
        },
      });
    },
  };
})();
