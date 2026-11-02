import type { Balance, Bill, Home, Member, Share } from './types'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || ''

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(408, 'Request timed out after waiting for the server.')
    }
    const message = err instanceof Error ? err.message : 'Network request failed'
    throw new ApiError(0, `Network error: ${message}`)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`

  const response = await fetchWithTimeout(fullUrl, {
    ...options,
    headers,
  })

  let data: unknown = null
  const text = await response.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    let errorMessage = `Server error (${response.status})`
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      errorMessage = data.error
    }
    throw new ApiError(response.status, errorMessage)
  }

  return data as T
}

export const api = {
  // Homes
  getHomes: async (): Promise<Home[]> => {
    const res = await request<{ homes: Home[] }>('/api/homes')
    return res.homes || []
  },

  getHome: async (homeId: string): Promise<Home & { members: Member[] }> => {
    return request<Home & { members: Member[] }>(`/api/homes/${encodeURIComponent(homeId)}`)
  },

  createHome: async (name: string): Promise<Home> => {
    return request<Home>('/api/homes', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },

  deleteHome: async (homeId: string): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(
      `/api/homes/${encodeURIComponent(homeId)}`,
      {
        method: 'DELETE',
      },
    )
  },

  editHome: async (homeId: string, name: string): Promise<Home> => {
    return request<Home>(`/api/homes/${encodeURIComponent(homeId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  },

  resetHome: async (homeId: string): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(
      `/api/homes/${encodeURIComponent(homeId)}/reset`,
      {
        method: 'POST',
      },
    )
  },

  // Members
  addMember: async (homeId: string, name: string): Promise<Member> => {
    return request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },

  removeMember: async (
    homeId: string,
    memberId: string,
  ): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(
      `/api/homes/${encodeURIComponent(homeId)}/members/${encodeURIComponent(memberId)}`,
      {
        method: 'DELETE',
      },
    )
  },

  // Balances
  getBalances: async (homeId: string): Promise<Balance[]> => {
    const res = await request<{ balances: Balance[] }>(
      `/api/homes/${encodeURIComponent(homeId)}/balances`,
    )
    return res.balances || []
  },

  // Bills
  getBills: async (homeId: string): Promise<Bill[]> => {
    const res = await request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(homeId)}/bills`)
    return res.bills || []
  },

  createBill: async (homeId: string, title: string, totalCents: number): Promise<Bill> => {
    return request<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
      method: 'POST',
      body: JSON.stringify({ title, totalCents }),
    })
  },

  deleteBill: async (billId: string): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(
      `/api/bills/${encodeURIComponent(billId)}`,
      {
        method: 'DELETE',
      },
    )
  },

  editBill: async (billId: string, title: string): Promise<{ id: string; title: string }> => {
    return request<{ id: string; title: string }>(`/api/bills/${encodeURIComponent(billId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  },

  // Pay share
  payShare: async (billId: string, shareId: string, idempotencyKey: string): Promise<Share> => {
    return request<Share>(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    )
  },
}
