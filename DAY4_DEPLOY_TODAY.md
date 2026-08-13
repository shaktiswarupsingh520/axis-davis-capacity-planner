# Axis Davis Capacity Planner — Day 4

## Current state

This archive is an AppEngine-oriented release of the existing React/TypeScript simulator. It preserves the UI and adds a working Management Zone selector over deterministic mock data.

### Management Zone behavior

The selector is available in the top header. Selecting a zone filters the complete reporting estate:

- Executive Overview
- Host Inventory
- Capacity Forecast
- Simulation
- Business Insights

The current selector is intentionally simulation-backed. It does **not** claim to be a live Dynatrace Management Zone query yet.

## Important production distinction

The downloaded project was a normal Vite/React project, not yet a complete Dynatrace App Toolkit project. This release adds `app.config.json` and App Toolkit commands, but the real Grail/DQL provider still needs to be wired before calling the app a real-data production release.

## Fastest deployment path

Dynatrace App Toolkit currently requires Node.js 24 and access to the Dynatrace environment. The toolkit supports `npx dt-app build`, `npx dt-app deploy`, and `npx dt-app deploy --dry-run`.

Run from a machine/CI runner that has Node.js 24 and access to npm/Dynatrace:

```bash
npm ci
npx dt-app analyze
npx dt-app build
npx dt-app deploy --dry-run
```

The dry run creates a distributable ZIP in `out/` that can be uploaded to the Dynatrace environment.

For direct deployment:

```bash
npx dt-app deploy --environment-url https://axis-prod.apps.dynatrace.com/
```

The deploying identity needs AppEngine installation/run permissions. For CI/CD, use a secure platform token or OAuth client; never commit credentials into this repository.

## Next real-data integration

Replace the mock provider with:

1. Management Zone list/read from Dynatrace settings or accessible host entity data.
2. Grail/DQL host telemetry using `@dynatrace-sdk/react-hooks` / `useDql`.
3. Filter host telemetry by the selected Management Zone.
4. Keep the existing forecasting and simulation services.
5. Add `davis:analyzers:execute` only when the Davis analyzer integration is actually implemented.

Recommended Grail host metrics:

- CPU: `dt.host.cpu.usage`
- Memory: `dt.host.memory.usage`
- Disk: `dt.host.disk.used.percent`
- Network RX: `dt.host.net.nic.bytes_rx`
- Network TX: `dt.host.net.nic.bytes_tx`

Do not enable Dynatrace Mode or request extra scopes until the corresponding provider is implemented.
