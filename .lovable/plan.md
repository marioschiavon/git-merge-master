## Diagnóstico

O log do `hook7-webhook` mostra o erro exato:

```
STT falhou [400]: "Audio file might be corrupted or unsupported"
  type: invalid_request_error, param: file
```

O áudio chega do WhatsApp em **OGG/Opus** (formato padrão do WhatsApp) e está sendo enviado para `openai/gpt-4o-transcribe`, que **não aceita OGG/Opus** — só WAV, MP3, M4A, WebM, FLAC. A própria documentação do Lovable STT afirma: *"WhatsApp/Telegram audio is OGG/Opus, which the transcription models reject — convert it to WAV or MP3 first."*

Resultado: toda mensagem de voz do WhatsApp cai no fallback `[áudio não transcrito]` e o pipeline da IA é pulado, entregando a conversa para takeover humano.

## Solução

Alterar `supabase/functions/_shared/transcribe-audio.ts` para tratar OGG/Opus de forma diferente:

- **OGG/Opus** → enviar para `google/gemini-2.5-flash` via `/v1/chat/completions` com bloco `input_audio` (o Gemini aceita OGG nativamente).
- **Demais formatos (WAV, MP3, M4A, WebM, FLAC)** → continuam em `openai/gpt-4o-transcribe` como hoje.

A função `transcribeAudio()` mantém a mesma assinatura, então `hook7-webhook` não muda. Apenas escolhe internamente qual modelo/endpoint usar com base no `mimetype`.

## Passos técnicos

1. Em `_shared/transcribe-audio.ts`:
   - Adicionar `transcribeWithGemini(base64, mimetype)` que faz `POST https://ai.gateway.lovable.dev/v1/chat/completions` com:
     ```json
     {
       "model": "google/gemini-2.5-flash",
       "messages": [{"role":"user","content":[
         {"type":"text","text":"Transcreva este áudio em português. Responda somente com o texto transcrito, sem comentários."},
         {"type":"input_audio","input_audio":{"data":"<base64>","format":"ogg"}}
       ]}]
     }
     ```
   - Extrair `choices[0].message.content` como `text`.
   - Em `transcribeAudio()`, se `mimetype` incluir `ogg`/`opus`, rotear para Gemini; caso contrário, manter o caminho atual.
   - Tratar 429/402/erros com as mesmas mensagens.

2. Deploy do edge function `hook7-webhook` (que importa o shared).

## Fora do escopo

- Não vamos transcodificar áudio no edge (ffmpeg não é trivial em Deno Edge Runtime).
- Não vamos alterar o comportamento de takeover humano quando a transcrição realmente falhar — só reduzir a taxa de falhas.
- Não vamos mexer no fluxo de e-mail nem em outras integrações.

## Como validar

Após o deploy, mandar um áudio novo pelo WhatsApp para um lead de teste (o Mario da S7, já limpo). Esperado no log do `hook7-webhook`:
- ausência de `STT falhou [400]`;
- mensagem inbound com `content` = texto transcrito (não mais `[áudio não transcrito]`);
- pipeline da IA (SDR agent) executa normalmente.