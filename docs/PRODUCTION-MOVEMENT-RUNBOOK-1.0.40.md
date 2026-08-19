# Axis Davis Capacity Planner — Production Movement Runbook

**Release candidate:** 1.0.40  
**Release branch:** `release/axis-davis-capacity-planner-1.0.40`  
**Source branch:** `feature/real-dynatrace-integration`  
**Planned movement:** 20 Aug 2026  

## 1. Release freeze

- Freeze functional/UI/PDF enhancements after release candidate validation.
- Do not merge simulation, chart-hover, PDF or telemetry patches into the release branch during the movement window.
- Keep `feature/real-dynatrace-integration` available for post-production enhancements.
- Any post-go-live fix must be raised as a separate patch and redeployed only through the approved change process.

## 2. Pre-production evidence to retain

Before movement, retain the following evidence:

- `npm run typecheck` — PASS
- `npm run build` — PASS
- Successful AppEngine deployment of the release candidate
- Final production-candidate PDF
- Screenshot showing live host telemetry in Host Inventory
- Screenshot showing Capacity Forecast with Dynatrace Intelligence result
- Screenshot showing Capacity Simulation with CPU, memory and disk projections
- Screenshot showing the exact traffic-growth scenario used for validation

## 3. Production manifest checks

Verify `app.config.json` before deployment:

- Application name: `Axis Davis Capacity Planner`
- Application ID: `my.axis.davis.capacity.planner`
- Version: `1.0.40`
- Production environment URL is the approved Axis Dynatrace AppEngine environment
- Required scopes are present and approved by Axis security/platform governance

Current manifest scopes include metrics, buckets, entities, spans, Davis analyzers and Davis Copilot execution permissions.

## 4. Production deployment sequence

Run from the clean release checkout:

```bash
git checkout release/axis-davis-capacity-planner-1.0.40
git pull --ff-only origin release/axis-davis-capacity-planner-1.0.40

npm run typecheck
npm run build
npm run dt:deploy
```

Record:

- deployment timestamp
- AppEngine deployment result
- installed application version
- deployment operator/change reference

## 5. Post-deployment smoke test

### A. Application access

- Open the Axis production Dynatrace AppEngine application.
- Confirm the application loads without a blank page or runtime exception.
- Confirm the selected production Management Zone is available.

### B. Live telemetry

Confirm non-zero values for:

- Host count
- CPU
- Memory
- Disk
- Network RX/TX
- Host-associated throughput
- Application/request-root throughput where available

### C. Host Inventory

- Select a production host.
- Verify CPU, memory, disk, throughput and network charts.
- Hover across each chart and confirm the tooltip follows the nearest data point.

### D. Capacity Forecast

- Run the approved forecast horizon.
- Confirm Dynatrace Intelligence returns a forecast.
- Confirm forecast status/quality is visible.
- Confirm the forecast chart renders historical and forecast portions.

### E. Capacity Simulation

For the production smoke test, use a **neutral baseline scenario** first:

- Traffic growth: `0%`
- Additional hosts: `0`

Verify the simulator reproduces current CPU, memory and disk reasonably.

Then perform one controlled what-if scenario using the approved test percentage and retain the screenshot as evidence.

### F. AI assessment

- Generate the AI/Dynatrace Assist assessment.
- Confirm executive summary, key findings, capacity risks and recommended actions are populated.
- Confirm the AI assessment references the selected production scope.

### G. PDF

Generate one production smoke-test PDF and verify:

- Executive summary contains live values.
- AI assessment is populated.
- Forecast section contains the actual forecast result when available.
- Host inventory contains current host values.
- Traffic trajectory reflects the exact selected simulation percentage.
- CPU/memory/disk resource outlook is populated.
- No blank pages.
- Page numbering is correct.
- No test/demo Management Zone or simulated percentage is carried into the production report.

## 6. Production acceptance criteria

The release is accepted only when:

- The app loads successfully in the Axis production environment.
- Live Dynatrace data is non-zero and consistent with the production scope.
- Host Inventory is functional.
- Capacity Forecast is functional.
- Capacity Simulation is functional.
- AI assessment is functional or its unavailability is explicitly explained by the application.
- PDF generation completes successfully and contains the expected sections without blank pages.
- No severity-1 or severity-2 runtime issue is observed during smoke testing.

## 7. Rollback plan

If a release-blocking issue is found:

1. Stop further production rollout/use.
2. Preserve browser console/application evidence and the generated PDF.
3. Record the failed release version and timestamp.
4. Restore the previously approved production app version using the Axis/Dynatrace approved rollback procedure.
5. Keep 1.0.40 unchanged as the failed release candidate; do not hot-edit the production branch.
6. Fix the issue on a separate development/patch branch, validate, then raise a new deployment candidate.

## 8. Post-go-live change policy

The production baseline is considered frozen after acceptance. Future enhancements should be developed independently, validated against the production baseline and released as a new version.

Examples intentionally deferred until after go-live:

- Additional dashboard/graph enhancements
- Further PDF formatting refinements
- Additional business/problem-correlation sections
- New forecasting dimensions
- Additional integrations

## 9. Final sign-off record

**Business owner:** ____________________  
**Axis platform owner:** ____________________  
**SRE/Dynatrace owner:** ____________________  
**Change reference:** ____________________  
**Production deployment time:** ____________________  
**Validation completed by:** ____________________  
**Go / No-Go:** ____________________
