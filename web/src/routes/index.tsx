import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useState } from 'react'
import { ApiError, api } from '../api'
import type { Balance, Bill, Home, Member } from '../types'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

function formatMoney(cents: number): string {
  const dollars = (cents / 100).toFixed(2)
  return `$${dollars}`
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [homeDetails, setHomeDetails] = useState<(Home & { members: Member[] }) | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  // Tab filter: 'active' (pending bills) | 'settled' (history of fully paid bills) | 'all'
  const [billFilter, setBillFilter] = useState<'active' | 'settled' | 'all'>('active')

  // Loading states
  const [isLoadingHomes, setIsLoadingHomes] = useState(true)
  const [isLoadingHomeData, setIsLoadingHomeData] = useState(false)

  // Error states
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successToast, setSuccessToast] = useState<string | null>(null)

  // Per-share payment in-flight and error tracking
  const [payingShareIds, setPayingShareIds] = useState<Record<string, boolean>>({})
  const [shareErrors, setShareErrors] = useState<Record<string, string>>({})

  // Modals
  const [isCreateHomeOpen, setIsCreateHomeOpen] = useState(false)
  const [isEditHomeOpen, setIsEditHomeOpen] = useState(false)
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false)
  const [isCreateBillOpen, setIsCreateBillOpen] = useState(false)
  const [editingBillId, setEditingBillId] = useState<string | null>(null)

  // Form states
  const [newHomeName, setNewHomeName] = useState('')
  const [editHomeName, setEditHomeName] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [newBillTitle, setNewBillTitle] = useState('')
  const [editBillTitle, setEditBillTitle] = useState('')
  const [newBillAmount, setNewBillAmount] = useState('')
  const [isSubmittingForm, setIsSubmittingForm] = useState(false)

  const homeSelectId = useId()
  const homeNameInputId = useId()
  const editHomeNameInputId = useId()
  const memberNameInputId = useId()
  const billTitleInputId = useId()
  const editBillTitleInputId = useId()
  const billAmountInputId = useId()

  // Clear toast after 4 seconds
  useEffect(() => {
    if (!successToast) return
    const timer = setTimeout(() => setSuccessToast(null), 4000)
    return () => clearTimeout(timer)
  }, [successToast])

  // Fetch homes on initial load
  const loadHomes = useCallback(async () => {
    setIsLoadingHomes(true)
    setGlobalError(null)
    try {
      const list = await api.getHomes()
      setHomes(list)
      if (list.length > 0 && list[0]) {
        const firstId = list[0].id
        setSelectedHomeId((prev) => (prev && list.some((h) => h.id === prev) ? prev : firstId))
      } else {
        setSelectedHomeId('')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect to the server'
      setGlobalError(`Could not load homes: ${message}`)
    } finally {
      setIsLoadingHomes(false)
    }
  }, [])

  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  // Fetch active home data (details, members, bills, balances)
  const loadHomeData = useCallback(async (homeId: string) => {
    if (!homeId) {
      setHomeDetails(null)
      setBills([])
      setBalances([])
      return
    }

    setIsLoadingHomeData(true)
    setActionError(null)

    try {
      const [details, billsList, balancesList] = await Promise.all([
        api.getHome(homeId),
        api.getBills(homeId),
        api.getBalances(homeId),
      ])
      setHomeDetails(details)
      setBills(billsList)
      setBalances(balancesList)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load home details'
      setActionError(`Failed to load data for this home: ${message}`)
    } finally {
      setIsLoadingHomeData(false)
    }
  }, [])

  useEffect(() => {
    if (selectedHomeId) {
      loadHomeData(selectedHomeId)
    }
  }, [selectedHomeId, loadHomeData])

  // Handle Home Creation
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return

    setIsSubmittingForm(true)
    setActionError(null)
    try {
      const created = await api.createHome(newHomeName.trim())
      setHomes((prev) => [created, ...prev])
      setSelectedHomeId(created.id)
      setNewHomeName('')
      setIsCreateHomeOpen(false)
      setSuccessToast(`Home "${created.name}" created successfully!`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create home'
      setActionError(`Error creating home: ${message}`)
    } finally {
      setIsSubmittingForm(false)
    }
  }

  // Handle Editing Home Name
  const handleEditHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editHomeName.trim() || !selectedHomeId) return

    setIsSubmittingForm(true)
    setActionError(null)
    try {
      const updated = await api.editHome(selectedHomeId, editHomeName.trim())
      setHomes((prev) => prev.map((h) => (h.id === updated.id ? { ...h, name: updated.name } : h)))
      setHomeDetails((prev) => (prev ? { ...prev, name: updated.name } : null))
      setIsEditHomeOpen(false)
      setSuccessToast(`Home renamed to "${updated.name}"!`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to rename home'
      setActionError(`Error renaming home: ${message}`)
    } finally {
      setIsSubmittingForm(false)
    }
  }

  // Handle Adding a Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return

    setIsSubmittingForm(true)
    setActionError(null)
    try {
      const member = await api.addMember(selectedHomeId, newMemberName.trim())
      setNewMemberName('')
      setIsAddMemberOpen(false)
      setSuccessToast(`Member "${member.name}" added!`)
      await loadHomeData(selectedHomeId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add member'
      setActionError(`Error adding member: ${message}`)
    } finally {
      setIsSubmittingForm(false)
    }
  }

  // Handle Removing a Member Added by Mistake
  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to remove "${memberName}" from this home? Any shares assigned to them will also be removed.`,
      )
    ) {
      return
    }
    try {
      await api.removeMember(selectedHomeId, memberId)
      await loadHomeData(selectedHomeId)
      setSuccessToast(`Member "${memberName}" removed successfully!`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove member'
      setActionError(`Error removing member: ${message}`)
    }
  }

  // Handle Bill Creation
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId) return

    const parsedCents = Math.round(Number.parseFloat(newBillAmount) * 100)
    if (Number.isNaN(parsedCents) || parsedCents <= 0) {
      setActionError('Total bill amount must be greater than $0.00')
      return
    }

    if (!newBillTitle.trim()) {
      setActionError('Bill title cannot be empty')
      return
    }

    setIsSubmittingForm(true)
    setActionError(null)
    try {
      const bill = await api.createBill(selectedHomeId, newBillTitle.trim(), parsedCents)
      setNewBillTitle('')
      setNewBillAmount('')
      setIsCreateBillOpen(false)
      setSuccessToast(`Bill "${bill.title}" created and split!`)
      await loadHomeData(selectedHomeId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create bill'
      setActionError(`Error creating bill: ${message}`)
    } finally {
      setIsSubmittingForm(false)
    }
  }

  // Handle Editing Bill Title
  const handleEditBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingBillId || !editBillTitle.trim()) return

    setIsSubmittingForm(true)
    setActionError(null)
    try {
      const updated = await api.editBill(editingBillId, editBillTitle.trim())
      setBills((prev) =>
        prev.map((b) => (b.id === updated.id ? { ...b, title: updated.title } : b)),
      )
      setEditingBillId(null)
      setSuccessToast('Bill title updated!')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update bill title'
      setActionError(`Error updating bill: ${message}`)
    } finally {
      setIsSubmittingForm(false)
    }
  }

  // Handle Paying a Share
  const handlePayShare = async (billId: string, shareId: string) => {
    const idempotencyKey = crypto.randomUUID()

    setPayingShareIds((prev) => ({ ...prev, [shareId]: true }))
    setShareErrors((prev) => {
      const next = { ...prev }
      delete next[shareId]
      return next
    })

    try {
      const paidShare = await api.payShare(billId, shareId, idempotencyKey)

      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) => {
              if (s.id !== shareId) return s
              return { ...s, paidAt: paidShare.paidAt }
            }),
          }
        }),
      )

      if (selectedHomeId) {
        api.getBalances(selectedHomeId).then(setBalances).catch(console.error)
      }

      setSuccessToast('Share paid successfully!')
    } catch (err: unknown) {
      let message = 'Payment failed'
      if (err instanceof ApiError) {
        message = err.message
      } else if (err instanceof Error) {
        message = err.message
      }
      setShareErrors((prev) => ({ ...prev, [shareId]: message }))
    } finally {
      setPayingShareIds((prev) => {
        const next = { ...prev }
        delete next[shareId]
        return next
      })
    }
  }

  // Handle Deleting a Single Bill
  const handleDeleteBill = async (billId: string, title: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete bill "${title}"? This will remove all associated shares.`,
      )
    ) {
      return
    }
    try {
      await api.deleteBill(billId)
      setBills((prev) => prev.filter((b) => b.id !== billId))
      if (selectedHomeId) {
        api.getBalances(selectedHomeId).then(setBalances).catch(console.error)
      }
      setSuccessToast(`Bill "${title}" deleted successfully!`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete bill'
      setActionError(`Error deleting bill: ${message}`)
    }
  }

  // Handle Resetting All Bills for Current Home
  const handleResetBills = async () => {
    if (
      !window.confirm(
        `Are you sure you want to reset all bills for "${homeDetails?.name}"? All bills and shares will be permanently deleted, resetting member balances to $0.00.`,
      )
    ) {
      return
    }
    try {
      await api.resetHome(selectedHomeId)
      setBills([])
      if (selectedHomeId) {
        api.getBalances(selectedHomeId).then(setBalances).catch(console.error)
      }
      setSuccessToast('All bills for this home have been reset!')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset bills'
      setActionError(`Error resetting bills: ${message}`)
    }
  }

  // Handle Deleting the Current Home
  const handleDeleteHome = async () => {
    if (
      !window.confirm(
        `Are you sure you want to delete home "${homeDetails?.name}"? All its members, bills, and shares will be permanently removed.`,
      )
    ) {
      return
    }
    try {
      await api.deleteHome(selectedHomeId)
      const updatedHomes = homes.filter((h) => h.id !== selectedHomeId)
      setHomes(updatedHomes)
      if (updatedHomes.length > 0 && updatedHomes[0]) {
        setSelectedHomeId(updatedHomes[0].id)
      } else {
        setSelectedHomeId('')
      }
      setSuccessToast('Home deleted successfully!')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete home'
      setActionError(`Error deleting home: ${message}`)
    }
  }

  // Summary KPI metrics
  const totalBillsCents = bills.reduce((sum, b) => sum + b.totalCents, 0)
  const totalSharesCount = bills.reduce((sum, b) => sum + b.shares.length, 0)
  const totalPaidSharesCount = bills.reduce(
    (sum, b) => sum + b.shares.filter((s) => s.paidAt !== null).length,
    0,
  )
  const totalPaidCents = bills.reduce(
    (sum, b) =>
      sum +
      b.shares
        .filter((s) => s.paidAt !== null)
        .reduce((shareSum, s) => shareSum + s.amountCents, 0),
    0,
  )
  const totalOutstandingCents = totalBillsCents - totalPaidCents
  const settlementPercentage =
    totalSharesCount > 0 ? Math.round((totalPaidSharesCount / totalSharesCount) * 100) : 100

  // Categorize bills for Active vs History (Fully Paid)
  const settledBills = bills.filter(
    (b) => b.shares.length > 0 && b.shares.every((s) => s.paidAt !== null),
  )
  const activeBills = bills.filter(
    (b) => b.shares.length === 0 || b.shares.some((s) => s.paidAt === null),
  )

  const displayedBills =
    billFilter === 'active' ? activeBills : billFilter === 'settled' ? settledBills : bills

  const previewMembersCount = homeDetails?.members?.length ?? 0
  const parsedPreviewCents = Math.round(Number.parseFloat(newBillAmount || '0') * 100)
  const isPreviewValid = !Number.isNaN(parsedPreviewCents) && parsedPreviewCents > 0

  return (
    <div className="container">
      {/* App Header */}
      <header className="app-header">
        <div>
          <h1 className="brand-title">
            <span className="brand-icon">🏠</span> Shared Bill Splitter
          </h1>
          <p className="brand-subtitle">
            Split household expenses fairly, track member balances, and settle payments with
            certainty.
          </p>
        </div>

        <div className="header-actions">
          {homes.length > 0 && (
            <div className="home-select-wrapper">
              <label htmlFor={homeSelectId} className="form-label" style={{ margin: 0 }}>
                Home:
              </label>
              <select
                id={homeSelectId}
                className="select-input"
                value={selectedHomeId}
                onChange={(e) => setSelectedHomeId(e.target.value)}
                disabled={isLoadingHomes}
              >
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setEditHomeName(homeDetails?.name || '')
                  setIsEditHomeOpen(true)
                }}
                title="Rename this home"
              >
                ✏️ Rename
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsCreateHomeOpen(true)}
          >
            + New Home
          </button>

          {selectedHomeId && (
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={handleDeleteHome}
              title="Delete this home and all its data"
            >
              Delete Home
            </button>
          )}
        </div>
      </header>

      {/* Global & Action Notifications */}
      {successToast && (
        <div className="alert alert-success">
          <span>✓ {successToast}</span>
          <button type="button" className="alert-close" onClick={() => setSuccessToast(null)}>
            ×
          </button>
        </div>
      )}

      {globalError && (
        <div className="alert alert-danger">
          <div>
            <strong>Error: </strong>
            <span>{globalError}</span>
          </div>
          <button type="button" className="btn btn-sm btn-secondary" onClick={loadHomes}>
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="alert alert-danger">
          <span>⚠️ {actionError}</span>
          <button type="button" className="alert-close" onClick={() => setActionError(null)}>
            ×
          </button>
        </div>
      )}

      {/* Initial Loading State */}
      {isLoadingHomes ? (
        <div className="loading-box">
          <div className="spinner" />
          <p>Connecting to database and loading homes...</p>
        </div>
      ) : homes.length === 0 ? (
        /* Empty State: No homes */
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">🏡</div>
            <h2 className="empty-title">No Homes Found</h2>
            <p className="empty-text">
              Get started by creating your shared home. You can then add your housemates and split
              bills evenly down to the exact cent.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsCreateHomeOpen(true)}
            >
              Create First Home
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Household Financial KPI Summary Cards */}
          <section className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">
                Total Incurred <span>🧾</span>
              </span>
              <span className="kpi-value">{formatMoney(totalBillsCents)}</span>
              <span className="kpi-sub">
                {bills.length} total bill{bills.length === 1 ? '' : 's'} recorded
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">
                Outstanding Balance <span>⏳</span>
              </span>
              <span
                className="kpi-value"
                style={{ color: totalOutstandingCents > 0 ? 'var(--danger)' : 'var(--text-main)' }}
              >
                {formatMoney(totalOutstandingCents)}
              </span>
              <span className="kpi-sub">
                {totalSharesCount - totalPaidSharesCount} share
                {totalSharesCount - totalPaidSharesCount === 1 ? '' : 's'} remaining
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">
                Settled Amount <span>✓</span>
              </span>
              <span className="kpi-value" style={{ color: 'var(--success)' }}>
                {formatMoney(totalPaidCents)}
              </span>
              <span className="kpi-sub">
                {totalPaidSharesCount} share{totalPaidSharesCount === 1 ? '' : 's'} completed
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">
                Settlement Rate <span>📊</span>
              </span>
              <span className="kpi-value">{settlementPercentage}%</span>
              <span className="kpi-sub">
                Across {homeDetails?.members.length ?? 0} active housemate
                {homeDetails?.members.length === 1 ? '' : 's'}
              </span>
            </div>
          </section>

          {/* Main Dashboard Grid */}
          <div className="dashboard-grid">
            {/* Left Column: Bills & Shares & History */}
            <section>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {billFilter === 'settled' ? '📜 Settled Bills History' : 'Bills & Payments'}
                </h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  {bills.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-outline-warning"
                      onClick={handleResetBills}
                      title="Reset and clear all bills for this home"
                    >
                      ↺ Reset Bills
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setActionError(null)
                      setIsCreateBillOpen(true)
                    }}
                    disabled={previewMembersCount === 0}
                    title={
                      previewMembersCount === 0 ? 'Add members to the home first' : 'Create a bill'
                    }
                  >
                    + Add Bill
                  </button>
                </div>
              </div>

              {/* Filter Tabs: Active vs Settled History */}
              <div className="tab-group">
                <button
                  type="button"
                  className={`tab-btn ${billFilter === 'active' ? 'active' : ''}`}
                  onClick={() => setBillFilter('active')}
                >
                  Pending Bills <span className="tab-count">{activeBills.length}</span>
                </button>
                <button
                  type="button"
                  className={`tab-btn ${billFilter === 'settled' ? 'active' : ''}`}
                  onClick={() => setBillFilter('settled')}
                >
                  📜 Paid History <span className="tab-count">{settledBills.length}</span>
                </button>
                <button
                  type="button"
                  className={`tab-btn ${billFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setBillFilter('all')}
                >
                  All Bills <span className="tab-count">{bills.length}</span>
                </button>
              </div>

              {isLoadingHomeData ? (
                <div className="loading-box">
                  <div className="spinner" />
                  <p>Loading bills and shares...</p>
                </div>
              ) : displayedBills.length === 0 ? (
                <div className="card">
                  <div className="empty-state">
                    <div className="empty-icon">{billFilter === 'settled' ? '📜' : '🧾'}</div>
                    <h3 className="empty-title">
                      {billFilter === 'settled'
                        ? 'No Settled Bills Yet'
                        : billFilter === 'active'
                          ? 'No Pending Bills'
                          : 'No Bills Yet'}
                    </h3>
                    <p className="empty-text">
                      {billFilter === 'settled'
                        ? 'When all members pay their shares for a bill, it moves to this history section.'
                        : billFilter === 'active' && bills.length > 0
                          ? 'All recorded bills are currently settled! Check the Paid History tab.'
                          : previewMembersCount === 0
                            ? 'Add members to this home first using the panel on the right, then you can create bills.'
                            : 'There are no bills recorded for this home. Create your first bill to see the split.'}
                    </p>
                    {previewMembersCount > 0 && billFilter !== 'settled' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setIsCreateBillOpen(true)}
                      >
                        Split a Bill
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                displayedBills.map((bill) => {
                  const totalShares = bill.shares.length
                  const billPaidShares = bill.shares.filter((s) => s.paidAt !== null).length
                  const isFullyPaid = totalShares > 0 && billPaidShares === totalShares
                  const progressPct =
                    totalShares > 0 ? Math.round((billPaidShares / totalShares) * 100) : 0

                  return (
                    <div key={bill.id} className="bill-card">
                      <div className="bill-card-header">
                        <div className="bill-title-area">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="bill-title">{bill.title}</span>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => {
                                setEditingBillId(bill.id)
                                setEditBillTitle(bill.title)
                              }}
                              title="Edit bill title"
                            >
                              ✏️
                            </button>
                          </div>
                          <span className="bill-date">Recorded {formatDate(bill.createdAt)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className={`badge ${isFullyPaid ? 'badge-paid' : 'badge-unpaid'}`}>
                            <span className="badge-dot" />
                            {isFullyPaid
                              ? 'Fully Settled'
                              : `${billPaidShares}/${totalShares} Paid`}
                          </span>
                          <div className="bill-total">
                            {formatMoney(bill.totalCents)}
                            <div className="bill-total-cents">({bill.totalCents}¢)</div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeleteBill(bill.id, bill.title)}
                            title="Delete this bill"
                          >
                            🗑
                          </button>
                        </div>
                      </div>

                      {/* Visual Progress Bar */}
                      <div className="bill-progress-container">
                        <span>
                          Settlement: {billPaidShares} of {totalShares} paid ({progressPct}%)
                        </span>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                        </div>
                      </div>

                      <table className="shares-table">
                        <thead>
                          <tr>
                            <th>Member</th>
                            <th>Share Amount</th>
                            <th>Payment Status</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bill.shares.map((share) => {
                            const isPaid = share.paidAt !== null
                            const isPaying = !!payingShareIds[share.id]
                            const shareError = shareErrors[share.id]
                            const memberName =
                              share.memberName ||
                              homeDetails?.members.find((m) => m.id === share.memberId)?.name ||
                              'Member'

                            return (
                              <tr key={share.id}>
                                <td>
                                  <div className="member-info">
                                    <div className="member-avatar">
                                      {memberName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                      <div className="member-name">{memberName}</div>
                                      {shareError && (
                                        <div
                                          style={{
                                            color: 'var(--danger-text)',
                                            fontSize: 12,
                                            marginTop: 2,
                                          }}
                                        >
                                          ⚠️ {shareError}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <strong>{formatMoney(share.amountCents)}</strong>
                                  <span
                                    style={{
                                      color: 'var(--text-muted)',
                                      fontSize: 12,
                                      marginLeft: 5,
                                    }}
                                  >
                                    ({share.amountCents}¢)
                                  </span>
                                </td>
                                <td>
                                  {isPaid ? (
                                    <span className="badge badge-paid">
                                      <span className="badge-dot" />
                                      Paid {formatDate(share.paidAt)}
                                    </span>
                                  ) : (
                                    <span className="badge badge-unpaid">
                                      <span className="badge-dot" />
                                      Unpaid
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {isPaid ? (
                                    <span
                                      style={{
                                        color: 'var(--success)',
                                        fontWeight: 600,
                                        fontSize: 13,
                                      }}
                                    >
                                      ✓ Completed
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-pay"
                                      onClick={() => handlePayShare(bill.id, share.id)}
                                      disabled={isPaying}
                                    >
                                      {isPaying ? (
                                        <>
                                          <span className="spinner-sm" />
                                          Paying...
                                        </>
                                      ) : (
                                        'Pay Share'
                                      )}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })
              )}
            </section>

            {/* Right Column: Home Members & Balances */}
            <aside>
              {/* Balances Card */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <span>💰</span> Outstanding Balances
                  </h3>
                </div>
                <div className="card-body">
                  {isLoadingHomeData ? (
                    <div className="loading-box" style={{ padding: 20 }}>
                      <div className="spinner" />
                    </div>
                  ) : balances.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                      No members in this home. Add members below.
                    </p>
                  ) : (
                    <div className="balance-list">
                      {balances.map((b) => (
                        <div key={b.memberId} className="balance-item">
                          <div className="member-info">
                            <div className="member-avatar">{b.name.charAt(0).toUpperCase()}</div>
                            <span className="member-name">{b.name}</span>
                          </div>
                          <div className="balance-amount">
                            {b.outstandingCents > 0 ? (
                              <span className="balance-owing">
                                Owes {formatMoney(b.outstandingCents)}
                              </span>
                            ) : (
                              <span className="balance-settled">✓ Settled</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Members List Card */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <span>👥</span> House Members ({homeDetails?.members.length ?? 0})
                  </h3>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => setIsAddMemberOpen(true)}
                  >
                    + Add
                  </button>
                </div>
                <div className="card-body">
                  {homeDetails?.members.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '12px 0' }}>
                      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>
                        No members added yet.
                      </p>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => setIsAddMemberOpen(true)}
                      >
                        Add First Member
                      </button>
                    </div>
                  ) : (
                    <div className="balance-list">
                      {homeDetails?.members.map((m, index) => (
                        <div key={m.id} className="balance-item">
                          <div className="member-info">
                            <div className="member-avatar">{index + 1}</div>
                            <span className="member-name">{m.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}
                            >
                              Order #{index + 1}
                            </span>
                            <button
                              type="button"
                              className="btn-icon btn-icon-danger"
                              onClick={() => handleRemoveMember(m.id, m.name)}
                              title={`Remove ${m.name}`}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      )}

      {/* Modal: Create Home */}
      {isCreateHomeOpen && (
        <div className="dialog-overlay">
          <div
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-home-title"
          >
            <div className="dialog-header">
              <h3 id="create-home-title" className="dialog-title">
                Create a New Home
              </h3>
              <button
                type="button"
                className="alert-close"
                onClick={() => setIsCreateHomeOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateHome}>
              <div className="dialog-body">
                <div className="form-group">
                  <label htmlFor={homeNameInputId} className="form-label">
                    Home Name
                  </label>
                  <input
                    id={homeNameInputId}
                    type="text"
                    className="form-input"
                    placeholder="e.g. Apartment 4B, Baker St House"
                    value={newHomeName}
                    onChange={(e) => setNewHomeName(e.target.value)}
                    required
                  />
                  <p className="form-help">Enter a recognizable name for this household.</p>
                </div>
              </div>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCreateHomeOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingForm || !newHomeName.trim()}
                >
                  {isSubmittingForm ? 'Creating...' : 'Create Home'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename Home */}
      {isEditHomeOpen && (
        <div className="dialog-overlay">
          <div
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-home-title"
          >
            <div className="dialog-header">
              <h3 id="edit-home-title" className="dialog-title">
                Rename Home
              </h3>
              <button
                type="button"
                className="alert-close"
                onClick={() => setIsEditHomeOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleEditHome}>
              <div className="dialog-body">
                <div className="form-group">
                  <label htmlFor={editHomeNameInputId} className="form-label">
                    Home Name
                  </label>
                  <input
                    id={editHomeNameInputId}
                    type="text"
                    className="form-input"
                    value={editHomeName}
                    onChange={(e) => setEditHomeName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsEditHomeOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingForm || !editHomeName.trim()}
                >
                  {isSubmittingForm ? 'Saving...' : 'Save Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Member */}
      {isAddMemberOpen && (
        <div className="dialog-overlay">
          <div
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-member-title"
          >
            <div className="dialog-header">
              <h3 id="add-member-title" className="dialog-title">
                Add Member to {homeDetails?.name}
              </h3>
              <button
                type="button"
                className="alert-close"
                onClick={() => setIsAddMemberOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAddMember}>
              <div className="dialog-body">
                <div className="form-group">
                  <label htmlFor={memberNameInputId} className="form-label">
                    Member Name
                  </label>
                  <input
                    id={memberNameInputId}
                    type="text"
                    className="form-input"
                    placeholder="e.g. Asha, Ben, Chitra"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    required
                  />
                  <p className="form-help">
                    Members receive extra cents in the exact order they are added.
                  </p>
                </div>
              </div>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsAddMemberOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingForm || !newMemberName.trim()}
                >
                  {isSubmittingForm ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Bill */}
      {isCreateBillOpen && (
        <div className="dialog-overlay">
          <div
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-bill-title"
          >
            <div className="dialog-header">
              <h3 id="create-bill-title" className="dialog-title">
                Split a New Bill
              </h3>
              <button
                type="button"
                className="alert-close"
                onClick={() => setIsCreateBillOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateBill}>
              <div className="dialog-body">
                <div className="form-group">
                  <label htmlFor={billTitleInputId} className="form-label">
                    Bill Title
                  </label>
                  <input
                    id={billTitleInputId}
                    type="text"
                    className="form-input"
                    placeholder="e.g. Electricity, Groceries, Internet"
                    value={newBillTitle}
                    onChange={(e) => setNewBillTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor={billAmountInputId} className="form-label">
                    Total Amount ($)
                  </label>
                  <input
                    id={billAmountInputId}
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="form-input"
                    placeholder="e.g. 30.00"
                    value={newBillAmount}
                    onChange={(e) => setNewBillAmount(e.target.value)}
                    required
                  />
                  <p className="form-help">
                    Converted automatically to integer cents. No fractional cents are used.
                  </p>
                </div>

                {/* Live Split Preview */}
                {isPreviewValid && previewMembersCount > 0 && (
                  <div
                    style={{
                      background: '#f8fafc',
                      borderRadius: 'var(--radius-sm)',
                      padding: 14,
                      marginTop: 14,
                      fontSize: 13,
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text-main)' }}>
                      Deterministic Split Preview ({previewMembersCount} members):
                    </div>
                    {homeDetails?.members.map((m, idx) => {
                      const base = Math.floor(parsedPreviewCents / previewMembersCount)
                      const rem = parsedPreviewCents % previewMembersCount
                      const share = base + (idx < rem ? 1 : 0)
                      return (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '4px 0',
                            borderBottom: '1px dashed #e2e8f0',
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>
                            #{idx + 1} {m.name}
                          </span>
                          <span style={{ fontWeight: 600 }}>
                            {formatMoney(share)} ({share}¢)
                            {idx < rem && (
                              <span
                                style={{ color: 'var(--primary)', marginLeft: 6, fontSize: 11 }}
                              >
                                (+1¢ remainder)
                              </span>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCreateBillOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingForm || !newBillTitle.trim() || !isPreviewValid}
                >
                  {isSubmittingForm ? 'Creating Bill...' : 'Create & Split'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Bill Title */}
      {editingBillId && (
        <div className="dialog-overlay">
          <div
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-bill-title"
          >
            <div className="dialog-header">
              <h3 id="edit-bill-title" className="dialog-title">
                Edit Bill Title
              </h3>
              <button type="button" className="alert-close" onClick={() => setEditingBillId(null)}>
                ×
              </button>
            </div>
            <form onSubmit={handleEditBill}>
              <div className="dialog-body">
                <div className="form-group">
                  <label htmlFor={editBillTitleInputId} className="form-label">
                    Bill Title
                  </label>
                  <input
                    id={editBillTitleInputId}
                    type="text"
                    className="form-input"
                    value={editBillTitle}
                    onChange={(e) => setEditBillTitle(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingBillId(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingForm || !editBillTitle.trim()}
                >
                  {isSubmittingForm ? 'Saving...' : 'Save Title'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
