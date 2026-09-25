# Melodix AI — Crie Músicas com IA

Gere músicas inéditas com IA, edite no DAW multi-faixas e exporte em **MIDI** e **WAV**.

## Como rodar

Pré-requisitos: **Node.js 18+**

```bash
npm install
cp .env.example .env   # opcional: preencha GEMINI_API_KEY para refinamento via Gemini
npm run dev            # http://localhost:3000
```

Build de produção:

```bash
npm run build
npm start              # NODE_ENV=production
```

## Motor de criação (corrigido)

O botão **"Criar Música Agora"** (`POST /api/generate-music`) nunca mais retorna erro genérico:

- **Antes:** usava o modelo inexistente `gemini-3.8-flash` e chamava o Lyria via `generateContent`
  (API errada) — qualquer clique falhava. O `MusicCreator` ainda vinha com `lyria-clip` como padrão.
- **Agora:** compositor local determinístico (teoria musical: progressão no tom, melodia pentatônica,
  baixo com groove, bateria por estilo) **sempre** gera o arranjo; se houver `GEMINI_API_KEY`,
  o Gemini (modelos válidos `gemini-2.0-flash`/`gemini-1.5-flash`) tenta refinar o JSON, com fallback
  automático para o arranjo local. O padrão do frontend passou a ser `gemini-flash`.
- Prompt vazio retorna `400` com mensagem clara em vez de `500`.
- `POST /api/enhance-prompt` também funciona sem chave (template local).
- `GET /api/engines` lista os motores disponíveis; `GET /api/health` indica `geminiEnabled`.

## Estrutura

- `server.ts` — Express + Vite middleware (dev) / estáticos (prod), sync em `.data/`
- `src/components/MusicCreator.tsx` — tela de criação
- `src/components/DawEditor.tsx` — editor multi-faixas
- `src/services/audioEngine.ts` — sintetizador Web Audio + export WAV
- `src/services/midiEncoder.ts` — export MIDI
- `src/services/storage.ts` / `cloudSync.ts` — persistência offline + sync
