# Axis Davis Capacity Planner 1.0.45

Fixes:
- Host Inventory hover now follows the selected CPU, Memory, Disk, Throughput, or Network metric instead of retaining stale Throughput metadata.
- Capacity Forecast presents CPU, Memory, and Disk on one combined trend chart.
- Capacity Forecast includes timestamp/value hover across historical and Dynatrace Intelligence forecast points.
- Individual host selection remains available for host-specific CPU, Memory, and Disk forecasts.

Validation required locally with `npm run typecheck` and `npm run build` before deployment.
