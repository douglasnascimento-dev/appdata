/* Formatação numérica em pt-BR */
const Fmt = (() => {
  const nf = (opts) => new Intl.NumberFormat('pt-BR', opts);
  const int = nf({ maximumFractionDigits: 0 });
  const dec1 = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const brl = nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const brl2 = nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /** 1.234.567 -> { valor: '1,23', sufixo: 'mi' } */
  function compactParts(v) {
    const abs = Math.abs(v);
    if (abs >= 1e9) return { valor: dec1.format(v / 1e9), sufixo: 'bi' };
    if (abs >= 1e6) return { valor: dec1.format(v / 1e6), sufixo: 'mi' };
    if (abs >= 1e4) return { valor: dec1.format(v / 1e3), sufixo: 'mil' };
    return { valor: int.format(v), sufixo: '' };
  }

  return {
    isNum,
    int: (v) => (isNum(v) ? int.format(v) : '—'),
    dec1: (v) => (isNum(v) ? dec1.format(v) : '—'),
    pct: (v, sinal = true) => (isNum(v) ? `${sinal && v > 0 ? '+' : ''}${dec1.format(v)}%` : '—'),
    brl: (v) => (isNum(v) ? brl.format(v) : '—'),
    brl2: (v) => (isNum(v) ? brl2.format(v) : '—'),
    compact: (v) => {
      if (!isNum(v)) return '—';
      const p = compactParts(v);
      return p.sufixo ? `${p.valor} ${p.sufixo}` : p.valor;
    },
    brlCompact: (v) => {
      if (!isNum(v)) return '—';
      const p = compactParts(v);
      return p.sufixo ? `R$ ${p.valor} ${p.sufixo}` : brl.format(v);
    },
    compactParts,
    signed: (v) => (isNum(v) ? `${v > 0 ? '+' : ''}${int.format(v)}` : '—'),
    mes: (ano, mes) => new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
    data: (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
  };
})();
