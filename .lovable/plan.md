# Páginas públicas de Termos de Uso e Política de Privacidade

## Objetivo
Publicar o documento enviado (v1.0, vigente a partir de 01/10/2026) em páginas abertas, sem login, para cadastrar os links no Google Cloud (tela de consentimento OAuth).

## Endereços
- `app.leaderei.com.br/termos` — Parte 1 (Termos de Uso) + Parte 3 (Anexo de Tratamento de Dados)
- `app.leaderei.com.br/privacidade` — Parte 2 (Política de Privacidade)

## Como vão ficar
- Página limpa e profissional, com logo Leaderei, título, versão e data de vigência no topo.
- Índice lateral clicável com as seções (vira menu recolhível no celular).
- Tabelas do documento (papel da Leaderei, finalidades e bases legais, prazos de guarda, suboperadores) mantidas como tabelas.
- Rodapé com contato (nico@leaderei.com.br), DPO e link cruzado entre as duas páginas.
- Links "Termos de Uso" e "Política de Privacidade" na tela de login/cadastro e no rodapé do menu lateral do app.

## Ajustes necessários no texto (preciso da sua confirmação)
1. **Google (obrigatório para aprovação):** incluir na Política de Privacidade a seção "Uso de dados do Google", dizendo que dados do Gmail são usados só para enviar e ler as respostas das cadências, não são vendidos, não treinam IA e seguem a "Google API Services User Data Policy, incluindo os requisitos de Uso Limitado". Sem esse trecho o Google costuma recusar a verificação.
2. **Lista de suboperadores:** o documento cita "Resend e Nylas" e "UpEvolution". Como o e-mail passa a ser direto com o Google, sugiro trocar a linha de e-mail por "Google (Gmail API)" e confirmar se "UpEvolution" deve aparecer com esse nome (pela nossa regra, o motor de WhatsApp é sempre apresentado como Hook7).
3. Demais textos serão publicados exatamente como estão no documento.

## Detalhes técnicos
- Conteúdo em um arquivo de dados estruturado (seções, parágrafos, tabelas) renderizado por um componente `LegalPage` reutilizado nas duas rotas, com tokens do design system.
- Rotas públicas em `src/App.tsx`, fora do `AppLayout` (sem exigir login).
- `index.html`/título da página por rota para indexação; versão e data em constante única para facilitar futuras revisões.
- Bump para beta 0.80 e patch log do dia.
- Depois de publicar: cadastrar no Google Auth Platform → Branding os links de página inicial, privacidade e termos, e o domínio `leaderei.com.br` em domínios autorizados.
