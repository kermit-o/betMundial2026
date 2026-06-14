export interface Operator {
  id: string;
  name: string;
  slug: string;
  status: string;
  branding: string | null;
  created_at: string;
}

const PLATFORM_TOKEN_KEY = 'platform_token';
export const getPlatformToken = () => localStorage.getItem(PLATFORM_TOKEN_KEY);
export const setPlatformToken = (t: string) => localStorage.setItem(PLATFORM_TOKEN_KEY, t);
export const clearPlatformToken = () => localStorage.removeItem(PLATFORM_TOKEN_KEY);

export class PlatformApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function papi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
  const token = getPlatformToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/platform${path}`, { ...options, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? { code: 'unknown', message: 'Error de red' };
    throw new PlatformApiError(err.code, err.message);
  }
  return body as T;
}

export const PlatformApi = {
  login: (email: string, password: string) =>
    papi<{ token: string; admin: { id: string; email: string } }>('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  listOperators: () => papi<{ operators: Operator[] }>('/operators'),
  createOperator: (name: string, slug: string) =>
    papi<{ operator: Operator }>('/operators', { method: 'POST', body: JSON.stringify({ name, slug }) }),
  setStatus: (id: string, status: 'active' | 'suspended') =>
    papi<{ operator: Operator }>(`/operators/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
