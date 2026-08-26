import { queryExecutionClient } from '@dynatrace-sdk/client-query';

export type LoginEvent = {
  timestamp: string;
  userId: string;
  userName?: string;
  provider?: string;
};

export type UserActivity = {
  userId: string;
  userName: string;
  lastLogin: string;
  activeDays: number;
  logins: number;
  status: 'Active' | 'Inactive';
  zone: string;
};

const LOGIN_FIELDS = `
  | fields timestamp, user.id, user.email, user.name, event.provider
  | sort timestamp desc
  | limit 10000
`;

function loginQuery(days: number) {
  return `fetch dt.system.events, from:now()-${days}d\n| filter event.kind == "AUDIT_EVENT"\n| filter event.type == "LOGIN"\n${LOGIN_FIELDS}`;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export async function fetchLoginEvents(days: 7 | 15 | 30): Promise<LoginEvent[]> {
  const result = await queryExecutionClient.queryExecute({
    body: {
      query: loginQuery(days),
      requestTimeoutMilliseconds: 30000,
    },
  });

  const records = (result.result?.records ?? []) as Record<string, unknown>[];
  return records.map((record) => ({
    timestamp: asString(record.timestamp),
    userId: asString(record['user.id']) || 'unknown',
    userName: asString(record['user.email']) || asString(record['user.name']) || undefined,
    provider: asString(record['event.provider']) || undefined,
  }));
}

export function buildUserActivity(events: LoginEvent[]): UserActivity[] {
  const byUser = new Map<string, LoginEvent[]>();
  events.forEach((event) => {
    const current = byUser.get(event.userId) ?? [];
    current.push(event);
    byUser.set(event.userId, current);
  });

  return [...byUser.entries()]
    .map(([userId, userEvents]) => {
      const ordered = [...userEvents].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const activeDays = new Set(ordered.map((event) => event.timestamp.slice(0, 10))).size;
      return {
        userId,
        userName: ordered.find((event) => event.userName)?.userName ?? userId,
        lastLogin: ordered[0]?.timestamp ?? '',
        activeDays,
        logins: ordered.length,
        status: activeDays > 0 ? 'Active' : 'Inactive',
        zone: 'Unmapped',
      } satisfies UserActivity;
    })
    .sort((a, b) => b.logins - a.logins);
}

export function buildDailyActivity(events: LoginEvent[]) {
  const byDate = new Map<string, Set<string>>();
  events.forEach((event) => {
    const date = event.timestamp.slice(0, 10);
    const users = byDate.get(date) ?? new Set<string>();
    users.add(event.userId);
    byDate.set(date, users);
  });
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, users]) => ({ date, activeUsers: users.size }));
}
