# Model migration

- [x] Verify deprecated executable selections against authenticated catalog and recent production logs.
- [x] Validate replacement models using synthetic requests and tool continuation, without sends or bookings.
- [x] Update deprecated Gateway selections, matching decision labels, fallback routes and replacement cost estimates.
- [x] Run regression tests and verify deployed functions plus authenticated readback.
- [x] Record beta notes and resolve the monitoring finding; do not publish.

# Master AI credit contingency

- [x] Route cadence decisions, first messages and reply generation through the shared contingency dispatcher.
- [x] Test exhausted-credit routing and terminal denials without real sends.
- [x] Deploy affected functions and verify the configured OpenAI key with a synthetic request.
- [x] Record beta notes; do not publish.