

## Fix: Decode Base64/MIME Email Body in Inbound Webhook

### Problem
The Cloudflare Worker forwards the raw email body which contains MIME multipart boundaries and base64-encoded content. The `inbound-email-webhook` stores this raw content as-is, making messages unreadable in the Conversations page.

Example of what's stored:
```
--000000000000c72967064f11f580
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: base64

T2xhLCB0dWRvIGJlbT8NCkdvc3RhcmlhIG11aXRvIGRlIGVudGVuZGVyIGNvbW8gaXNzbyBmdW5j...
```

### Fix

**File: `supabase/functions/inbound-email-webhook/index.ts`**

Add a helper function that:
1. Detects if the body contains MIME multipart boundaries
2. Extracts the `text/plain` part
3. Checks if `Content-Transfer-Encoding` is `base64` and decodes it
4. Falls back to the raw text if no MIME structure is detected

Apply this parsing to `textBody` before forwarding to `inbound-webhook` (line 69).

Also fix the existing corrupted message in the database — update the stored content for the affected inbound message to the decoded text.

### Steps
1. Add MIME/base64 parsing function to `inbound-email-webhook/index.ts`
2. Apply it to `textBody` before forwarding
3. Deploy `inbound-email-webhook`
4. Update the existing corrupted message in the database with decoded content

