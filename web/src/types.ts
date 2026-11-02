export type Home = {
  id: string
  name: string
  createdAt?: string
}

export type Member = {
  id: string
  homeId?: string
  name: string
  orderIndex?: number
  createdAt?: string
}

export type Share = {
  id: string
  billId?: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt?: string
  shares: Share[]
}

export type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}
