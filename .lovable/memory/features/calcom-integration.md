---
name: Cal.com Integration
description: Smart scheduling with 2-slot reservation, booking confirmation, rejection, availability check, and auto-follow-up
type: feature
---
- Cal.com API integration via edge functions (calcom-slots, calcom-confirm-booking, expire-slot-holds)
- Table: slot_holds (company_id, lead_id, slot_datetime, status, expires_at, cal_booking_uid)
- When AI action=schedule: fetch 2 slots on different days, offer to prospect, hold for 2h
- When AI action=confirm_slot: create definitive booking (POST /v2/bookings), cancel other slot reservation, update enrollment to completed
- When AI action=reject_slots: cancel all held reservations via DELETE /v2/slots/reservations/{uid}, mark cancelled in DB, fetch 2 new slots
- When AI action=check_availability: cancel existing holds, check if suggested datetime is available (5min tolerance), if yes reserve+confirm, if no offer 2 alternatives
- calcom-slots supports optional check_datetime param for single-slot availability verification
- expire-slot-holds cron every 15min: cancel expired holds, send follow-up via most-used channel (excl. phone)
- Follow-up message includes Cal.com booking link
- Secrets: CALCOM_API_KEY, CALCOM_EVENT_TYPE_ID (auto-detected), CALCOM_BOOKING_LINK
- inbound-webhook checks for held slots before AI analysis, adds slot context to prompt
- AI actions: reply, schedule, confirm_slot, reject_slots, check_availability, pause
