/**
 * TrustVault API Client
 *
 * Communicates with FastAPI backend using HTTP-only cookies and session-bound CSRF tokens.
 */

export type UserRole = 'ADMIN' | 'DOCUMENT_OWNER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  owner_id: string;
  owner_email?: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ShareItem {
  id: string;
  document_id: string;
  recipient_id: string;
  recipient_email: string;
  granted_by_id: string;
  created_at: string;
  revoked_at: string | null;
  is_active: boolean;
  email_notification_sent?: boolean;
  email_notification_note?: string;
}

export interface RecipientUser {
  id: string;
  email: string;
  role: string;
}

export interface AuditLogItem {
  id: string;
  actor_id: string;
  action: string;
  document_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
  document_count: number;
}

export interface AdminStats {
  total_users: number;
  total_documents: number;
  total_shares: number;
  active_shares: number;
  total_audit_events: number;
  storage_used_bytes: number;
  role_breakdown: Record<string, number>;
}

export interface ApiError {
  detail: string;
}

// In-memory CSRF token
let activeCsrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  activeCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return activeCsrfToken;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && activeCsrfToken) {
    headers['X-CSRF-Token'] = activeCsrfToken;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include', // Ensure tv_session cookie is sent and received
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) {
        errorDetail = Array.isArray(errorJson.detail)
          ? errorJson.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(', ')
          : String(errorJson.detail);
      }
    } catch {
      // Body not JSON
    }
    throw new Error(errorDetail);
  }

  // Handle empty responses
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return {} as T;
}

export const api = {
  auth: {
    async register(email: string, password: string, role?: string): Promise<{ user: User; csrf_token?: string }> {
      const data = await request<{ user: User; csrf_token?: string }>('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role }),
      });
      return data;
    },

    async login(email: string, password: string): Promise<{ user: User; csrf_token: string }> {
      const data = await request<{ user: User; csrf_token: string; message: string }>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (data.csrf_token) {
        setCsrfToken(data.csrf_token);
      }
      return data;
    },

    async logout(): Promise<void> {
      try {
        await request('/auth/logout', { method: 'POST' });
      } finally {
        setCsrfToken(null);
      }
    },

    async getMe(): Promise<{ user: User; csrf_token: string }> {
      const data = await request<{ user: User; csrf_token: string }>('/auth/me');
      if (data.csrf_token) {
        setCsrfToken(data.csrf_token);
      }
      return data;
    },
  },

  documents: {
    async list(): Promise<DocumentItem[]> {
      return request<DocumentItem[]>('/documents');
    },

    async get(id: string): Promise<DocumentItem> {
      return request<DocumentItem>(`/documents/${id}`);
    },

    async upload(file: File): Promise<DocumentItem> {
      const formData = new FormData();
      formData.append('file', file);

      // Note: do NOT set Content-Type header manually for FormData, browser sets it with boundary
      const headers: Record<string, string> = {};
      if (activeCsrfToken) {
        headers['X-CSRF-Token'] = activeCsrfToken;
      }

      const response = await fetch('/documents', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        let detail = `Upload failed (${response.status})`;
        try {
          const err = await response.json();
          if (err.detail) detail = String(err.detail);
        } catch {}
        throw new Error(detail);
      }
      return response.json();
    },

    async download(documentId: string, filename: string): Promise<void> {
      const response = await fetch(`/documents/${documentId}/download`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        let detail = 'Download failed';
        try {
          const err = await response.json();
          if (err.detail) detail = String(err.detail);
        } catch {}
        throw new Error(detail);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    },

    async listShares(documentId: string): Promise<ShareItem[]> {
      return request<ShareItem[]>(`/documents/${documentId}/shares`);
    },

    async listRecipients(): Promise<RecipientUser[]> {
      return request<RecipientUser[]>('/documents/recipients');
    },

    async createShare(documentId: string, recipientEmail: string): Promise<ShareItem> {
      return request<ShareItem>(`/documents/${documentId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_email: recipientEmail }),
      });
    },

    async revokeShare(documentId: string, shareId: string): Promise<{ message: string; share_id: string }> {
      return request<{ message: string; share_id: string }>(`/documents/${documentId}/shares/${shareId}`, {
        method: 'DELETE',
      });
    },

    async delete(documentId: string): Promise<{ message: string; document_id: string }> {
      return request<{ message: string; document_id: string }>(`/documents/${documentId}`, {
        method: 'DELETE',
      });
    },
  },

  audit: {
    async list(limit = 100): Promise<AuditLogItem[]> {
      return request<AuditLogItem[]>(`/audit-logs?limit=${limit}`);
    },
  },

  admin: {
    async listUsers(): Promise<AdminUser[]> {
      return request<AdminUser[]>('/admin/users');
    },

    async updateRole(userId: string, role: UserRole): Promise<AdminUser> {
      return request<AdminUser>(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
    },

    async getStats(): Promise<AdminStats> {
      return request<AdminStats>('/admin/stats');
    },
  },

  health: {
    async check(): Promise<{ status: string; database_configured: boolean; storage_configured: boolean }> {
      return request('/health');
    },
  },
};
