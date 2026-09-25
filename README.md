# Flow AI — Crie Músicas com IA (estilo Suno)

Descreva a música → receba **2 variações prontas** com estrutura completa
(intro, versos, refrões, ponte, outro), letra em português com **karaokê**,
e exportação em **WAV** e **MIDI**. Sem chave de API, sem erro.

## Como rodar

Pré-requisitos: **Node.js 18+**

```bash
npm install
npm run dev            # http://localhost:3000
```

Opcional (refino da variação A via Gemini): crie `.env` com `GEMINI_API_KEY=...`.

Produção: `npm run build` + `npm start`.

## Como funciona

- `POST /api/generate-music` — Motor Flow: composição por seções com intensidade
  (refrão com lift de oitava, viradas de bateria, arpejos, coro vocal), instrumentação
  automática por estilo, 2 variações por pedido, letras com `startBeat`/`timestamp`.
  Se houver `GEMINI_API_KEY`, tenta refinar a variação A; senão, tudo local.
- `POST /api/enhance-prompt` — melhora o prompt (com ou sem chave).
- `GET /api/engines`, `GET /api/health` — motores e status.

## 🎤 Vocais reais GRÁTIS (estilo Suno de verdade)

**Jeito simples (2 min, sem Colab):** o app já vem ligado na demo pública do
ACE-Step. Crie conta grátis em https://huggingface.co/join, gere um token em
Settings → Access Tokens e coloque no `.env`:

```
HF_TOKEN=hf_seu_token_aqui
```

Pronto — o botão **Criar** gera música **cantada** (com letra e karaokê com
tempos reais). Sem token, tenta anônimo e cai no motor local se a fila negar.

**Jeito Colab (GPU dedicada, sem fila):** abra **`colab-voz-ia.ipynb`** no
Google Colab com GPU grátis, rode 1→4 e baixe o MP3 — ou rode a célula 5 e
cole a URL em `ACESTEP_API_URL=` no `.env` para integrar ao botão Criar.

**Sem instalar nada:** https://acemusic.ai (oficial, grátis) ou
https://huggingface.co/spaces/ACE-Step/Ace-Step-v1.5 (demo).

Alternativa paga: `REPLICATE_API_TOKEN` (minimax/music-01) — centavos por faixa.

## Telas

- **Criar** — prompt, estilos, clima, BPM, tom, duração (30s/60s), 2 resultados com
  player, karaokê, WAV/MIDI e "Abrir no Estúdio".
- **Biblioteca** — todas as criações salvas (IndexedDB), com busca, filtros,
  favoritos, preview e exportação.
- **Estúdio** — DAW multi-faixas: editar notas, volumes, instrumentos e exportar.

## Som

`audioEngine.ts` — sintetizador Web Audio com master bus (reverb por convolução,
delay com feedback e compressor), render offline para WAV 44.1kHz.
