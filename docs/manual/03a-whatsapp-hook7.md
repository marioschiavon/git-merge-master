# 03a. WhatsApp

**Quando usar:** você vai enviar mensagens de WhatsApp dentro das cadências.
**Pré-requisitos:** um número de celular **dedicado à prospecção** — de preferência um chip novo, **não** o seu WhatsApp pessoal.

## Como funciona (em linguagem simples)

O Leaderei conecta-se ao WhatsApp da mesma forma que o **WhatsApp Web** — usando um **QR-Code**. QR-Code é aquele quadradinho de pontos pretos que você escaneia com a câmera do celular. Depois de escanear, o Leaderei passa a enviar e receber mensagens em nome daquele número, 24h por dia.

O celular precisa **ficar ligado e com internet**, mesmo depois de conectado — igualzinho ao WhatsApp Web.

## Passo a passo

### 1. Abrir a tela de conexão

No Leaderei: **Configurações → Integrações → WhatsApp** → clique **Gerenciar instância** → **Criar instância**.

Um **QR-Code** vai aparecer na tela do computador.

### 2. Abrir o WhatsApp no celular certo

Pegue o **celular do número dedicado** (não o seu pessoal). No aplicativo WhatsApp, siga este caminho:

- **Android:** toque nos **três pontinhos** no canto superior direito → **Aparelhos conectados** → **Conectar um aparelho**.
- **iPhone:** toque em **Configurações** (canto inferior direito) → **Aparelhos conectados** → **Conectar um aparelho**.

O celular vai abrir a câmera pedindo para você apontar para um QR-Code.

### 3. Escanear

Aponte a câmera do celular para o QR-Code que está na tela do computador. Em 1-2 segundos o status muda para **Conectado ✅**.

### 4. Testar

Clique **Testar conexão** — o Leaderei envia uma mensagem para o próprio número, para confirmar que tudo funciona.

## Dicas importantes

- **Sempre use um chip dedicado.** Se o WhatsApp banir o número por volume alto, você não perde o seu pessoal.
- **Comece devagar:** 30 a 50 mensagens por dia na primeira semana. Números novos com volume alto são banidos rapidamente.
- **Deixe o celular carregando e conectado ao Wi-Fi.** Se ele ficar horas offline, a conexão cai.
- **Só responde leads cadastrados.** Mensagens vindas de números que **não** estão como lead na base são ignoradas silenciosamente — o Leaderei não cria lead automático nem responde. Para atender um novo contato, cadastre-o em **Leads** primeiro. Grupos, listas de transmissão e newsletters também são sempre ignorados.

## Quando a conexão cai

Antes de qualquer aviso, o Leaderei **tenta religar a conexão sozinho**: em quedas passageiras (oscilação de internet no celular, falta de sinal por alguns minutos, reinício do servidor) são feitas até 2 tentativas automáticas, espaçadas em 10 minutos, dentro da primeira hora fora do ar. Se a conexão voltar, nada é exibido e nenhum e-mail é enviado.

A tentativa automática **não acontece** quando o WhatsApp encerrou a sessão (só a leitura do QR-Code resolve) nem quando o WhatsApp recusou o número — nesse caso, insistir é o caminho mais rápido para o bloqueio definitivo.

Se a conexão não voltar sozinha, o Leaderei avisa de três formas:

1. **Aviso vermelho no topo do app** — diz qual conexão caiu, **o motivo** em linguagem simples e **há quanto tempo** ela está fora (ex.: "fora do ar há 2 dias"). O botão **Reconectar** abre direto a janela do WhatsApp, pronta para a leitura do QR-Code.
2. **E-mail ao administrador** — o primeiro aviso chega 30 minutos após a queda. Se a conexão continuar fora, chega um **lembrete a cada 24 horas**, até o máximo de 3 lembretes.
3. **Arquivamento após 7 dias** — se ninguém reconectar em 7 dias, a conexão é arquivada e o aviso some. Ela pode ser reconectada a qualquer momento.

### O que cada motivo significa

- **"O aparelho encerrou a sessão"** → alguém clicou em **Sair** nos aparelhos conectados do WhatsApp, ou o celular ficou muito tempo sem internet. Solução: ler o QR-Code de novo.
- **"O WhatsApp recusou a reconexão"** → o próprio WhatsApp recusou aquele número, o que costuma acontecer quando há **volume alto de envios ou denúncias de contatos**. Nesse caso, o aviso e o e-mail incluem um link para a página **Boas Práticas de envio** do app — leia antes de tentar de novo, e reduza o ritmo de envios.

> **Importante:** em nenhum desses casos a falha é do Leaderei ou do provedor de conexão — o encerramento parte sempre do WhatsApp/celular. Reconectar lendo o QR-Code resolve a grande maioria dos casos.

## Problemas comuns

- **"O QR-Code expirou"** → clique **Gerar novo** e escaneie em até 60 segundos.
- **"Reconexão necessária"** → selecione a conexão e clique **Reconectar**; leia o QR-Code de novo. Não é preciso excluir nada: a conexão, as conversas e os leads continuam os mesmos.
- **Status "Desconectado" depois de 1 dia** → o WhatsApp desloga aparelhos que ficam muito tempo sem contato. É só refazer o passo 2 e escanear de novo.
- **"As mensagens não estão saindo"** → confira se o horário atual está dentro da **janela de envio** configurada em Configurações Gerais.


**Próximo passo →** [03b. Email](./03b-email-resend.md)

## Quando o lead envia um cartão de contato

Se o lead responder com um **cartão de contato** (ex.: "fale com o setor responsável" + cartão), o Leaderei:

1. Mostra na conversa "📇 Contato compartilhado: Nome — telefone".
2. Cadastra a pessoa como novo lead, marcado como indicado por quem enviou.
3. Prepara a primeira mensagem para o indicado, citando a indicação.
4. Agradece a quem indicou e pausa a cadência dele.

Com a aprovação humana ligada, as mensagens aparecem em **Aprovações** antes do envio. Cartões sem telefone ficam só registrados no histórico do lead.
