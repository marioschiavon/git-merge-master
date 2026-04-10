

## Fix: Inbound Email Reply Processing

### Problem
Two bugs prevent the email reply loop from working:

1. **`inbound-webhook/index.ts`** — The Supabase query joins `leads` and selects a `segment` column that doesn't exist in the `leads` table. This causes the query to fail silently, no conversation is found, and the function returns 404.

2. **`inbound-email-webhook/index.ts`** — When the forwarding to `inbound-webhook` fails, it returns HTTP 500 to Cloudflare. Cloudflare interprets any non-2xx as a permanent failure and marks the email as "blocked" (555 5.7.1). The webhook should always return 200 to Cloudflare to prevent email rejection.

### Changes

**File 1: `supabase/functions/inbound-webhook/index.ts`**
- Remove `segment` from the `leads(...)` select in both conversation lookup queries (2 occurrences)
- Change from: `leads(id, name, email, company_name, segment)` 
- Change to: `leads(id, name, email, company_name)`

**File 2: `supabase/functions/inbound-email-webhook/index.ts`**
- Change the error response when forwarding fails from `status: 500` to `status: 200` (return success to Cloudflare to prevent message blocking)
- Also change the missing sender/body validation error and the generic catch to return 200

**Deploy both functions** after changes.

### Expected Result
After deploying, resend the test email reply. The flow will be:
1. Cloudflare Worker forwards to `inbound-email-webhook` → returns 200 (no more blocking)
2. `inbound-email-webhook` finds the lead and forwards to `inbound-webhook`
3. `inbound-webhook` finds the conversation, processes with AI, sends auto-reply

