# SRE Use-Case Roadmap

## 1. Dynatrace Alert Dump
Live operational-event extraction for the selected time range and scope. The current V48 implementation provides a tabular DQL-backed view and is intentionally read-only.

## 2. RCA Analysis with Davis
Evidence-first incident analysis. Operators can paste a problem summary, symptoms, timestamps, service names, log/error excerpts, and investigation notes. Davis returns probable cause, contributing factors, evidence gaps, validation steps, and recommended actions without fabricating evidence.

## 3. SLO / SLI Simulations & Forecasting
What-if reliability planning for availability targets, latency targets, error budget, and traffic growth. The current V48 UI is a planning simulator; future iterations should bind directly to live SLO/SLI objects and service-level latency/error data.

## 4. Davis Capacity Copilot
Interactive question-answering over the current UI context, including selected scope, current telemetry, forecast and simulation information. Keep the context compact and below the Dynatrace Assist payload limit.

## Production hardening next
- Add CSV export to Alert Dump.
- Bind RCA analysis to live Dynatrace Problem entities when the tenant exposes a stable problem dataset/query.
- Bind SLO/SLI simulation to real SLO/SLI definitions and error-budget burn.
- Add explicit source/version metadata to all AI responses.
- Persist conversation/session context only with approved enterprise storage.
