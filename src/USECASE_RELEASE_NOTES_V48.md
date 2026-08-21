# Use-case Workbench V48

This release candidate adds an SRE use-case workbench alongside the existing capacity-planning experience.

1. Dynatrace Alert Dump: DQL-backed read-only event table for the selected time range.
2. RCA analysis with Davis: evidence-first incident analysis using operator-supplied problem context.
3. SLO / SLI simulations: planning calculator for availability target, error budget, latency target and traffic-growth scenarios.
4. Davis Capacity Copilot: interactive Assist chat grounded in visible forecast, simulation and scope context.

Future hardening: bind RCA to a stable tenant Problem dataset, bind SLO/SLI simulation to live SLO objects, add CSV export, and persist approved enterprise conversation context.
