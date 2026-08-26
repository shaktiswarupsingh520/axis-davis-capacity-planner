# Dynatrace User Adoption

New AppEngine application based on the current production Axis release `release/axis-bank-interactive-ai-1.0.55`.

## V1 dashboard foundation

- 7 / 15 / 30 day selector
- Total, active and inactive users
- Adoption rate
- Management Zone adoption table
- Management Zone drill-down
- User activity detail
- Last login, active days and login count

## Production integration next

The UI is intentionally seeded with representative data for the first deployment/build validation. The next step is to replace the provider with the Axis tenant's real Dynatrace audit-login query and Management Zone/user enrichment.

Use the same deployment workstation and AppEngine tooling as the current Axis application:

```bash
npm ci
npx dt-app analyze
npx dt-app build
npx dt-app deploy --dry-run
npx dt-app deploy --environment-url https://axis-prod.apps.dynatrace.com/
```

Do not commit tokens or credentials.
