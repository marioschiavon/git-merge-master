## Plano

1. **Trocar autenticação do STT para o padrão do Lovable AI**
   - A chamada atual para `/v1/audio/transcriptions` está indo com `Authorization: Bearer ...`.
   - Vou ajustar para usar o header correto `Lovable-API-Key`, que é o padrão documentado para o gateway.

2. **Preservar o mimetype real do áudio baixado**
   - Se o Hook7 entregar `audio/ogg; codecs=opus`, manter o tipo limpo como `audio/ogg` e nomear o arquivo como `.ogg`.
   - Evitar converter ou renomear para `.wav` quando não for WAV real.

3. **Melhorar diagnóstico sem quebrar a conversa**
   - Continuar salvando a mensagem como `[áudio não transcrito]` se o provedor rejeitar o arquivo.
   - Guardar no metadata o erro do STT, tamanho do arquivo e mimetype para sabermos se o Hook7 está entregando arquivo inválido/corrompido.

4. **Validar com logs reais**
   - Verificar os logs do AI Gateway e da função após a correção.
   - Evidência atual: request `019f6ca2-2b3a-74b2-8fc3-d1801670b52f` em `2026-07-16T20:33:15Z` chegou como `audio.ogg`, `audio/ogg`, 12074 bytes, mas o provedor retornou `400: Audio file might be corrupted or unsupported`.

## Resultado esperado

- Mensagens de texto continuam aparecendo normalmente.
- Áudios válidos passam a ser transcritos.
- Se ainda aparecer `[áudio não transcrito]`, teremos evidência clara de que o arquivo baixado do Hook7 está vindo inválido/corrompido ou em formato não aceito, em vez de ser falha genérica do app.