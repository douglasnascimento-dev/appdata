/* Painel Municipal - app principal (sem framework, sem build) */
(() => {
  const ICONES = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-5h4v5"/>',
    leaf: '<path d="M5 21c0-9 5-15 16-16-1 11-7 16-16 16Z"/><path d="M5 21 14 12"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z"/><circle cx="16" cy="14.5" r="1"/>',
    cow: '<path d="M6 8c-2 0-3-2-3-3M18 8c2 0 3-2 3-3M6 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><circle cx="10" cy="15" r=".5"/><circle cx="14" cy="15" r=".5"/>',
  };
  const icon = (nome) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome]}</svg>`;

  const VIEWS = [
    { id: 'visao', label: 'Visão geral', curto: 'Início', icon: 'home', render: viewVisao },
    { id: 'populacao', label: 'População', curto: 'Pessoas', icon: 'people', render: viewPopulacao },
    { id: 'economia', label: 'Economia', curto: 'PIB', icon: 'chart', render: viewEconomia },
    { id: 'trabalho', label: 'Trabalho e renda', curto: 'Trabalho', icon: 'briefcase', render: viewTrabalho },
    { id: 'empresas', label: 'Empresas', curto: 'Empresas', icon: 'store', render: viewEmpresas },
    { id: 'agro', label: 'Agropecuária', curto: 'Agro', icon: 'leaf', render: viewAgro },
  ];

  const SETORES_VAB = [
    ['vab_agropecuaria', 'Agropecuária'],
    ['vab_industria', 'Indústria'],
    ['vab_servicos', 'Serviços'],
    ['vab_adm_publica', 'Administração pública'],
  ];

  let D = null; // dados carregados
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ultimo = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
  const penultimo = (arr) => (arr && arr.length > 1 ? arr[arr.length - 2] : null);
  const ultimoCom = (arr, campo) => [...(arr || [])].reverse().find((x) => Fmt.isNum(x[campo])) || null;
  const sigla = (bloco) => D[bloco].sigla || 'RAIS';
  const variacao = (a, b) => (Fmt.isNum(a) && Fmt.isNum(b) && b !== 0 ? (a / b - 1) * 100 : null);

  // ------------------------------------------------------------------ //
  // Componentes                                                        //
  // ------------------------------------------------------------------ //
  function delta(v, { sufixo = '%', inverso = false, texto } = {}) {
    if (!Fmt.isNum(v)) return '';
    const dir = Math.abs(v) < 0.05 ? 'flat' : (v > 0) !== inverso ? 'up' : 'down';
    const seta = v > 0 ? '▲' : v < 0 ? '▼' : '•';
    return `<span class="delta ${dir}">${seta} ${texto ?? (sufixo === '%' ? Fmt.pct(v) : Fmt.signed(v))}</span>`;
  }

  /** valorHTML aceita HTML (para <small>) */
  function kpi({ label, icone, valorHTML, deltaHTML = '', ref, spark, sparkId }) {
    const vazio = !valorHTML;
    return `
      <article class="card kpi ${vazio ? 'empty' : ''}">
        <div class="kpi-label"><span class="dot">${icon(icone)}</span>${esc(label)}</div>
        <div class="kpi-value">${vazio ? 'Sem dados' : valorHTML}</div>
        <div class="kpi-meta">${deltaHTML}<span>${esc(ref || '')}</span></div>
        ${spark && spark.length > 1 ? `<canvas class="spark" id="${sparkId}" aria-hidden="true"></canvas>` : ''}
      </article>`;
  }

  function compactHTML(v, prefixo = '') {
    if (!Fmt.isNum(v)) return null;
    const p = Fmt.compactParts(v);
    return `${prefixo}${p.valor}${p.sufixo ? `<small>${p.sufixo}</small>` : ''}`;
  }

  function card({ titulo, sub, corpo, span = 12, fonte, acoes = '' }) {
    return `
      <article class="card span-${span}">
        <div class="card-head"><div><h3>${esc(titulo)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${acoes}</div>
        ${corpo}
        ${fonte ? `<p class="source">Fonte: ${esc(fonte)}</p>` : ''}
      </article>`;
  }

  const canvas = (id, cls = '') => `<div class="chart-box ${cls}"><canvas id="${id}" role="img"></canvas></div>`;

  const vazio = (msg = 'Sem dados para este indicador.', dica = '') =>
    `<div class="empty-state"><strong>${esc(msg)}</strong>${dica ? `<span>${dica}</span>` : ''}</div>`;

  const dicaTrabalho = 'O saldo mensal vem do Novo CAGED: rode o ETL com <code>--billing-project</code>.';

  function legenda(itens) {
    const cores = Charts.paleta();
    return `<div class="legend">${itens.map((t, i) => `<span><i style="background:${cores[i % cores.length]}"></i>${esc(t)}</span>`).join('')}</div>`;
  }

  function tabela(cabecalho, linhas) {
    return `<div class="table-wrap"><table>
      <thead><tr>${cabecalho.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function secao(titulo, sub) {
    return `<div class="section-head"><div><h2>${esc(titulo)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;
  }

  // ------------------------------------------------------------------ //
  // Derivações                                                         //
  // ------------------------------------------------------------------ //
  function resumo() {
    const pop = D.populacao.serie;
    const pib = D.pib.serie;
    const rais = D.rais.serie;
    const caged = D.caged.serie;
    const ult12 = caged.slice(-12);
    const ant12 = caged.slice(-24, -12);
    const soma = (a) => a.reduce((s, x) => s + x.saldo, 0);
    return {
      pop: ultimo(pop), popAnt: penultimo(pop),
      pib: ultimo(pib), pibAnt: penultimo(pib),
      pibVab: ultimoCom(pib, 'vab_total'),
      rais: ultimo(rais), raisAnt: penultimo(rais),
      caged12: ult12.length ? soma(ult12) : null,
      caged12Ant: ant12.length === 12 ? soma(ant12) : null,
      cagedPeriodo: ult12.length ? `${Fmt.mes(ult12[0].ano, ult12[0].mes)} – ${Fmt.mes(ultimo(ult12).ano, ultimo(ult12).mes)}` : '',
      estab: ultimo(D.estabelecimentos.serie), estabAnt: penultimo(D.estabelecimentos.serie),
      lav: D.agropecuaria.lavouras,
      reb: D.agropecuaria.rebanhos,
    };
  }

  // ------------------------------------------------------------------ //
  // Views                                                              //
  // ------------------------------------------------------------------ //
  function viewVisao() {
    const r = resumo();
    const pop = D.populacao.serie, pib = D.pib.serie, rais = D.rais.serie;
    const temCaged = D.caged.serie.length > 0;
    const saldoAnual = rais.slice(1).map((x, i) => ({ ano: x.ano, saldo: x.empregos - rais[i].empregos })).slice(-12);
    const kpis = [
      kpi({ label: 'População', icone: 'people', valorHTML: r.pop && Fmt.int(r.pop.valor), deltaHTML: delta(r.pop?.variacao_pct), ref: r.pop && `${r.pop.ano} · ${r.pop.fonte}`, spark: pop, sparkId: 'sp-pop' }),
      kpi({ label: 'PIB municipal', icone: 'chart', valorHTML: r.pib && compactHTML(r.pib.pib, 'R$ '), deltaHTML: delta(variacao(r.pib?.pib, r.pibAnt?.pib)), ref: r.pib && `${r.pib.ano} · IBGE`, spark: pib, sparkId: 'sp-pib' }),
      kpi({ label: 'PIB per capita', icone: 'money', valorHTML: r.pib && Fmt.brl(r.pib.pib_per_capita), deltaHTML: delta(variacao(r.pib?.pib_per_capita, r.pibAnt?.pib_per_capita)), ref: r.pib && `${r.pib.ano} · IBGE`, spark: pib, sparkId: 'sp-pibpc' }),
      kpi({ label: 'Empregos formais', icone: 'briefcase', valorHTML: r.rais && Fmt.int(r.rais.empregos), deltaHTML: delta(variacao(r.rais?.empregos, r.raisAnt?.empregos)), ref: r.rais && `${r.rais.ano} · ${sigla('rais')}`, spark: rais, sparkId: 'sp-emp' }),
      temCaged ? kpi({ label: 'Saldo de empregos (12 meses)', icone: 'trend', valorHTML: Fmt.isNum(r.caged12) && Fmt.signed(r.caged12), deltaHTML: Fmt.isNum(r.caged12Ant) ? `<span class="delta flat">ant.: ${Fmt.signed(r.caged12Ant)}</span>` : '', ref: r.cagedPeriodo && `${r.cagedPeriodo} · CAGED`, spark: D.caged.serie.slice(-24), sparkId: 'sp-caged' })
        : kpi({ label: 'Saldo anual de empregos', icone: 'trend', valorHTML: r.rais && r.raisAnt && Fmt.signed(r.rais.empregos - r.raisAnt.empregos), ref: r.rais && r.raisAnt && `${r.raisAnt.ano}→${r.rais.ano} · ${sigla('rais')}`, spark: saldoAnual, sparkId: 'sp-caged' }),
      kpi({ label: 'Remuneração média', icone: 'wallet', valorHTML: r.rais && Fmt.brl(r.rais.remuneracao_media), deltaHTML: delta(variacao(r.rais?.remuneracao_media, r.raisAnt?.remuneracao_media)), ref: r.rais && `${r.rais.ano} · ${sigla('rais')} (nominal)`, spark: rais, sparkId: 'sp-rem' }),
      kpi({ label: 'Estabelecimentos', icone: 'store', valorHTML: r.estab && Fmt.int(r.estab.total), deltaHTML: delta(variacao(r.estab?.total, r.estabAnt?.total)), ref: r.estab && `${r.estab.ano} · ${sigla('estabelecimentos')}`, spark: D.estabelecimentos.serie, sparkId: 'sp-est' }),
      kpi({ label: 'Valor da produção agrícola', icone: 'leaf', valorHTML: r.lav.itens.length ? compactHTML(r.lav.valor_total, 'R$ ') : null, ref: r.lav.ano && `${r.lav.ano} · PAM/IBGE` }),
    ];

    const temVab = !!r.pibVab;
    return {
      html: `
        <div class="kpis">${kpis.join('')}</div>
        <div class="grid">
          ${card({ titulo: 'Composição da economia', sub: r.pibVab ? `Valor adicionado bruto por setor · ${r.pibVab.ano}` : '', span: 5,
            corpo: temVab ? canvas('ch-vab', 'short') + legenda(SETORES_VAB.map(([, n]) => n)) : vazio(), fonte: D.pib.fonte })}
          ${temCaged
            ? card({ titulo: 'Saldo mensal de empregos', sub: 'Admissões menos desligamentos · últimos 12 meses', span: 7, corpo: canvas('ch-caged12'), fonte: D.caged.fonte })
            : card({ titulo: 'Saldo anual de empregos', sub: 'Variação do número de empregos formais em relação ao ano anterior', span: 7,
                corpo: saldoAnual.length ? canvas('ch-caged12') : vazio(), fonte: D.rais.fonte })}
        </div>`,
      after() {
        const cor = Charts.paleta();
        const spark = (id, arr, campo, c) => { const el = document.getElementById(id); if (el) Charts.spark(el, arr.map((x) => x[campo]), c); };
        spark('sp-pop', pop, 'valor', cor[0]);
        spark('sp-pib', pib, 'pib', cor[1]);
        spark('sp-pibpc', pib, 'pib_per_capita', cor[2]);
        spark('sp-emp', rais, 'empregos', cor[3]);
        spark('sp-caged', temCaged ? D.caged.serie.slice(-24) : saldoAnual, 'saldo', cor[4]);
        spark('sp-rem', rais, 'remuneracao_media', cor[5]);
        spark('sp-est', D.estabelecimentos.serie, 'total', cor[6]);
        if (temVab) Charts.doughnut($('#ch-vab'), { labels: SETORES_VAB.map(([, n]) => n), data: SETORES_VAB.map(([k]) => r.pibVab[k]), fmt: Fmt.brlCompact });
        const c12 = D.caged.serie.slice(-12);
        if (!temCaged && saldoAnual.length) Charts.bar($('#ch-caged12'), { labels: saldoAnual.map((x) => x.ano), series: [{ label: 'Saldo', data: saldoAnual.map((x) => x.saldo) }], fmtY: Fmt.signed, signColors: true });
        if (c12.length) Charts.bar($('#ch-caged12'), { labels: c12.map((x) => Fmt.mes(x.ano, x.mes)), series: [{ label: 'Saldo', data: c12.map((x) => x.saldo) }], fmtY: Fmt.signed, signColors: true });
      },
    };
  }

  function viewPopulacao() {
    const s = D.populacao.serie;
    if (!s.length) return { html: secao('População') + card({ titulo: 'População residente', corpo: vazio() }) };
    const p = ultimo(s), primeiro = s[0];
    const cresc = variacao(p.valor, primeiro.valor);
    const anos = p.ano - primeiro.ano;
    const cagr = anos > 0 ? (Math.pow(p.valor / primeiro.valor, 1 / anos) - 1) * 100 : null;
    return {
      html: `
        ${secao('População', 'Estimativas anuais do IBGE e Censo Demográfico')}
        <div class="kpis">
          ${kpi({ label: `População ${p.ano}`, icone: 'people', valorHTML: Fmt.int(p.valor), deltaHTML: delta(p.variacao_pct), ref: p.fonte })}
          ${kpi({ label: `Crescimento ${primeiro.ano}–${p.ano}`, icone: 'trend', valorHTML: Fmt.pct(cresc), ref: `${Fmt.signed(p.valor - primeiro.valor)} habitantes` })}
          ${kpi({ label: 'Crescimento médio anual', icone: 'chart', valorHTML: Fmt.pct(cagr), ref: `Taxa composta, ${anos} anos` })}
        </div>
        <div class="grid">
          ${card({ titulo: 'Evolução da população', sub: 'Habitantes', span: 7, corpo: canvas('ch-pop', 'tall'), fonte: D.populacao.fonte })}
          ${card({ titulo: 'Variação anual', sub: '% em relação ao ano anterior disponível', span: 5, corpo: canvas('ch-popvar', 'tall') })}
          ${card({ titulo: 'Série histórica', span: 12, corpo: tabela(['Ano', 'População', 'Variação', 'Fonte'],
            [...s].reverse().map((x) => [x.ano, Fmt.int(x.valor), Fmt.pct(x.variacao_pct), esc(x.fonte)])) })}
        </div>`,
      after() {
        Charts.line($('#ch-pop'), { labels: s.map((x) => x.ano), series: [{ label: 'População', data: s.map((x) => x.valor) }], fmtY: Fmt.compact, fmtTooltip: Fmt.int });
        const v = s.filter((x) => Fmt.isNum(x.variacao_pct));
        Charts.bar($('#ch-popvar'), { labels: v.map((x) => x.ano), series: [{ label: 'Variação', data: v.map((x) => x.variacao_pct) }], fmtY: (n) => Fmt.pct(n), signColors: true });
      },
    };
  }

  function viewEconomia() {
    const s = D.pib.serie;
    if (!s.length) return { html: secao('Economia') + card({ titulo: 'PIB municipal', corpo: vazio() }) };
    const p = ultimo(s), a = penultimo(s);
    // Os anos mais recentes saem só com o PIB total; a divisão por setor vem depois
    const pv = ultimoCom(s, 'vab_total') || p;
    const sv = s.filter((x) => Fmt.isNum(x.vab_total));
    const vabTotal = SETORES_VAB.reduce((t, [k]) => t + (pv[k] || 0), 0);
    const [maiorK, maiorN] = SETORES_VAB.reduce((m, x) => ((pv[x[0]] || 0) > (pv[m[0]] || 0) ? x : m));
    return {
      html: `
        ${secao('Economia', `PIB dos Municípios · valores correntes · último ano disponível ${p.ano}`)}
        <div class="kpis">
          ${kpi({ label: 'PIB', icone: 'chart', valorHTML: compactHTML(p.pib, 'R$ '), deltaHTML: delta(variacao(p.pib, a?.pib)), ref: `${p.ano} · nominal` })}
          ${kpi({ label: 'PIB per capita', icone: 'money', valorHTML: Fmt.brl(p.pib_per_capita), deltaHTML: delta(variacao(p.pib_per_capita, a?.pib_per_capita)), ref: `${p.ano}` })}
          ${kpi({ label: 'Setor mais relevante', icone: 'trend', valorHTML: esc(maiorN), ref: `${Fmt.dec1((pv[maiorK] / vabTotal) * 100)}% do VAB · ${pv.ano}` })}
          ${kpi({ label: 'Impostos líquidos', icone: 'wallet', valorHTML: compactHTML(pv.impostos, 'R$ '), ref: `${Fmt.dec1((pv.impostos / pv.pib) * 100)}% do PIB · ${pv.ano}` })}
        </div>
        <div class="grid">
          ${card({ titulo: 'PIB e PIB per capita', sub: 'Barras: PIB · Linha: PIB per capita', span: 8, corpo: canvas('ch-pib', 'tall'), fonte: D.pib.fonte })}
          ${card({ titulo: `Composição do VAB · ${pv.ano}`, span: 4, corpo: canvas('ch-vabd', 'short') + legenda(SETORES_VAB.map(([, n]) => n)) })}
          ${card({ titulo: 'Valor adicionado por setor ao longo do tempo', sub: 'R$ correntes', span: 12, corpo: canvas('ch-vabs', 'tall') + legenda(SETORES_VAB.map(([, n]) => n)) })}
          ${card({ titulo: 'Tabela', span: 12, corpo: tabela(['Ano', 'PIB', 'Per capita', 'Agropecuária', 'Indústria', 'Serviços', 'Adm. pública'],
            [...s].reverse().map((x) => [x.ano, Fmt.brlCompact(x.pib), Fmt.brl(x.pib_per_capita), ...SETORES_VAB.map(([k]) => Fmt.brlCompact(x[k]))])) })}
        </div>`,
      after() {
        Charts.combo($('#ch-pib'), { labels: s.map((x) => x.ano), bar: { label: 'PIB', data: s.map((x) => x.pib) }, line: { label: 'PIB per capita', data: s.map((x) => x.pib_per_capita) }, fmtBar: Fmt.brlCompact, fmtLine: Fmt.brlCompact });
        Charts.doughnut($('#ch-vabd'), { labels: SETORES_VAB.map(([, n]) => n), data: SETORES_VAB.map(([k]) => pv[k]), fmt: Fmt.brlCompact });
        Charts.bar($('#ch-vabs'), { labels: sv.map((x) => x.ano), series: SETORES_VAB.map(([k, n]) => ({ label: n, data: sv.map((x) => x[k]) })), fmtY: Fmt.brlCompact, stacked: true });
      },
    };
  }

  function viewTrabalho() {
    const rais = D.rais.serie, caged = D.caged.serie, setores = D.rais.por_setor.itens;
    if (!rais.length && !caged.length) {
      return { html: secao('Trabalho e renda') + card({ titulo: 'Emprego formal', corpo: vazio('Dados de emprego ainda não coletados.', dicaTrabalho) }) };
    }
    const r = resumo();
    const c24 = caged.slice(-24);
    const saldoAnual = rais.slice(1).map((x, i) => ({ ano: x.ano, saldo: x.empregos - rais[i].empregos }));
    const ultSaldo = ultimo(saldoAnual);
    const maxEmp = Math.max(...setores.map((x) => x.empregos), 1);
    return {
      html: `
        ${secao('Trabalho e renda', sigla('rais') === 'CEMPRE' ? `Emprego assalariado e salários (CEMPRE – IBGE)${caged.length ? ' e saldo mensal (Novo CAGED – MTE)' : ''}` : 'Emprego formal (RAIS) e movimentação mensal (Novo CAGED)')}
        <div class="kpis">
          ${kpi({ label: 'Empregos formais', icone: 'briefcase', valorHTML: r.rais && Fmt.int(r.rais.empregos), deltaHTML: delta(variacao(r.rais?.empregos, r.raisAnt?.empregos)), ref: r.rais && `31/12/${r.rais.ano}` })}
          ${kpi({ label: 'Remuneração média', icone: 'wallet', valorHTML: r.rais && Fmt.brl(r.rais.remuneracao_media), deltaHTML: delta(variacao(r.rais?.remuneracao_media, r.raisAnt?.remuneracao_media)), ref: r.rais && `${r.rais.ano} · nominal` })}
          ${c24.length
            ? kpi({ label: 'Saldo (12 meses)', icone: 'trend', valorHTML: Fmt.isNum(r.caged12) && Fmt.signed(r.caged12), ref: r.cagedPeriodo })
            : kpi({ label: 'Saldo anual', icone: 'trend', valorHTML: ultSaldo && Fmt.signed(ultSaldo.saldo), ref: ultSaldo && `${ultSaldo.ano - 1}→${ultSaldo.ano}` })}
          ${kpi({ label: 'Empregos por mil habitantes', icone: 'people', valorHTML: r.rais && r.pop && Fmt.int((r.rais.empregos / r.pop.valor) * 1000), ref: 'Formalização do mercado' })}
        </div>
        <div class="grid">
          ${c24.length
            ? card({ titulo: 'Saldo mensal de empregos', sub: 'Últimos 24 meses', span: 12, corpo: canvas('ch-caged'), fonte: D.caged.fonte })
            : card({ titulo: 'Saldo anual de empregos', sub: 'Variação do estoque em 31/12 · o saldo mensal exige o Novo CAGED (--billing-project)', span: 12, corpo: saldoAnual.length ? canvas('ch-caged') : vazio() })}
          ${card({ titulo: 'Estoque de empregos formais', span: 6, corpo: rais.length ? canvas('ch-emp') : vazio(), fonte: D.rais.fonte })}
          ${card({ titulo: 'Remuneração média mensal', sub: 'Valores nominais', span: 6, corpo: rais.length ? canvas('ch-rem') : vazio() })}
          ${card({ titulo: 'Empregos e remuneração por setor', sub: D.rais.por_setor.ano ? `${D.rais.por_setor.ano}` : '', span: 12,
            corpo: setores.length ? tabela(['Setor', 'Empregos', 'Participação', 'Remuneração média'],
              setores.map((x) => {
                const total = setores.reduce((t, y) => t + y.empregos, 0);
                return [esc(x.setor), `<span class="bar-cell"><i style="width:${Math.round((x.empregos / maxEmp) * 80)}px"></i>${Fmt.int(x.empregos)}</span>`, Fmt.pct((x.empregos / total) * 100, false), Fmt.brl(x.remuneracao_media)];
              })) : vazio() })}
        </div>`,
      after() {
        if (!c24.length && saldoAnual.length) Charts.bar($('#ch-caged'), { labels: saldoAnual.map((x) => x.ano), series: [{ label: 'Saldo', data: saldoAnual.map((x) => x.saldo) }], fmtY: Fmt.signed, signColors: true });
        if (c24.length) Charts.bar($('#ch-caged'), { labels: c24.map((x) => Fmt.mes(x.ano, x.mes)), series: [{ label: 'Saldo', data: c24.map((x) => x.saldo) }], fmtY: Fmt.signed, signColors: true });
        if (rais.length) {
          Charts.line($('#ch-emp'), { labels: rais.map((x) => x.ano), series: [{ label: 'Empregos', data: rais.map((x) => x.empregos) }], fmtY: Fmt.compact, fmtTooltip: Fmt.int });
          Charts.line($('#ch-rem'), { labels: rais.map((x) => x.ano), series: [{ label: 'Remuneração', data: rais.map((x) => x.remuneracao_media), color: Charts.paleta()[1] }], fmtY: Fmt.brl });
        }
      },
    };
  }

  function viewEmpresas() {
    const s = D.estabelecimentos.serie, setores = D.estabelecimentos.por_setor.itens;
    if (!s.length) return { html: secao('Empresas') + card({ titulo: 'Estabelecimentos', corpo: vazio('Dados de estabelecimentos ainda não coletados.', dicaTrabalho) }) };
    const r = resumo();
    return {
      html: `
        ${secao('Empresas', sigla('estabelecimentos') === 'CEMPRE' ? 'Unidades locais de empresas e outras organizações (CEMPRE – IBGE)' : 'Estabelecimentos com ao menos um empregado formal (RAIS)')}
        <div class="kpis">
          ${kpi({ label: 'Estabelecimentos', icone: 'store', valorHTML: Fmt.int(r.estab.total), deltaHTML: delta(variacao(r.estab.total, r.estabAnt?.total)), ref: `${r.estab.ano}` })}
          ${kpi({ label: 'Por mil habitantes', icone: 'people', valorHTML: r.pop && Fmt.dec1((r.estab.total / r.pop.valor) * 1000), ref: 'Densidade empresarial' })}
          ${kpi({ label: 'Empregados por estabelecimento', icone: 'briefcase', valorHTML: r.rais && Fmt.dec1(r.rais.empregos / r.estab.total), ref: 'Porte médio' })}
        </div>
        <div class="grid">
          ${card({ titulo: 'Estabelecimentos por setor', sub: D.estabelecimentos.por_setor.ano ? `Seções CNAE · ${D.estabelecimentos.por_setor.ano}` : '', span: 7, corpo: setores.length ? canvas('ch-estset', 'tall') : vazio(), fonte: D.estabelecimentos.fonte })}
          ${card({ titulo: 'Evolução do número de estabelecimentos', span: 5, corpo: canvas('ch-est', 'tall') })}
        </div>`,
      after() {
        if (setores.length) Charts.bar($('#ch-estset'), { labels: setores.map((x) => x.setor), series: [{ label: 'Estabelecimentos', data: setores.map((x) => x.quantidade) }], fmtY: Fmt.int, horizontal: true });
        Charts.line($('#ch-est'), { labels: s.map((x) => x.ano), series: [{ label: 'Estabelecimentos', data: s.map((x) => x.total), color: Charts.paleta()[2] }], fmtY: Fmt.int });
      },
    };
  }

  function viewAgro() {
    const lav = D.agropecuaria.lavouras, reb = D.agropecuaria.rebanhos;
    if (!lav.itens.length && !reb.itens.length) return { html: secao('Agropecuária') + card({ titulo: 'Produção agropecuária', corpo: vazio() }) };
    const top = lav.itens.slice(0, 10);
    const principal = lav.itens[0];
    const area = lav.itens.reduce((t, x) => t + (x.area_colhida_ha || 0), 0);
    return {
      html: `
        ${secao('Agropecuária', 'Produção Agrícola Municipal (PAM) e Pesquisa da Pecuária Municipal (PPM)')}
        <div class="kpis">
          ${kpi({ label: 'Valor da produção agrícola', icone: 'leaf', valorHTML: lav.itens.length ? compactHTML(lav.valor_total, 'R$ ') : null, ref: lav.ano && `${lav.ano}` })}
          ${kpi({ label: 'Principal cultura', icone: 'trend', valorHTML: principal && esc(principal.produto.replace(/\s*\(.*\)/, '')), ref: principal && `${Fmt.dec1((principal.valor / lav.valor_total) * 100)}% do valor` })}
          ${kpi({ label: 'Área colhida', icone: 'chart', valorHTML: area ? `${Fmt.int(area)}<small>ha</small>` : null, ref: lav.ano && `${lav.ano}` })}
          ${kpi({ label: 'Maior rebanho', icone: 'cow', valorHTML: reb.itens[0] && `${Fmt.compact(reb.itens[0].cabecas)}<small>cab.</small>`, ref: reb.itens[0] && reb.itens[0].tipo })}
        </div>
        <div class="grid">
          ${card({ titulo: 'Principais lavouras por valor da produção', sub: lav.ano ? `${lav.ano}` : '', span: 7, corpo: top.length ? canvas('ch-lav', 'tall') : vazio(), fonte: lav.fonte })}
          ${card({ titulo: 'Efetivo dos rebanhos', sub: reb.ano ? `Cabeças · ${reb.ano}` : '', span: 5, corpo: reb.itens.length ? canvas('ch-reb', 'tall') : vazio(), fonte: reb.fonte })}
          ${card({ titulo: 'Detalhamento das lavouras', span: 12, corpo: tabela(['Produto', 'Valor', 'Quantidade', 'Área colhida (ha)'],
            lav.itens.map((x) => [esc(x.produto), Fmt.brlCompact(x.valor), `${Fmt.int(x.quantidade)} ${esc((x.unidade || '').toLowerCase())}`, Fmt.int(x.area_colhida_ha)])) })}
        </div>`,
      after() {
        if (top.length) Charts.bar($('#ch-lav'), { labels: top.map((x) => x.produto.replace(/\s*\(.*\)/, '')), series: [{ label: 'Valor', data: top.map((x) => x.valor), color: Charts.paleta()[4] }], fmtY: Fmt.brlCompact, horizontal: true });
        if (reb.itens.length) Charts.bar($('#ch-reb'), { labels: reb.itens.map((x) => x.tipo), series: [{ label: 'Cabeças', data: reb.itens.map((x) => x.cabecas), color: Charts.paleta()[2] }], fmtY: Fmt.compact, fmtTooltip: Fmt.int, horizontal: true });
      },
    };
  }

  // ------------------------------------------------------------------ //
  // Shell: navegação, tema, instalação                                 //
  // ------------------------------------------------------------------ //
  function montarNav() {
    $('#nav').innerHTML = VIEWS.map((v) => `<a href="#${v.id}" data-view="${v.id}">${icon(v.icon)}${v.label}</a>`).join('');
    $('#tabbar').innerHTML = VIEWS.map((v) => `<a href="#${v.id}" data-view="${v.id}">${icon(v.icon)}${v.curto}</a>`).join('');
  }

  function viewAtual() {
    const id = location.hash.replace('#', '');
    return VIEWS.find((v) => v.id === id) || VIEWS[0];
  }

  function render() {
    const v = viewAtual();
    document.querySelectorAll('[data-view]').forEach((a) => {
      if (a.dataset.view === v.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    Charts.destroyAll();
    const { html, after } = v.render();
    $('#view').innerHTML = html;
    document.title = `${v.label} · ${D.meta.municipio.nome} · Painel Municipal`;
    if (after) requestAnimationFrame(after);
  }

  function cabecalho() {
    const m = D.meta.municipio;
    $('#place-region').textContent = `${m.uf_nome} · Região ${m.regiao}`;
    $('#place-name').textContent = `${m.nome} – ${m.uf}`;
    const chips = [`Código IBGE ${m.codigo_ibge}`, `Microrregião ${m.microrregiao}`];
    $('#place-chips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
    $('#generated').textContent = D.meta.gerado_em ? `Dados atualizados em ${Fmt.data(D.meta.gerado_em)}.` : '';
    $('#sample-banner').hidden = !D.meta.amostra;
    const mte = [sigla('rais') === 'RAIS' && 'RAIS', D.caged.serie.length && 'Novo CAGED'].filter(Boolean);
    $('#sources').textContent = `Fontes: IBGE (Censo, Estimativas, PIB dos Municípios, ${sigla('rais') === 'CEMPRE' ? 'CEMPRE, ' : ''}PAM e PPM)`
      + (mte.length ? ` e Ministério do Trabalho (${mte.join(' e ')}).` : '.');
  }

  function lerTema() { try { return localStorage.getItem('tema'); } catch { return null; } }
  function salvarTema(t) { try { localStorage.setItem('tema', t); } catch { /* sem storage */ } }

  function aplicarTema(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
  }

  function temaEfetivo() {
    return document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function eventos() {
    window.addEventListener('hashchange', render);
    $('#btn-theme').addEventListener('click', () => {
      const novo = temaEfetivo() === 'dark' ? 'light' : 'dark';
      aplicarTema(novo); salvarTema(novo); render();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!lerTema()) render(); });

    $('#btn-share').addEventListener('click', async () => {
      const dados = { title: document.title, url: location.href };
      try {
        if (navigator.share) await navigator.share(dados);
        else { await navigator.clipboard.writeText(location.href); alert('Link copiado.'); }
      } catch { /* cancelado */ }
    });

    let promptInstalacao = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalacao = e; $('#btn-install').hidden = false; });
    $('#btn-install').addEventListener('click', async () => {
      if (!promptInstalacao) return;
      promptInstalacao.prompt();
      await promptInstalacao.userChoice;
      promptInstalacao = null; $('#btn-install').hidden = true;
    });
  }

  async function iniciar() {
    aplicarTema(lerTema());
    montarNav();
    eventos();
    try {
      const resp = await fetch('data/municipio.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error(resp.status);
      D = await resp.json();
    } catch (e) {
      $('#place-name').textContent = 'Não foi possível carregar os dados';
      $('#view').innerHTML = vazio('Arquivo data/municipio.json não encontrado.', 'Execute <code>python etl/coletar_dados.py --municipio &lt;código&gt;</code>.');
      return;
    }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    cabecalho();
    render();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  iniciar();
})();
