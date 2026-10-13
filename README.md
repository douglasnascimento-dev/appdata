# Painel Municipal

PWA com indicadores socioeconômicos de **um município**, alimentado por um script Python que coleta dados públicos.

Município configurado: **Nova América da Colina – PR** (código IBGE 4116604).

| # | Indicador | Fonte |
|---|-----------|-------|
| 1 | População | IBGE – SIDRA 6579 (estimativas) e 4709 (Censo 2022) |
| 2 | Variação populacional | calculada a partir da série acima |
| 3 | PIB municipal | IBGE – SIDRA 5938 |
| 4 | PIB per capita | PIB ÷ população do mesmo ano |
| 5 | VAB por setor | IBGE – SIDRA 5938 |
| 6 | Empregos formais | IBGE – CEMPRE (1685, 9509); ou RAIS via Base dos Dados |
| 7 | Saldo de empregos | Anual pelo CEMPRE; mensal só com Novo CAGED via Base dos Dados |
| 8 | Remuneração média | IBGE – CEMPRE (salário médio mensal); ou RAIS |
| 9 | Estabelecimentos por setor | IBGE – CEMPRE (9528, unidades locais por seção CNAE); ou RAIS |
| 10 | Produção agropecuária | IBGE – PAM (5457) e PPM (3939) |

## Estrutura

```
etl/coletar_dados.py   coleta e gera app/data/municipio.json
app/                   PWA (HTML/CSS/JS puro, sem build)
  data/municipio.json  dados consumidos pelo app (vem com dados FICTÍCIOS de exemplo)
  sw.js                service worker (funciona offline)
```

## 1. Coletar os dados

Sem dependências além do Python 3.10+ (todos os dados vêm do IBGE):

```bash
python etl/coletar_dados.py --municipio 4116604          # pelo código IBGE
python etl/coletar_dados.py --municipio "Pato Branco" --uf PR   # pelo nome
```

Para usar **RAIS e Novo CAGED** no lugar do CEMPRE (inclui o saldo **mensal** de empregos) é preciso
um projeto no Google Cloud (a consulta à Base dos Dados é gratuita até 1 TB/mês):

```bash
pip install -r etl/requirements.txt
python etl/coletar_dados.py --municipio 4116604 --billing-project SEU_PROJETO_GCP
```

Na primeira execução o pacote `basedosdados` abre o login do Google. Cada etapa é independente:
se uma fonte estiver fora do ar, as demais são gravadas normalmente e a falha fica registrada em `meta.etapas`.

Sugestão de agenda: CAGED mensalmente; IBGE e RAIS uma vez por ano (ou mensalmente, sem custo).

## 2. Rodar o app

```bash
python -m http.server 8000 -d app
# abra http://localhost:8000
```

Para instalar como app no celular, publique a pasta `app/` em qualquer hospedagem estática com HTTPS
(GitHub Pages, Netlify, Vercel, Cloudflare Pages) e use "Adicionar à tela inicial".

Ao trocar os dados, aumente `VERSAO` em `app/sw.js` se também alterar arquivos do app.

## Observações

- PIB e valores agropecuários estão em R$ correntes (sem correção pela inflação).
- O PIB municipal é divulgado com cerca de 2 anos de atraso; a RAIS com cerca de 1 ano; o CAGED é mensal.
  Cada card mostra o ano de referência.
- Os anos mais recentes do PIB saem só com o total; a divisão por setor (VAB) aparece no ano seguinte.
  O app usa automaticamente o último ano com VAB disponível.
- Para o PIB per capita, anos sem estimativa de população (ex.: 2023) usam interpolação linear.
- CEMPRE: "empregos formais" = pessoal ocupado assalariado em 31/12; remuneração por setor é estimada
  como salários do ano ÷ (assalariados × 13).
- Valores sigilosos ou indisponíveis no SIDRA (`X`, `-`, `...`) viram vazio.
