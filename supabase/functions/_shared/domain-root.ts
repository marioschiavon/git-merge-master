// Calcula o eTLD+1 (raiz registrável) de um domínio.
// Lista mínima de sufixos multi-label mais comuns; para outros casos
// usa os 2 últimos labels.
const MULTI_LABEL_SUFFIXES = new Set([
  "com.br", "net.br", "org.br", "gov.br", "edu.br", "art.br", "blog.br",
  "com.mx", "com.ar", "com.co", "com.pe", "com.uy", "com.ve", "com.cl",
  "co.uk", "org.uk", "gov.uk", "ac.uk",
  "com.au", "net.au", "org.au", "gov.au", "edu.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp",
  "co.kr", "or.kr",
  "co.nz", "net.nz", "org.nz",
  "co.za",
  "com.sg", "com.hk", "com.tw",
  "com.tr",
]);

export function registrableRoot(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

// Nome DNS para o registro DMARC, considerando eTLD+1.
// Para hook7.com.br → "_dmarc.hook7.com.br"
// Para app.empresa.com → "_dmarc.empresa.com"
export function dmarcName(domain: string): string {
  return `_dmarc.${registrableRoot(domain)}`;
}

// Detecta se um nome de registro DMARC ficou apontando para um public suffix
// (bug antigo). Ex.: "_dmarc.com.br" precisa ser corrigido.
export function isBrokenDmarcName(name: string): boolean {
  const n = (name || "").toLowerCase();
  if (!n.startsWith("_dmarc.")) return false;
  const tail = n.slice("_dmarc.".length);
  return MULTI_LABEL_SUFFIXES.has(tail) || tail.split(".").length < 2;
}
