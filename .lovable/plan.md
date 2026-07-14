## Gerenciar chave Resend master pela UI (sem workspace)

Hoje a `RESEND_API_KEY` é gerenciada pelo connector do workspace — trocar exige abrir a página de conectores. Vamos migrar para uma chave da plataforma armazenada **criptografada no banco**, editável 100% pela UI do master admin, seguindo o mesmo padrão já usado para Cal.com (`pgp_sym_encrypt` + passphrase).

### 1. Banco

Migração adicionando à tabela `platform_settings`:
- `resend_api_key_encrypted bytea`
- `resend_connected_at timestamptz`
- `resend_last_error text`

Novos RPCs `SECURITY DEFINER` (search_path = public, extensions), autorizados apenas a `master_admin`:
- `set_resend_master_key(_api_key text, _passphrase text)` — criptografa e grava.
- `clear_resend_master_key()` — apaga.
- `get_resend_master_key(_passphrase text) returns text` — usado só por edge functions com service role.

Reaproveita a passphrase já existente (`CALCOM_KEY_PASSPHRASE`) OU cria uma nova `RESEND_KEY_PASSPHRASE`. Recomendo criar `RESEND_KEY_PASSPHRASE` própria via `generate_secret` para isolamento.

### 2. Shared: `_shared/resend-gateway.ts`

Muda a resolução da chave:
1. Tenta `Deno.env.get("RESEND_API_KEY")` (fallback do connector, transição).
2. Se ausente, chama `get_resend_master_key` no banco com a passphrase.
3. Faz cache em memória por processo (TTL curto, ~60s) para evitar hit no banco a cada e-mail.

Assim todos os edge functions existentes (`send-transactional-email`, `resend-inbound-webhook`, `resend-domain-*`, etc.) continuam funcionando sem alteração.

### 3. Novos edge functions

- `resend-master-set` — master_admin. Body `{ api_key }`. Valida chamando `GET /domains` no Resend com a chave crua antes de salvar; se OK, grava via `set_resend_master_key`. Retorna `{ok, domain_count}`.
- `resend-master-clear` — master_admin. Chama `clear_resend_master_key`.
- `resend-master-test` (já existe) — continua, agora usando a chave do banco via shared.

### 4. `platform-settings-status`

Passa a reportar:
```
resend: {
  key_configured: boolean,      // baseado em resend_api_key_encrypted IS NOT NULL
  key_source: 'db' | 'connector' | 'none',
  connected_at: string | null,
  lovable_api_key_configured: boolean
}
```

### 5. UI — `PlatformSettings.tsx` → `ResendCard`

Remove botão "Gerenciar conector" e link para workspace. Passa a ter:
- Status pills: chave configurada, origem (DB/connector), Lovable API Key, `connected_at`.
- Campo `Input type="password"` + botão **Salvar chave** → chama `resend-master-set`. Toast com contagem de domínios.
- Botão **Testar conexão** → `resend-master-test`.
- Botão **Remover chave** (destrutivo, com confirm) → `resend-master-clear`.
- Texto explicando: chave fica criptografada no banco, nunca é exibida de novo após salvar; para trocar, cole a nova e salve.

### 6. Versão

Bump `src/lib/version.ts` para `alpha 0.26`.

### Migração operacional (uma vez)

1. Cliente gera Full Access key na conta Resend master dele.
2. Master admin cola no novo campo da UI → salva.
3. Confirma no "Testar conexão".
4. Depois disso, o connector do workspace pode ser desconectado sem impacto (o fallback do env vira `none`, mas o shared usa a do banco).

### Fora do escopo

- Migrar domínios entre contas Resend (continua manual: cliente recadastra domínios na nova conta).
- Rotação automática. A troca é sempre manual pela UI.

### Arquivos afetados

- `supabase/migrations/<novo>.sql` (colunas + 3 RPCs + grants)
- `supabase/functions/_shared/resend-gateway.ts` (resolução da chave via DB + cache)
- `supabase/functions/resend-master-set/index.ts` (novo)
- `supabase/functions/resend-master-clear/index.ts` (novo)
- `supabase/functions/platform-settings-status/index.ts` (novos campos)
- `src/pages/master/PlatformSettings.tsx` (`ResendCard` reescrito)
- `src/lib/version.ts`

### Segredos

- `RESEND_KEY_PASSPHRASE` novo (gerado automaticamente, 64 chars).
- `RESEND_API_KEY` do connector pode continuar existindo durante a transição; após validar, cliente desconecta pelo workspace (única ação fora da UI — só uma vez, opcional).
