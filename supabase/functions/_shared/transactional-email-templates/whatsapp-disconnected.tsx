import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Leaderei"

interface WhatsAppDisconnectedProps {
  connectionName?: string
  phoneNumber?: string
  appUrl?: string
  /** Motivo já em linguagem de cliente. */
  reason?: string
  /** Ex.: "há 2 dias". */
  downFor?: string
  /** Recusa do WhatsApp (403): mostra o bloco de boas práticas. */
  refused?: boolean
  /** Número do lembrete (0 = primeiro aviso). */
  reminder?: number
  bestPracticesUrl?: string
}

const WhatsAppDisconnectedEmail = (
  {
    connectionName,
    phoneNumber,
    appUrl,
    reason,
    downFor,
    refused,
    reminder,
    bestPracticesUrl,
  }: WhatsAppDisconnectedProps,
) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu WhatsApp continua fora do ar</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {reminder && reminder > 0 ? 'Seu WhatsApp continua fora do ar' : 'Seu WhatsApp caiu'}
        </Heading>
        <Text style={text}>
          A conexão <strong>{connectionName || 'WhatsApp'}</strong>
          {phoneNumber ? ` (${phoneNumber})` : ''} está fora do ar
          {downFor ? ` ${downFor}` : ''}
          {reason ? `: ${reason}` : '.'} Enquanto isso, as mensagens de WhatsApp
          não são enviadas nem recebidas.
        </Text>
        <Text style={text}>
          Para voltar a funcionar, abra o {SITE_NAME} em Configurações →
          Integrações → WhatsApp e leia o QR-Code novamente com o celular desse
          número.
        </Text>
        {refused
          ? (
            <Text style={text}>
              Quando o WhatsApp recusa um número, quase sempre a causa é o ritmo
              de envio ou denúncias de contatos.{' '}
              {bestPracticesUrl
                ? (
                  <Link href={bestPracticesUrl} style={link}>
                    Leia as boas práticas de envio
                  </Link>
                )
                : 'Consulte as boas práticas de envio no app'}{' '}
              antes de reconectar.
            </Text>
          )
          : null}
        {appUrl
          ? (
            <Text style={text}>
              <Link href={appUrl} style={link}>Abrir o {SITE_NAME}</Link>
            </Text>
          )
          : null}
        <Hr style={hr} />
        <Text style={footer}>Enviado automaticamente por {SITE_NAME}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WhatsAppDisconnectedEmail,
  // deno-lint-ignore no-explicit-any
  subject: (data: Record<string, any>) =>
    `${data.reminder ? 'WhatsApp ainda fora do ar' : 'WhatsApp fora do ar'}${
      data.connectionName ? ` — ${data.connectionName}` : ''
    }`,
  displayName: 'Aviso de WhatsApp desconectado',
  previewData: {
    connectionName: 'Comercial',
    phoneNumber: '5511999999999',
    appUrl: 'https://app.leaderei.com.br/settings/integrations?wa=1',
    bestPracticesUrl: 'https://app.leaderei.com.br/guides/whatsapp',
    reason: 'o aparelho encerrou a sessão',
    downFor: 'há 2 dias',
    refused: false,
    reminder: 0,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '20px 25px', maxWidth: '600px', margin: '0 auto' }
const h1 = { fontSize: '20px', color: 'hsl(220, 20%, 10%)', margin: '0 0 16px' }
const text = { fontSize: '15px', color: 'hsl(220, 20%, 10%)', lineHeight: '1.6', margin: '0 0 16px' }
const link = { color: 'hsl(221, 83%, 53%)' }
const hr = { borderColor: 'hsl(215, 20%, 91%)', margin: '24px 0' }
const footer = { fontSize: '12px', color: 'hsl(215, 15%, 47%)', margin: '0' }
