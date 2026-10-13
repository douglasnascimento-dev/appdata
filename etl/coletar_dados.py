#!/usr/bin/env python3
"""
Coleta os indicadores socioeconômicos de UM município e gera o arquivo
JSON consumido pelo PWA (app/data/municipio.json).

Fontes
------
IBGE (API SIDRA v3, pública, sem chave):
    - População ............ tabela 6579 (estimativas) + 4709 (Censo 2022)
    - PIB e VAB por setor .. tabela 5938 (PIB dos Municípios)
    - Lavouras ............. tabela 5457 (Produção Agrícola Municipal - PAM)
    - Rebanhos ............. tabela 3939 (Pesquisa da Pecuária Municipal - PPM)

IBGE - Cadastro Central de Empresas (padrão, sem chave):
    - Empregos formais (assalariados), salário médio, estabelecimentos e setores ... tabelas 1685, 9509, 9528

Ministério do Trabalho, via Base dos Dados (BigQuery, opcional - substitui o CEMPRE):
    - Empregos formais, remuneração média, empregos por setor ... RAIS vínculos
    - Estabelecimentos por setor ................................ RAIS estabelecimentos
    - Saldo de empregos (mensal) ................................ Novo CAGED

Uso
---
    python etl/coletar_dados.py --municipio 4106902
    python etl/coletar_dados.py --municipio "Pato Branco" --uf PR
    python etl/coletar_dados.py --municipio 4118501 --billing-project meu-projeto-gcp

Sem --billing-project, emprego/salário/estabelecimentos vêm do CEMPRE (IBGE)
e o saldo mensal de empregos (exclusivo do Novo CAGED) fica vazio.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades"
API_AGREGADOS = "https://servicodados.ibge.gov.br/api/v3/agregados"

SAIDA_PADRAO = Path(__file__).resolve().parent.parent / "app" / "data" / "municipio.json"

# Valores especiais do SIDRA que significam "sem dado"
# "-" zero absoluto, ".." não se aplica, "..." não disponível, "X" sigiloso
VALORES_NULOS = {"-", "..", "...", "X", ""}

# CNAE 2.0: divisão (2 primeiros dígitos) -> seção
SECOES_CNAE = [
    ("A", "Agropecuária", range(1, 4)),
    ("B", "Indústrias extrativas", range(5, 10)),
    ("C", "Indústria de transformação", range(10, 34)),
    ("D", "Eletricidade e gás", range(35, 36)),
    ("E", "Água, esgoto e resíduos", range(36, 40)),
    ("F", "Construção", range(41, 44)),
    ("G", "Comércio", range(45, 48)),
    ("H", "Transporte e armazenagem", range(49, 54)),
    ("I", "Alojamento e alimentação", range(55, 57)),
    ("J", "Informação e comunicação", range(58, 64)),
    ("K", "Financeiro e seguros", range(64, 67)),
    ("L", "Atividades imobiliárias", range(68, 69)),
    ("M", "Atividades profissionais e técnicas", range(69, 76)),
    ("N", "Atividades administrativas", range(77, 83)),
    ("O", "Administração pública", range(84, 85)),
    ("P", "Educação", range(85, 86)),
    ("Q", "Saúde e serviços sociais", range(86, 89)),
    ("R", "Artes, cultura e esporte", range(90, 94)),
    ("S", "Outros serviços", range(94, 97)),
    ("T", "Serviços domésticos", range(97, 98)),
    ("U", "Organismos internacionais", range(99, 100)),
]

# Agrupamento das seções em grandes setores (compatível com o VAB do PIB)
GRANDES_SETORES = {
    "A": "Agropecuária",
    "B": "Indústria", "C": "Indústria", "D": "Indústria", "E": "Indústria",
    "F": "Construção",
    "G": "Comércio",
    "O": "Administração pública",
}


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", file=sys.stderr)


def http_get_json(url: str, tentativas: int = 4):
    """GET com retry exponencial (a API do IBGE oscila com frequência)."""
    ultimo_erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "appdata-etl/1.0", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                corpo = resp.read()
            # O IBGE às vezes responde em gzip mesmo sem o cliente pedir
            if corpo[:2] == b"\x1f\x8b":
                corpo = gzip.decompress(corpo)
            return json.loads(corpo.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            ultimo_erro = e
            espera = 2 ** (i + 1)
            log(f"  falha ({e}); nova tentativa em {espera}s")
            time.sleep(espera)
    raise RuntimeError(f"Falha ao acessar {url}: {ultimo_erro}")


def numero(valor):
    if valor is None or str(valor).strip() in VALORES_NULOS:
        return None
    try:
        return float(valor)
    except ValueError:
        return None


def sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn").lower()


def secao_cnae(cnae: str | None) -> str | None:
    if not cnae:
        return None
    try:
        divisao = int(str(cnae)[:2])
    except ValueError:
        return None
    for letra, _, faixa in SECOES_CNAE:
        if divisao in faixa:
            return letra
    return None


def nome_secao(letra: str) -> str:
    return next((nome for l, nome, _ in SECOES_CNAE if l == letra), "Não classificado")


def grande_setor(letra: str | None) -> str:
    if letra is None:
        return "Não classificado"
    return GRANDES_SETORES.get(letra, "Serviços")


# --------------------------------------------------------------------------- #
# IBGE - Localidades e SIDRA
# --------------------------------------------------------------------------- #
def resolver_municipio(municipio: str, uf: str | None) -> dict:
    """Aceita o código IBGE (7 dígitos) ou o nome do município."""
    if municipio.isdigit():
        dados = http_get_json(f"{API_LOCALIDADES}/municipios/{municipio}")
        if not dados:
            raise SystemExit(f"Município {municipio} não encontrado no IBGE.")
    else:
        url = f"{API_LOCALIDADES}/estados/{uf}/municipios" if uf else f"{API_LOCALIDADES}/municipios"
        candidatos = [m for m in http_get_json(url) if sem_acento(m["nome"]) == sem_acento(municipio)]
        if not candidatos:
            raise SystemExit(f"Município '{municipio}' não encontrado. Informe --uf ou o código IBGE.")
        if len(candidatos) > 1:
            opcoes = ", ".join(f"{m['nome']}/{m['microrregiao']['mesorregiao']['UF']['sigla']} ({m['id']})" for m in candidatos)
            raise SystemExit(f"Nome ambíguo. Use --uf ou o código: {opcoes}")
        dados = candidatos[0]

    uf_info = dados["microrregiao"]["mesorregiao"]["UF"]
    return {
        "codigo_ibge": str(dados["id"]),
        "nome": dados["nome"],
        "uf": uf_info["sigla"],
        "uf_nome": uf_info["nome"],
        "regiao": uf_info["regiao"]["nome"],
        "microrregiao": dados["microrregiao"]["nome"],
        "mesorregiao": dados["microrregiao"]["mesorregiao"]["nome"],
    }


def sidra(tabela: int, variaveis: list[int], codigo: str, periodos: str = "all",
          classificacao: str | None = None) -> list[dict]:
    """
    Consulta um agregado do SIDRA e devolve linhas "achatadas":
    {variavel_id, variavel, unidade, categoria, periodo, valor}
    """
    vars_ = "|".join(str(v) for v in variaveis)
    params = {"localidades": f"N6[{codigo}]"}
    if classificacao:
        params["classificacao"] = classificacao
    url = f"{API_AGREGADOS}/{tabela}/periodos/{periodos}/variaveis/{vars_}?{urllib.parse.urlencode(params, safe='[]|,')}"
    log(f"  SIDRA {tabela}: {url}")
    resposta = http_get_json(url)

    linhas = []
    for var in resposta:
        for resultado in var.get("resultados", []):
            categoria = None
            for c in resultado.get("classificacoes", []):
                categoria = next(iter(c["categoria"].values()), None)
            for serie in resultado.get("series", []):
                for periodo, valor in serie["serie"].items():
                    linhas.append({
                        "variavel_id": int(var["id"]),
                        "variavel": var["variavel"],
                        "unidade": var.get("unidade"),
                        "categoria": categoria,
                        "periodo": periodo,
                        "valor": numero(valor),
                    })
    return linhas


def coletar_populacao(codigo: str) -> dict:
    log("População (IBGE)")
    serie: dict[int, dict] = {}
    # Estimativas anuais (variável 9324 = população residente estimada)
    for l in sidra(6579, [9324], codigo):
        if l["valor"] is not None:
            serie[int(l["periodo"])] = {"ano": int(l["periodo"]), "valor": l["valor"], "fonte": "Estimativa IBGE"}
    # Censo 2022 (variável 93 = população residente) tem prioridade sobre estimativa
    try:
        for l in sidra(4709, [93], codigo):
            if l["valor"] is not None:
                serie[int(l["periodo"])] = {"ano": int(l["periodo"]), "valor": l["valor"], "fonte": "Censo IBGE"}
    except RuntimeError as e:
        log(f"  Censo 2022 indisponível: {e}")

    lista = [serie[a] for a in sorted(serie)]
    for i, item in enumerate(lista):
        anterior = lista[i - 1]["valor"] if i else None
        item["variacao_pct"] = round((item["valor"] / anterior - 1) * 100, 3) if anterior else None
    return {"serie": lista, "fonte": "IBGE - Estimativas de População (6579) e Censo 2022 (4709)"}


def populacao_por_ano(populacao: list[dict]) -> dict[int, float]:
    """Série anual completa; anos sem estimativa (ex.: 2007, 2010, 2023) são interpolados linearmente."""
    pop = {p["ano"]: p["valor"] for p in populacao}
    anos = sorted(pop)
    for a, b in zip(anos, anos[1:]):
        for ano in range(a + 1, b):
            pop[ano] = pop[a] + (pop[b] - pop[a]) * (ano - a) / (b - a)
    return pop


def coletar_pib(codigo: str, populacao: list[dict]) -> dict:
    log("PIB e VAB (IBGE)")
    campos = {
        37: "pib",            # PIB a preços correntes (mil R$)
        498: "vab_total",
        513: "vab_agropecuaria",
        517: "vab_industria",
        6575: "vab_servicos",  # exclusive administração pública
        525: "vab_adm_publica",
        543: "impostos",
    }
    anos: dict[int, dict] = {}
    for l in sidra(5938, list(campos), codigo):
        ano = int(l["periodo"])
        anos.setdefault(ano, {"ano": ano})[campos[l["variavel_id"]]] = l["valor"]

    pop = populacao_por_ano(populacao)
    for ano, item in anos.items():
        # Valores do SIDRA vêm em mil R$ -> converte para R$
        for k in list(item):
            if k != "ano" and item[k] is not None:
                item[k] = item[k] * 1000
        habitantes = pop.get(ano)
        item["pib_per_capita"] = round(item["pib"] / habitantes, 2) if item.get("pib") and habitantes else None
    return {"serie": [anos[a] for a in sorted(anos)], "unidade": "R$ correntes",
            "fonte": "IBGE - PIB dos Municípios (tabela 5938)"}


def coletar_agro(codigo: str) -> dict:
    log("Produção agropecuária (IBGE)")
    lavouras: dict[str, dict] = {}
    ano_pam = None
    # 214 quantidade produzida, 215 valor da produção (mil R$), 216 área colhida (ha)
    for l in sidra(5457, [214, 215, 216], codigo, periodos="-1", classificacao="782[all]"):
        produto = l["categoria"]
        if not produto or produto.lower() == "total":
            continue
        ano_pam = int(l["periodo"])
        item = lavouras.setdefault(produto, {"produto": produto})
        if l["variavel_id"] == 214:
            item["quantidade"], item["unidade"] = l["valor"], l["unidade"]
        elif l["variavel_id"] == 215:
            item["valor"] = l["valor"] * 1000 if l["valor"] is not None else None
        else:
            item["area_colhida_ha"] = l["valor"]
    # Produtos com subdivisão vêm como "Café (em grão) Total" + "Café (em grão) Arábica";
    # mantém só o total para não contar duas vezes
    for nome in [n for n in lavouras if n.endswith(" Total")]:
        base = nome[: -len(" Total")]
        for sub in [n for n in lavouras if n.startswith(base + " ") and n != nome]:
            del lavouras[sub]
        lavouras[nome]["produto"] = base
    for item in lavouras.values():
        # No SIDRA, "*" marca produtos cuja quantidade é em mil frutos (abacaxi, coco-da-baía)
        if item["produto"].endswith("*"):
            item["produto"] = item["produto"].rstrip("*").strip()
            item["unidade"] = "Mil frutos"
    lista_lav = sorted((v for v in lavouras.values() if v.get("valor")), key=lambda x: -x["valor"])

    rebanhos = []
    ano_ppm = None
    try:
        # 105 efetivo dos rebanhos (cabeças), classificação 79 = tipo de rebanho
        for l in sidra(3939, [105], codigo, periodos="-1", classificacao="79[all]"):
            tipo = l["categoria"] or ""
            # "Galináceos - galinhas" e "Suíno - matrizes" são subconjuntos do total do rebanho
            if not tipo or tipo.lower() == "total" or not l["valor"]:
                continue
            if " - " in tipo and not tipo.lower().endswith(" - total"):
                continue
            ano_ppm = int(l["periodo"])
            rebanhos.append({"tipo": tipo.replace(" - total", ""), "cabecas": l["valor"]})
    except RuntimeError as e:
        log(f"  PPM indisponível: {e}")

    return {
        "lavouras": {"ano": ano_pam, "itens": lista_lav, "valor_total": sum(v["valor"] for v in lista_lav),
                     "fonte": "IBGE - Produção Agrícola Municipal (tabela 5457)"},
        "rebanhos": {"ano": ano_ppm, "itens": sorted(rebanhos, key=lambda x: -x["cabecas"]),
                     "fonte": "IBGE - Pesquisa da Pecuária Municipal (tabela 3939)"},
    }


def coletar_cempre(codigo: str) -> dict:
    """
    Emprego, salário e estabelecimentos pelo Cadastro Central de Empresas (CEMPRE/IBGE).
    Não exige conta no Google Cloud. Não tem saldo mensal (isso só o CAGED fornece).
    """
    log("Emprego, salário e estabelecimentos (IBGE - CEMPRE)")
    # 706 unidades locais, 708 pessoal ocupado assalariado, 10143 salário médio mensal (R$)
    anos: dict[int, dict] = {}
    for tabela in (1685, 9509):  # série até 2021 + série a partir de 2022
        for l in sidra(tabela, [706, 708, 10143], codigo):
            if l["valor"] is None:
                continue
            item = anos.setdefault(int(l["periodo"]), {})
            item[l["variavel_id"]] = l["valor"]

    # Por seção da CNAE no último ano: 706 unidades locais, 708 assalariados, 662 salários (mil R$)
    meta = http_get_json(f"{API_AGREGADOS}/9528/metadados")
    cnae = next(c for c in meta["classificacoes"] if c["id"] == 12762)
    secoes = {c["id"]: c["nome"] for c in cnae["categorias"] if c.get("nivel") == 1}
    ids = ",".join(str(i) for i in secoes)
    setores: dict[str, dict] = {}
    ano_setor = None
    for l in sidra(9528, [706, 708, 662], codigo, periodos="-1", classificacao=f"12762[{ids}]"):
        if l["valor"] is None or not l["categoria"]:
            continue
        ano_setor = int(l["periodo"])
        letra = l["categoria"].split(" ", 1)[0]
        s = setores.setdefault(letra, {"letra": letra, 706: 0.0, 708: 0.0, 662: 0.0})
        s[l["variavel_id"]] += l["valor"]

    emprego_setor: dict[str, dict] = {}
    for s in setores.values():
        g = emprego_setor.setdefault(grande_setor(s["letra"]), {"setor": grande_setor(s["letra"]), "empregos": 0, "massa": 0.0})
        g["empregos"] += int(s[708])
        g["massa"] += s[662] * 1000
    itens_emprego = sorted(
        # Mesma convenção do IBGE: salários do ano / (assalariados x 13 pagamentos)
        ({"setor": g["setor"], "empregos": g["empregos"],
          "remuneracao_media": round(g["massa"] / (g["empregos"] * 13), 2) if g["empregos"] else None}
         for g in emprego_setor.values() if g["empregos"]), key=lambda x: -x["empregos"])
    itens_estab = sorted(
        ({"setor": nome_secao(s["letra"]), "quantidade": int(s[706])} for s in setores.values() if s[706]),
        key=lambda x: -x["quantidade"])

    fonte = "IBGE - Cadastro Central de Empresas (CEMPRE), tabelas 1685, 9509 e 9528"
    return {
        "rais": {
            "sigla": "CEMPRE",
            "serie": [{"ano": a, "empregos": int(v[708]), "remuneracao_media": v.get(10143)}
                      for a, v in sorted(anos.items()) if 708 in v],
            "por_setor": {"ano": ano_setor, "itens": itens_emprego},
            "fonte": fonte + " · emprego = pessoal ocupado assalariado em 31/12",
        },
        "caged": {"serie": [], "fonte": "Novo CAGED não coletado (informe --billing-project)"},
        "estabelecimentos": {
            "sigla": "CEMPRE",
            "serie": [{"ano": a, "total": int(v[706])} for a, v in sorted(anos.items()) if 706 in v],
            "por_setor": {"ano": ano_setor, "itens": itens_estab},
            "fonte": fonte + " · unidades locais",
        },
    }


# --------------------------------------------------------------------------- #
# Ministério do Trabalho (RAIS / Novo CAGED) via Base dos Dados - BigQuery
# --------------------------------------------------------------------------- #
def _bq(billing_project: str, sql: str):
    import basedosdados as bd  # dependência opcional
    log("  BigQuery: " + " ".join(sql.split())[:110] + "...")
    return bd.read_sql(sql, billing_project_id=billing_project).to_dict("records")


def coletar_trabalho(codigo: str, billing_project: str, anos: int) -> dict:
    log("Emprego, remuneração e estabelecimentos (RAIS / CAGED via Base dos Dados)")

    rais_anual = _bq(billing_project, f"""
        SELECT ano,
               COUNT(*) AS empregos,
               AVG(valor_remuneracao_media) AS remuneracao_media
        FROM `basedosdados.br_me_rais.microdados_vinculos`
        WHERE id_municipio = '{codigo}' AND vinculo_ativo_3112 = '1'
          AND ano >= EXTRACT(YEAR FROM CURRENT_DATE()) - {anos}
        GROUP BY ano ORDER BY ano""")

    ultimo_ano = max((int(r["ano"]) for r in rais_anual), default=None)

    por_divisao = _bq(billing_project, f"""
        SELECT SUBSTR(cnae_2, 1, 2) AS divisao,
               COUNT(*) AS empregos,
               SUM(valor_remuneracao_media) AS massa
        FROM `basedosdados.br_me_rais.microdados_vinculos`
        WHERE id_municipio = '{codigo}' AND vinculo_ativo_3112 = '1' AND ano = {ultimo_ano}
        GROUP BY divisao""") if ultimo_ano else []

    estab = _bq(billing_project, f"""
        SELECT ano, SUBSTR(cnae_2, 1, 2) AS divisao, COUNT(*) AS quantidade
        FROM `basedosdados.br_me_rais.microdados_estabelecimentos`
        WHERE id_municipio = '{codigo}' AND quantidade_vinculos_ativos > 0
          AND ano >= EXTRACT(YEAR FROM CURRENT_DATE()) - {anos}
        GROUP BY ano, divisao""")

    caged = _bq(billing_project, f"""
        SELECT ano, mes,
               SUM(CASE WHEN saldo_movimentacao = 1 THEN 1 ELSE 0 END) AS admissoes,
               SUM(CASE WHEN saldo_movimentacao = -1 THEN 1 ELSE 0 END) AS desligamentos,
               SUM(saldo_movimentacao) AS saldo
        FROM `basedosdados.br_me_caged.microdados_movimentacao`
        WHERE id_municipio = '{codigo}'
          AND ano >= EXTRACT(YEAR FROM CURRENT_DATE()) - 3
        GROUP BY ano, mes ORDER BY ano, mes""")

    # Agrega divisões CNAE em grandes setores
    setores: dict[str, dict] = {}
    for r in por_divisao:
        nome = grande_setor(secao_cnae(r["divisao"]))
        s = setores.setdefault(nome, {"setor": nome, "empregos": 0, "massa": 0.0})
        s["empregos"] += int(r["empregos"])
        s["massa"] += float(r["massa"] or 0)
    emprego_setor = sorted(
        ({"setor": s["setor"], "empregos": s["empregos"],
          "remuneracao_media": round(s["massa"] / s["empregos"], 2) if s["empregos"] else None}
         for s in setores.values()), key=lambda x: -x["empregos"])

    estab_ano: dict[int, int] = {}
    estab_setor: dict[str, int] = {}
    ultimo_estab = max((int(r["ano"]) for r in estab), default=None)
    for r in estab:
        estab_ano[int(r["ano"])] = estab_ano.get(int(r["ano"]), 0) + int(r["quantidade"])
        if int(r["ano"]) == ultimo_estab:
            letra = secao_cnae(r["divisao"])
            nome = nome_secao(letra) if letra else "Não classificado"
            estab_setor[nome] = estab_setor.get(nome, 0) + int(r["quantidade"])

    return {
        "rais": {
            "serie": [{"ano": int(r["ano"]), "empregos": int(r["empregos"]),
                       "remuneracao_media": round(float(r["remuneracao_media"] or 0), 2)} for r in rais_anual],
            "sigla": "RAIS",
            "por_setor": {"ano": ultimo_ano, "itens": emprego_setor},
            "fonte": "MTE - RAIS (vínculos ativos em 31/12), via Base dos Dados",
        },
        "caged": {
            "serie": [{"ano": int(r["ano"]), "mes": int(r["mes"]), "admissoes": int(r["admissoes"]),
                       "desligamentos": int(r["desligamentos"]), "saldo": int(r["saldo"])} for r in caged],
            "fonte": "MTE - Novo CAGED, via Base dos Dados",
        },
        "estabelecimentos": {
            "sigla": "RAIS",
            "serie": [{"ano": a, "total": estab_ano[a]} for a in sorted(estab_ano)],
            "por_setor": {"ano": ultimo_estab,
                          "itens": sorted(({"setor": k, "quantidade": v} for k, v in estab_setor.items()),
                                          key=lambda x: -x["quantidade"])},
            "fonte": "MTE - RAIS Estabelecimentos (com ao menos 1 vínculo ativo), via Base dos Dados",
        },
    }


def trabalho_vazio(motivo: str) -> dict:
    return {
        "rais": {"serie": [], "por_setor": {"ano": None, "itens": []}, "fonte": motivo},
        "caged": {"serie": [], "fonte": motivo},
        "estabelecimentos": {"serie": [], "por_setor": {"ano": None, "itens": []}, "fonte": motivo},
    }


# --------------------------------------------------------------------------- #
# Orquestração
# --------------------------------------------------------------------------- #
def executar(etapa: str, status: list, func, *args, padrao=None):
    try:
        resultado = func(*args)
        status.append({"etapa": etapa, "ok": True})
        return resultado
    except Exception as e:  # noqa: BLE001 - uma fonte fora do ar não deve derrubar as outras
        log(f"  ERRO em {etapa}: {e}")
        status.append({"etapa": etapa, "ok": False, "erro": str(e)})
        return padrao


def main() -> None:
    p = argparse.ArgumentParser(description="Coleta indicadores de um município para o app.")
    p.add_argument("--municipio", required=True, help="Código IBGE (7 dígitos) ou nome do município")
    p.add_argument("--uf", help="Sigla da UF (ajuda a desambiguar nomes)")
    p.add_argument("--billing-project", help="Projeto GCP para consultas RAIS/CAGED na Base dos Dados")
    p.add_argument("--anos", type=int, default=10, help="Quantos anos de histórico da RAIS buscar (padrão 10)")
    p.add_argument("--saida", type=Path, default=SAIDA_PADRAO, help=f"Arquivo de saída (padrão {SAIDA_PADRAO})")
    args = p.parse_args()

    status: list[dict] = []
    municipio = resolver_municipio(args.municipio, args.uf)
    codigo = municipio["codigo_ibge"]
    log(f"Município: {municipio['nome']}/{municipio['uf']} ({codigo})")

    populacao = executar("populacao", status, coletar_populacao, codigo,
                         padrao={"serie": [], "fonte": "indisponível"})
    pib = executar("pib", status, coletar_pib, codigo, populacao["serie"],
                   padrao={"serie": [], "fonte": "indisponível"})
    agro = executar("agropecuaria", status, coletar_agro, codigo,
                    padrao={"lavouras": {"ano": None, "itens": [], "valor_total": 0, "fonte": "indisponível"},
                            "rebanhos": {"ano": None, "itens": [], "fonte": "indisponível"}})

    trabalho = None
    if args.billing_project:
        trabalho = executar("trabalho_rais_caged", status, coletar_trabalho, codigo, args.billing_project, args.anos)
    else:
        log("Sem --billing-project: usando CEMPRE/IBGE no lugar da RAIS; saldo do CAGED não será coletado.")
    if trabalho is None:
        trabalho = executar("trabalho_cempre", status, coletar_cempre, codigo,
                            padrao=trabalho_vazio("indisponível"))

    saida = {
        "meta": {
            "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "amostra": False,
            "municipio": municipio,
            "etapas": status,
        },
        "populacao": populacao,
        "pib": pib,
        **trabalho,
        "agropecuaria": agro,
    }

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    args.saida.write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding="utf-8")
    falhas = [s["etapa"] for s in status if not s["ok"]]
    log(f"Arquivo gerado: {args.saida}" + (f" (com falhas em: {', '.join(falhas)})" if falhas else ""))


if __name__ == "__main__":
    main()
