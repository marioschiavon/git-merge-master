import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  ListOrdered,
  Shuffle,
  Gauge,
  Flame,
  Clock,
  RotateCcw,
  Zap,
  CheckCircle2,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";

const practices = [
  {
    icon: ListOrdered,
    title: "Fila de envio",
    subtitle: "Uma mensagem por vez, na ordem certa",
    body:
      "Em vez de sair na hora, cada mensagem entra em uma fila. O sistema pega uma por vez e envia respeitando as regras de segurança.",
    example:
      "Se você colocar 10 leads na mesma cadência, as 10 mensagens não saem juntas. Elas vão saindo uma após a outra, com pausas entre elas.",
  },
  {
    icon: Shuffle,
    title: "Jitter (atrasos aleatórios)",
    subtitle: "Ritmo humano, não de robô",
    body:
      "Entre uma mensagem e outra, o sistema coloca um pequeno intervalo que varia (por exemplo, entre 45 e 90 segundos). Não é um ritmo de robô, é um ritmo humano.",
    example:
      "Ninguém manda mensagens exatamente a cada 60 segundos. O jitter faz parecer que é uma pessoa real digitando.",
  },
  {
    icon: Gauge,
    title: "Limite por hora e por dia",
    subtitle: "Volume seguro para o WhatsApp",
    body:
      "O Leaderei respeita um teto de mensagens por hora e por dia. Isso evita que a sua conta estoure o limite do WhatsApp e caia em bloqueio.",
    example:
      "Mesmo que a fila tenha 100 mensagens esperando, o sistema envia só a quantidade segura em cada janela de tempo. O restante fica na fila, esperando a vez.",
  },
  {
    icon: Flame,
    title: "Warm-up (aquecimento gradual)",
    subtitle: "Começa devagar e ganha ritmo",
    body:
      "Contas que acabaram de começar a enviar — ou que pararam e voltaram — precisam de um período de aquecimento. O Leaderei começa devagar e vai aumentando o volume conforme a conta ganha histórico.",
    example:
      "É como começar na academia: você não levanta 50kg no primeiro dia. Aumenta aos poucos para não se machucar.",
  },
  {
    icon: Clock,
    title: "Horário comercial",
    subtitle: "Cadências e primeiras mensagens na hora certa",
    body:
      "Mensagens automáticas de cadência e primeiras mensagens (outbound frio) respeitam a janela de envio configurada em Configurações → Empresa. Enviar de madrugada ou em dias não configurados é o caminho mais rápido para ter o número banido pelo WhatsApp. A responsabilidade de configurar uma janela realista é do administrador da conta.",
    example:
      "Se uma cadência tentar enviar às 23h e sua janela é 09h–18h, esse envio fica na fila e sai às 09h do próximo dia útil. Respostas a leads que já responderam fluem normalmente.",
  },

  {
    icon: RotateCcw,
    title: "Regra de reengajamento",
    subtitle: "Sem enxurrada de mensagens",
    body:
      "Se o lead não respondeu a uma mensagem automática, o sistema não manda outra em cima. Ele marca aquele envio como 'aguardando resposta' e deixa a cadência cuidar do reengajamento no intervalo que você configurou.",
    example:
      "Enviamos a primeira mensagem → o lead não responde → o sistema espera o tempo configurado (por exemplo, 2 dias) e só então tenta de novo.",
  },
  {
    icon: Zap,
    title: "Resposta imediata quando o lead fala",
    subtitle: "Conversa flui naturalmente",
    body:
      "A regra acima é só para envios automáticos quando o lead ainda não respondeu. Se o lead respondeu, a resposta do agente sai normalmente, sem ficar presa em cooldown.",
    example:
      "Se o lead mandar uma mensagem, o sistema entende que a conversa está aberta e responde de forma natural.",
  },
];

const tips = [
  "Evite colocar muitos leads de uma vez na mesma cadência. Quanto mais gradual, mais natural fica o envio.",
  "Configure intervalos de reengajamento realistas — dê tempo entre uma mensagem e outra para não parecer insistência.",
  "Revise as mensagens antes de aprovar. Textos muito genéricos ou com muitos links chamam atenção negativa do WhatsApp.",
  "Não aprove mensagens em massa muito rápido. Aprovações manuais também entram na fila.",
  "Acompanhe o status da fila nas telas de Aprovações e Cadências.",
];

const summary = [
  "As mensagens entram em uma fila e saem aos poucos, não todas de uma vez.",
  "Os envios têm pequenos atrasos aleatórios para parecerem naturais.",
  "Existe um limite seguro de mensagens por hora e por dia.",
  "Contas novas começam devagar e vão acelerando conforme ganham confiança.",
  "Mensagens automáticas de cadência e primeiras mensagens respeitam o horário comercial — enviar outbound frio fora dele pode banir o número.",
  "Se o lead não respondeu, a próxima mensagem automática espera o reengajamento configurado.",
  "Se o lead respondeu, a conversa continua normalmente e sem atraso.",
];

export default function WhatsAppBestPractices() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-3">
        <Badge variant="outline" className="gap-1">
          <ShieldCheck className="h-3 w-3" />
          Boas práticas
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
          <MessageSquare className="h-8 w-8 text-primary" />
          Como o Leaderei protege sua conta do WhatsApp
        </h1>
        <p className="text-muted-foreground text-lg">
          Um guia simples para entender por que suas mensagens não saem todas de uma vez — e como isso
          protege sua conta contra bloqueios e melhora a resposta dos leads.
        </p>
      </div>

      {/* Intro card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <p className="text-base leading-relaxed">
            <strong>Em uma frase:</strong> o Leaderei envia mensagens do WhatsApp como uma pessoa faria —
            aos poucos, em horários certos e respeitando limites — para evitar que sua conta seja bloqueada
            e para melhorar a resposta dos leads.
          </p>
        </CardContent>
      </Card>

      {/* Why not all at once */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Por que não posso mandar tudo de uma vez?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-muted-foreground leading-relaxed">
          <p>
            Imagine que você chega em uma festa e começa a cumprimentar todo mundo ao mesmo tempo, gritando.
            As pessoas estranham, se incomodam e alguém certamente vai te tirar dali.
          </p>
          <p>
            O WhatsApp funciona parecido. Se uma conta manda dezenas de mensagens em poucos minutos, o
            sistema pode interpretar como spam e bloquear o número. Quando isso acontece, você perde a
            conta, perde os leads e perde vendas.
          </p>
          <p className="text-foreground">
            Por isso, o Leaderei separa os envios ao longo do tempo, como se fossem mensagens feitas à mão.
          </p>
        </CardContent>
      </Card>

      {/* Practices grid */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">As 7 proteções que estão ativas</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {practices.map((p, i) => (
            <Card key={p.title} className="h-full">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <p.icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {i + 1}
                      </Badge>
                      <CardTitle className="text-base">{p.title}</CardTitle>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.subtitle}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="leading-relaxed">{p.body}</p>
                <div className="rounded-md border-l-2 border-primary/40 bg-muted/40 p-3 text-muted-foreground">
                  <p className="text-xs font-medium text-foreground mb-1">Na prática</p>
                  <p className="leading-relaxed">{p.example}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            O que você pode fazer para ajudar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {tips.map((t) => (
              <li key={t} className="flex items-start gap-3 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="text-xl">Resumo rápido</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {summary.map((s) => (
              <li key={s} className="flex items-start gap-3 text-sm">
                <span className="text-primary mt-1">•</span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Delay explainer */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-lg">E se uma mensagem atrasar?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Atrasos de alguns minutos ou horas são normais e fazem parte da estratégia de proteção. Na
            maioria dos casos, é melhor do que mandar tudo de uma vez e correr o risco de bloqueio.
          </p>
          <p className="text-muted-foreground">
            Se o atraso for de muitas horas ou dias, verifique se a conta do WhatsApp está conectada e se
            há algum alerta na fila em <strong className="text-foreground">Aprovações</strong> ou{" "}
            <strong className="text-foreground">Cadências</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
