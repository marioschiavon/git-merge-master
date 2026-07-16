## Diagnóstico

A conversa continua travada porque o backend ainda está tentando inicializar `hook7-webhook` com o import antigo:

`npm:opus-decoder@0.7.11` → não exporta `OggOpusDecoder`

Enquanto essa função não sobe, nenhum evento do WhatsApp é processado: nem áudio, nem texto. Por isso as mensagens do Mario não aparecem na conversa.

No código local o import já está correto (`npm:ogg-opus-decoder@0.1.16`), então o problema mais provável é deploy/cache/lock de função ainda rodando a versão antiga ou uma dependência de áudio incompatível bloqueando o boot da função inteira.

## Plano de correção

1. **Remover o acoplamento que derruba o webhook inteiro**
   - Tirar o import estático de transcrição de áudio do topo de `hook7-webhook`.
   - Carregar a transcrição apenas quando chegar áudio inbound.
   - Assim, mesmo que a biblioteca de áudio falhe, mensagens de texto continuam aparecendo normalmente.

2. **Manter áudio como falha controlada**
   - Se a transcrição ou decoder falhar, gravar a mensagem como `[áudio não transcrito]` com o erro em `metadata.hook7.audio`.
   - Não deixar falha de STT impedir o insert em `messages`.

3. **Garantir refresh da conversa no app**
   - Revisar o realtime/query da tela de conversas para garantir que novas mensagens invalidem também a lista de conversas, não só a thread aberta.
   - Se necessário, adicionar assinatura realtime em `messages`/`conversations` por empresa para destravar a lista.

4. **Validar pelos sinais corretos**
   - Checar logs de `hook7-webhook` após a alteração: deve aparecer `booted`, sem `BootFailure` de decoder.
   - Confirmar que mensagem de texto inbound é inserida mesmo sem áudio.
   - Confirmar que áudio não trava o webhook; no pior caso aparece como `[áudio não transcrito]` e a conversa segue funcionando.

## Fora do escopo

- Trocar provedor/modelo de IA.
- Reestruturar a integração Hook7 inteira.
- Alterar regras de negócio de leads/cadências.