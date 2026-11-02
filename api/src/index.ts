import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for all API endpoints
app.use('/api/*', cors())

// Global error handlers
app.onError((err, c) => {
  console.error('Unhandled API error:', err)
  return c.json({ error: err.message || 'Internal server error' }, 500)
})

app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// GET /api/homes - List all homes
app.get('/api/homes', async (c) => {
  const homes = await c.env.DB.prepare(
    'SELECT id, name, created_at AS createdAt FROM homes ORDER BY created_at DESC, rowid DESC',
  ).all<{ id: string; name: string; createdAt: string }>()

  return c.json({ homes: homes.results })
})

// POST /api/homes - Create a home
app.post('/api/homes', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return c.json({ error: 'name is required and must be a non-empty string' }, 400)
  }

  const name = (body as { name: string }).name.trim()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, now)
    .run()

  return c.json({ id, name }, 201)
})

// GET /api/homes/:homeId - Get a single home with its members
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare(
    'SELECT id, name, created_at AS createdAt FROM homes WHERE id = ?',
  )
    .bind(homeId)
    .first<{ id: string; name: string; createdAt: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, name, order_index AS orderIndex, created_at AS createdAt FROM members WHERE home_id = ? ORDER BY order_index ASC, rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string; orderIndex: number; createdAt: string }>()

  return c.json({ ...home, members: members.results })
})

// POST /api/homes/:homeId/members - Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return c.json({ error: 'name is required and must be a non-empty string' }, 400)
  }

  const name = (body as { name: string }).name.trim()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(order_index), 0) AS max_order FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ max_order: number }>()

  const orderIndex = (maxOrder?.max_order ?? 0) + 1

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name, order_index, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, homeId, name, orderIndex, now)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// GET /api/homes/:homeId/bills - List bills and their shares
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, title, total_cents AS totalCents, created_at AS createdAt FROM bills WHERE home_id = ? ORDER BY created_at DESC, rowid DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number; createdAt: string }>()

  const billIds = bills.results.map((b) => b.id)
  if (billIds.length === 0) {
    return c.json({ bills: [] })
  }

  const placeholders = billIds.map(() => '?').join(',')
  const shares = await c.env.DB.prepare(
    `SELECT s.id, s.bill_id AS billId, s.member_id AS memberId, m.name AS memberName, s.amount_cents AS amountCents, s.paid_at AS paidAt, s.order_index AS orderIndex
     FROM shares s
     JOIN members m ON s.member_id = m.id
     WHERE s.bill_id IN (${placeholders})
     ORDER BY s.order_index ASC, s.rowid ASC`,
  )
    .bind(...billIds)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
      orderIndex: number
    }>()

  const sharesByBillId = new Map<string, typeof shares.results>()
  for (const share of shares.results) {
    const list = sharesByBillId.get(share.billId) ?? []
    list.push(share)
    sharesByBillId.set(share.billId, list)
  }

  const result = bills.results.map((bill) => ({
    ...bill,
    shares: sharesByBillId.get(bill.id) ?? [],
  }))

  return c.json({ bills: result })
})

// POST /api/homes/:homeId/bills - Create a bill and split between members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Body must be an object' }, 422)
  }

  const totalCents = (body as { totalCents?: unknown }).totalCents
  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole number' }, 422)
  }

  const titleRaw = (body as { title?: unknown }).title
  if (typeof titleRaw !== 'string' || titleRaw.trim().length === 0) {
    return c.json({ error: 'title must be a non-empty string' }, 422)
  }
  const title = titleRaw.trim()

  const members = await c.env.DB.prepare(
    'SELECT id, name, order_index AS orderIndex FROM members WHERE home_id = ? ORDER BY order_index ASC, rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string; orderIndex: number }>()

  if (members.results.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const numMembers = members.results.length
  const baseAmount = Math.floor(totalCents / numMembers)
  const remainder = totalCents % numMembers

  const billId = crypto.randomUUID()
  const now = new Date().toISOString()

  const sharesToInsert = members.results.map((member, index) => {
    const amountCents = baseAmount + (index < remainder ? 1 : 0)
    return {
      id: crypto.randomUUID(),
      billId,
      memberId: member.id,
      amountCents,
      paidAt: null,
      orderIndex: index,
    }
  })

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, now),
    ...sharesToInsert.map((s) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key, order_index, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)',
      ).bind(s.id, s.billId, s.memberId, s.amountCents, s.orderIndex, now),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares: sharesToInsert.map((s) => ({
        id: s.id,
        memberId: s.memberId,
        amountCents: s.amountCents,
        paidAt: null,
      })),
    },
    201,
  )
})

// POST /api/bills/:billId/shares/:shareId/pay - Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const idempotencyKeyRaw = c.req.header('Idempotency-Key')
  if (!idempotencyKeyRaw || idempotencyKeyRaw.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }
  const idempotencyKey = idempotencyKeyRaw.trim()

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id AS billId, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt, idempotency_key AS idempotencyKey FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      billId: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paidAt !== null) {
    if (share.idempotencyKey === idempotencyKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.memberId,
          amountCents: share.amountCents,
          paidAt: share.paidAt,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  const now = new Date().toISOString()
  const updateResult = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(now, idempotencyKey, shareId, billId)
    .run()

  if (updateResult.meta.changes === 1) {
    return c.json(
      {
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: now,
      },
      200,
    )
  }

  // Handle concurrent execution race: re-fetch share state
  const refreshed = await c.env.DB.prepare(
    'SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt, idempotency_key AS idempotencyKey FROM shares WHERE id = ?',
  )
    .bind(shareId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (refreshed?.paidAt && refreshed.idempotencyKey === idempotencyKey) {
    return c.json(
      {
        id: refreshed.id,
        memberId: refreshed.memberId,
        amountCents: refreshed.amountCents,
        paidAt: refreshed.paidAt,
      },
      200,
    )
  }

  return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
})

// GET /api/homes/:homeId/balances - Calculate member balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const rows = await c.env.DB.prepare(
    `SELECT 
       m.id AS memberId,
       m.name AS name,
       COALESCE(
         (
           SELECT SUM(s.amount_cents)
           FROM shares s
           JOIN bills b ON s.bill_id = b.id
           WHERE s.member_id = m.id 
             AND b.home_id = m.home_id 
             AND s.paid_at IS NULL
         ), 
         0
       ) AS outstandingCents
     FROM members m
     WHERE m.home_id = ?
     ORDER BY m.order_index ASC, m.rowid ASC`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: rows.results }, 200)
})

// DELETE /api/homes/:homeId - Delete home and all its data
app.delete('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare('SELECT id FROM bills WHERE home_id = ?')
    .bind(homeId)
    .all<{ id: string }>()

  const billIds = bills.results.map((b) => b.id)
  const statements = []

  if (billIds.length > 0) {
    const placeholders = billIds.map(() => '?').join(',')
    statements.push(
      c.env.DB.prepare(`DELETE FROM shares WHERE bill_id IN (${placeholders})`).bind(...billIds),
    )
    statements.push(c.env.DB.prepare('DELETE FROM bills WHERE home_id = ?').bind(homeId))
  }
  statements.push(c.env.DB.prepare('DELETE FROM members WHERE home_id = ?').bind(homeId))
  statements.push(c.env.DB.prepare('DELETE FROM homes WHERE id = ?').bind(homeId))

  await c.env.DB.batch(statements)

  return c.json({ success: true, message: 'Home deleted successfully' }, 200)
})

// POST /api/homes/:homeId/reset - Reset/clear all bills and shares for a home
app.post('/api/homes/:homeId/reset', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare('SELECT id FROM bills WHERE home_id = ?')
    .bind(homeId)
    .all<{ id: string }>()

  const billIds = bills.results.map((b) => b.id)
  const statements = []

  if (billIds.length > 0) {
    const placeholders = billIds.map(() => '?').join(',')
    statements.push(
      c.env.DB.prepare(`DELETE FROM shares WHERE bill_id IN (${placeholders})`).bind(...billIds),
    )
    statements.push(c.env.DB.prepare('DELETE FROM bills WHERE home_id = ?').bind(homeId))
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements)
  }

  return c.json({ success: true, message: 'Home reset successfully' }, 200)
})

// DELETE /api/bills/:billId - Delete a single bill and its shares
app.delete('/api/bills/:billId', async (c) => {
  const billId = c.req.param('billId')

  const bill = await c.env.DB.prepare('SELECT id, home_id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string; home_id: string }>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM shares WHERE bill_id = ?').bind(billId),
    c.env.DB.prepare('DELETE FROM bills WHERE id = ?').bind(billId),
  ])

  return c.json({ success: true, message: 'Bill deleted successfully' }, 200)
})

// PATCH /api/homes/:homeId - Edit/rename a home
app.patch('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return c.json({ error: 'name is required and must be a non-empty string' }, 400)
  }

  const name = (body as { name: string }).name.trim()

  await c.env.DB.prepare('UPDATE homes SET name = ? WHERE id = ?').bind(name, homeId).run()

  return c.json({ id: homeId, name }, 200)
})

// DELETE /api/homes/:homeId/members/:memberId - Remove a member added by mistake
app.delete('/api/homes/:homeId/members/:memberId', async (c) => {
  const homeId = c.req.param('homeId')
  const memberId = c.req.param('memberId')

  const member = await c.env.DB.prepare('SELECT id, name FROM members WHERE id = ? AND home_id = ?')
    .bind(memberId, homeId)
    .first<{ id: string; name: string }>()

  if (!member) {
    return c.json({ error: 'Member not found' }, 404)
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM shares WHERE member_id = ?').bind(memberId),
    c.env.DB.prepare('DELETE FROM members WHERE id = ? AND home_id = ?').bind(memberId, homeId),
  ])

  return c.json({ success: true, message: `Member ${member.name} removed successfully` }, 200)
})

// PATCH /api/bills/:billId - Edit a bill title
app.patch('/api/bills/:billId', async (c) => {
  const billId = c.req.param('billId')

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { title?: unknown }).title !== 'string' ||
    (body as { title: string }).title.trim().length === 0
  ) {
    return c.json({ error: 'title is required and must be a non-empty string' }, 400)
  }

  const title = (body as { title: string }).title.trim()

  await c.env.DB.prepare('UPDATE bills SET title = ? WHERE id = ?').bind(title, billId).run()

  return c.json({ id: billId, title }, 200)
})

export default app
