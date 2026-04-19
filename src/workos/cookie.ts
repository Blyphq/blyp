const DEFAULT_WORKOS_COOKIE_NAME = 'wos-session';

export function extractWorkOsSessionCookie(
  headers: Headers | Record<string, unknown> | undefined | null,
  cookieName: string = DEFAULT_WORKOS_COOKIE_NAME
): string | null {
  if (!headers) {
    return null;
  }

  let cookieHeader: string | undefined;

  if (headers instanceof Headers) {
    cookieHeader = headers.get('cookie') ?? undefined;
  } else if (typeof headers === 'object') {
    const raw = (headers as Record<string, unknown>).cookie ??
      (headers as Record<string, unknown>).Cookie;
    cookieHeader = typeof raw === 'string' ? raw : undefined;
  }

  if (!cookieHeader) {
    return null;
  }

  const prefix = `${cookieName}=`;
  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }

  return null;
}
