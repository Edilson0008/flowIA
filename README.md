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

Sua GPU local (ex: 2 GB) não roda nenhum modelo vocal — o caminho grátis é
GPU gratuita na nuvem + modelo open-source **ACE-Step 1.5** (MIT, qualidade
próxima ao Suno v4.5/v5):

1. Abra **`colab-voz-ia.ipynb`** no Google Colab com GPU grátis (T4):
   https://colab.research.google.com (upload do arquivo do repo).
2. Rode as células 1→4: gera música **cantada** com sua letra e baixa o MP3.
3. (Integração total) Rode a célula 5 (ngrok grátis), cole a URL no `.env`:
   `ACESTEP_API_URL=https://xxxx.ngrok.io` → o botão **Criar** do app passa
   a gerar com vocais reais; o MP3 é salvo em `public/vocals/`.
4. Sem instalar nada: https://acemusic.ai (oficial, grátis) ou
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
