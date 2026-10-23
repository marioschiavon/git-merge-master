# Model migration

- [x] Verify deprecated executable selections against authenticated catalog and recent production logs.
- [x] Validate replacement models using synthetic requests and tool continuation, without sends or bookings.
- [x] Update deprecated Gateway selections, matching decision labels, fallback routes and replacement cost estimates.
- [x] Run regression tests and verify deployed functions plus authenticated readback.
- [x] Record beta notes and resolve the monitoring finding; do not publish.

# Master AI credit contingency

- [ ] Route cadence decisions, first messages and reply generation through the shared contingency dispatcher.
- [ ] Test exhausted-credit routing and terminal denials without real sends.
- [ ] Deploy affected functions and verify the configured OpenAI key with a synthetic request.
- [ ] Record beta notes; do not publish.