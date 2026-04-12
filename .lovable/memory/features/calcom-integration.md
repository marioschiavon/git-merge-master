---
name: Cal.com Integration
description: Smart scheduling with 2-slot reservation, 2h hold expiry, and auto-follow-up
type: feature
---
- Cal.com API integration via edge functions (calcom-slots, expire-slot-holds)
- Table: slot_holds (company_id, lead_id, slot_datetime, status, expires_at, cal_booking_uid)
- When AI action=schedule: fetch 2 slots on different days, offer to prospect, hold for 2h
- expire-slot-holds cron every 15min: cancel expired holds, send follow-up via most-used channel (excl. phone)
- Follow-up message includes Cal.com booking link
- Secrets: CALCOM_API_KEY, CALCOM_EVENT_TYPE_ID, CALCOM_BOOKING_LINK
- inbound-webhook updated to trigger slot booking on schedule action
