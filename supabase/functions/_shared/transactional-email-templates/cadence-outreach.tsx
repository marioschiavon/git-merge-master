import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Lead Automate"

interface CadenceOutreachProps {
  leadName?: string
  subject?: string
  messageBody?: string
}

const CadenceOutreachEmail = ({ leadName, subject, messageBody }: CadenceOutreachProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>{subject || `Mensagem de ${SITE_NAME}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={text}>
          {messageBody || 'Olá, gostaríamos de conversar com você.'}
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          Enviado por {SITE_NAME}
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CadenceOutreachEmail,
  subject: (data: Record<string, any>) => data.subject || `Mensagem de ${SITE_NAME}`,
  displayName: 'Cadence outreach email',
  previewData: { leadName: 'João', subject: 'Oportunidade de parceria', messageBody: 'Olá João, gostaria de apresentar nossa solução.' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '20px 25px', maxWidth: '600px', margin: '0 auto' }
const text = { fontSize: '15px', color: 'hsl(220, 20%, 10%)', lineHeight: '1.6', margin: '0 0 20px' }
const hr = { borderColor: 'hsl(215, 20%, 91%)', margin: '24px 0' }
const footer = { fontSize: '12px', color: 'hsl(215, 15%, 47%)', margin: '0' }
