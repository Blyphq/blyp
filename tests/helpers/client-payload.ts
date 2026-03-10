import type { ClientLogEvent } from '../../src/shared/client-log';

export function createClientPayload(
  overrides: Partial<ClientLogEvent> = {}
): ClientLogEvent {
  return {
    type: 'client_log',
    source: 'client',
    id: 'evt_123',
    level: 'info',
    message: 'frontend rendered',
    data: { route: '/dashboard' },
    clientTimestamp: new Date().toISOString(),
    page: {
      url: 'https://dashboard.example.test/app',
      pathname: '/app',
      search: '',
      hash: '',
      title: 'Dashboard',
      referrer: 'https://dashboard.example.test/login',
    },
    browser: {
      userAgent: 'Mozilla/5.0',
      language: 'en-US',
      platform: 'MacIntel',
    },
    session: {
      pageId: 'page_123',
      sessionId: 'session_123',
    },
    ...overrides,
  };
}
