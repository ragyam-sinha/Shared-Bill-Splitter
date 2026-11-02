# 🏠 Shared Bill Splitter

A robust, fault-tolerant bill-splitting application built for shared households. It enables housemates to register homes, add members in sequential order, split expenses down to the exact whole cent without rounding errors, track real-time balances, and settle shares safely with atomic idempotency and concurrency guards.

Developed for the **SDE Intern Assignment: Shared Bill Splitter**.

---

## 📑 Table of Contents

- [System Architecture & Data Flow](#️-system-architecture--data-flow)
- [Tech Stack](#-tech-stack)
- [Database Schema & Named Constraints](#-database-schema--named-constraints)
- [Core Business Logic & Algorithms](#-core-business-logic--algorithms)
- [Edge Cases Handled](#-edge-cases-handled)
- [Design Decisions](#-design-decisions)
- [User Interface & Enhancements](#-user-interface--enhancements)
- [API Reference](#-api-reference)
- [Getting Started & Local Setup](#-getting-started--local-setup)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [3-Minute Video Walkthrough Script](#-3-minute-video-walkthrough-script)
- [Author & Acknowledgements](#-author--acknowledgements)

---

## 🏗️ System Architecture & Data Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│                   Frontend (React 19 + Vite)                    │
│                     http://localhost:5173                       │
│  - KPI Summary Cards, Settlement Progress Bar, Segmented Tabs   │
│  - Real-time Split Preview, Member Removal, Inline Edit Modals   │
│  - Per-share async loading states & 8s AbortController Timeouts │
└───────────────────────────────┬─────────────────────────────────┘
                                │ JSON HTTP /api/* (Vite Dev Proxy)
┌───────────────────────────────▼─────────────────────────────────┐
│             Backend API (Hono on Cloudflare Workers)            │
│                     http://127.0.0.1:8787                       │
│  - RESTful API with strict input sanitization & integer typing  │
│  - Compare-and-Set atomic payments with Idempotency-Key header  │
│  - Multi-statement atomic D1 transactions (DB.batch)            │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Prepared SQL Statements
┌───────────────────────────────▼─────────────────────────────────┐
│                 Database (Cloudflare D1 / SQLite)               │
│  - Tables: homes, members, bills, shares                        │
│  - 9 Named Database Constraints enforcing relational integrity   │
│  - Compound indexes on lookup & sorting columns                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer              | Technology                                                   | Details                                                                   |
| :----------------- | :----------------------------------------------------------- | :------------------------------------------------------------------------ |
| **Backend API**    | [Hono v4](https://hono.dev/)                                 | Ultra-fast web framework running on Cloudflare Workers edge runtime       |
| **Database**       | [Cloudflare D1](https://developers.cloudflare.com/d1/)       | Serverless SQLite database with atomic transactions and SQL migrations    |
| **Frontend Web**   | [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) | Single-page application with modern hooks and pure responsive CSS         |
| **Client Routing** | [TanStack Router](https://tanstack.com/router)               | Strongly typed client-side routing                                        |
| **Type System**    | [TypeScript](https://www.typescriptlang.org/)                | Strict type configuration across the monorepo with zero `any` types       |
| **Testing**        | [Vitest](https://vitest.dev/)                                | Unit and integration test suite executing via `@cloudflare/vitest-plugin` |
| **Code Quality**   | [Biome](https://biomejs.dev/)                                | Fast, opinionated formatter and linter                                    |

---

## 🗄️ Database Schema & Named Constraints

The database schema is defined as a versioned migration in [`api/migrations/0001_init.sql`](api/migrations/0001_init.sql). It enforces **9 named constraints** to ensure total relational integrity at the storage engine level:

| Constraint Name                  | Type          | Table     | Purpose & Safety Guarantee                                                                      |
| :------------------------------- | :------------ | :-------- | :---------------------------------------------------------------------------------------------- |
| `chk_homes_name_not_empty`       | `CHECK`       | `homes`   | Prevents blank, empty, or whitespace-only home names (`trim(name) != ''`).                      |
| `fk_members_home`                | `FOREIGN KEY` | `members` | Prevents orphan members; cascades deletion when a household is removed.                         |
| `chk_members_name_not_empty`     | `CHECK`       | `members` | Rejects members with empty or whitespace-only names.                                            |
| `fk_bills_home`                  | `FOREIGN KEY` | `bills`   | Prevents bills that do not belong to a valid household.                                         |
| `chk_bills_total_positive`       | `CHECK`       | `bills`   | Enforces strictly positive bill amounts (`total_cents > 0`).                                    |
| `chk_bills_title_not_empty`      | `CHECK`       | `bills`   | Prevents empty or blank bill titles (`trim(title) != ''`).                                      |
| `fk_shares_bill`                 | `FOREIGN KEY` | `shares`  | Prevents orphan shares disconnected from an existing bill.                                      |
| `fk_shares_member`               | `FOREIGN KEY` | `shares`  | Prevents assigning shares to nonexistent household members.                                     |
| `chk_shares_amount_non_negative` | `CHECK`       | `shares`  | Enforces non-negative share amounts (`amount_cents >= 0`) for whole-cent distributions.         |
| `chk_shares_payment_consistency` | `CHECK`       | `shares`  | Enforces state consistency: `paid_at` and `idempotency_key` must both be set or both be `NULL`. |

---

## ⚡ Core Business Logic & Algorithms

### 1. Deterministic Integer-Cent Bill Splitting

To eliminate IEEE-754 floating-point rounding errors (e.g. `0.1 + 0.2 = 0.30000000000000004`), all monetary amounts are stored and calculated strictly in integer cents:

$$\text{baseAmount} = \left\lfloor \frac{\text{totalCents}}{N} \right\rfloor$$
$$\text{remainder} = \text{totalCents} \pmod N$$

- Extra remainder cents are distributed one-by-one to members in the exact order they joined (`ORDER BY order_index ASC, rowid ASC`).
- **Example:** A $10.00 (1000¢) bill shared among 3 members yields:
  - Member 1: **334¢** ($3.34)
  - Member 2: **333¢** ($3.33)
  - Member 3: **333¢** ($3.33)
  - $\sum \text{shares} = 1000¢ \equiv \text{totalCents}$
- The bill record and all associated shares are created in a single atomic transaction via `c.env.DB.batch(...)`.

### 2. Concurrency-Safe Idempotent Payments

Every payment request supplies an `Idempotency-Key` header.
- Payments execute an atomic SQL compare-and-set update:

  ```sql
  UPDATE shares
  SET paid_at = ?, idempotency_key = ?
  WHERE id = ? AND bill_id = ? AND paid_at IS NULL
  ```
- **Same Key Retry:** If a share has already been paid with the matching idempotency key, the API returns `200 OK` with the original `paidAt` timestamp without duplicate deductions.
- **Key Mismatch / Double Payment:** If the share was already paid under a different idempotency key, the API returns `409 Conflict`.
- **Race Condition Safety:** If two requests arrive at the exact same millisecond, SQLite's write lock ensures only one update achieves `meta.changes === 1`. The concurrent competitor gets `changes === 0`, re-fetches the record, and safely yields `409 Conflict` (or `200 OK` on key match).

### 3. Real-Time Balance Aggregation

`GET /api/homes/:homeId/balances` executes a correlated SQL query summing unpaid shares (`paid_at IS NULL`) across all bills in the home, returned in sequential member order. Members who have paid all shares display an outstanding balance of `$0.00`.

---

## 🛡️ Edge Cases Handled

| Edge Case                                | API & Database Handling                                                                                                                 | UI / UX Handling                                                                                                                           |
| :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Home with no members**              | `POST /api/homes/:homeId/bills` returns `422 Unprocessable Entity` (`"Home has no members"`).                                           | The "Add Bill" button is disabled with a helpful tooltip prompting the user to add members first.                                          |
| **2. Zero, negative, or decimal amount** | Strictly validated with `Number.isInteger(totalCents) && totalCents > 0`. Returns `422`. Also enforced by `chk_bills_total_positive`.   | Form prevents non-positive numbers and provides input validation feedback before submission.                                               |
| **3. Bill does not divide evenly**       | Remainder cents are allocated one-by-one to members in insertion order (`order_index`). Shares always sum to `totalCents`.              | Live Split Breakdown displays exact penny assignments with remainder badges before submitting.                                             |
| **4. Payment request sent twice**        | Verified against `shares.idempotency_key`. The second request returns `200 OK` with the exact same payload.                             | Payment button shows success state; balances remain consistent.                                                                            |
| **5. Two members paying simultaneously** | Handled atomically via SQLite's row-level update lock (`WHERE paid_at IS NULL`). Only one succeeds; the second receives `409 Conflict`. | Failed concurrent request shows an informative toast alert; share updates to paid.                                                         |
| **6. Non-existent bill or share**        | Validates bill ID and share ID, and ensures the share belongs to that bill. Returns `404 Not Found`.                                    | UI notifies the user that the bill or share could not be found and refreshes the list.                                                     |
| **7. Slow network or 500 server error**  | API transactions rollback completely on errors, leaving database state clean.                                                           | API client wraps requests in 8-second `AbortController` timeouts; failed payments display inline error messages without freezing the page. |

---

## 💡 Design Decisions

### 1. Atomic Conditional Updates for Concurrency and Idempotency

- **Decision:** Implemented an atomic conditional SQL query (`UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL`) paired with `meta.changes` inspection rather than application-level mutexes or external distributed locks.
- **Why:** SQLite/D1 executes write operations with strict serialized isolation. When two concurrent requests try to pay the same share simultaneously, exactly one execution finds `paid_at IS NULL` and produces `changes === 1`. The competing request produces `changes === 0`, immediately re-fetches the recorded payment, and safely returns `200 OK` if the request presented the same `Idempotency-Key` or `409 Conflict` if a different key was used. This eliminates race conditions, prevents double payments, and honors idempotent retries with zero external infrastructure overhead.

### 2. Whole-Cent Integer Math with Deterministic Member Ordering

- **Decision:** Handled all currency strictly as integer cents (`INTEGER`), computing base shares with `Math.floor(totalCents / N)` and distributing the remainder `totalCents % N` one cent at a time to members ordered by `order_index ASC, rowid ASC`.
- **Why:** IEEE-754 floating-point arithmetic introduces rounding inaccuracies that corrupt financial calculations. Whole cent integers guarantee exact sums where `sum(shares) == totalCents` every time. Storing and sorting by a persistent sequential `order_index` guarantees that extra pennies are distributed deterministically to the earliest members added, even when multiple members are created within the same millisecond.

### 3. Named Database Constraints and Resilient UI Error Boundaries

- **Decision:** Implemented named integrity constraints at the database level (`chk_bills_total_positive`, `chk_shares_amount_non_negative`, `chk_shares_payment_consistency`, `fk_members_home`, `fk_bills_home`, `fk_shares_bill`, `fk_shares_member`, and non-empty name checks) while designing the React frontend with per-share asynchronous state tracking, request timeouts, and non-blocking error alerts.
- **Why:** The named constraints safeguard data integrity at the lowest layer—preventing negative shares, invalid bill totals, orphaned records, or partially paid states (`paid_at` without `idempotency_key`). On the web client, isolating in-flight states per share button and handling network timeouts ensures that slow API responses or server 500 errors display clear, dismissible feedback without freezing or crashing the page.

---

## 🎨 User Interface & Enhancements

The single-page web app is styled with a modern SaaS aesthetic, complete with dark/light visual depth, clean typography, and interactive micro-interactions:

1. **KPI Summary Cards:** Real-time metrics displaying **Total Household Expenses**, **Outstanding Balance**, and **Settlement Ratio (%)** with a dynamic progress bar.
2. **Household Management:**
   - Dropdown household switcher.
   - **Inline Household Renaming:** Edit household names directly with modal confirmation.
   - **Delete Household:** Remove unwanted households with cascading clean-up.
3. **Member Roster & Mistaken Member Removal:**
   - Sequential member cards showing member position and avatar badges.
   - **Remove Mistaken Member:** Safely remove a member who was added by mistake (with checks against unpaid active bills).
4. **Interactive Bill Splitting:**
   - Instant calculation preview showing the exact breakdown and extra cent allocations before bill creation.
   - Inline **Edit Bill Title** modal.
   - Single-click **Delete Bill**.
5. **Segmented Bill History Tabs:**
   - **Active Bills Tab:** Displays bills with pending shares, per-share pay buttons, and settlement badges.
   - **Paid Bills History Tab:** Dedicated historical view where fully settled bills are archived with payment completion dates.
6. **Reset Household Option:**
   - Reset all bills and shares in a home back to `$0.00` with a single click.

---

## 📡 API Reference

### Households (`/api/homes`)

| Method   | Endpoint                   | Description                 | Payload / Response                                         |
| :------- | :------------------------- | :-------------------------- | :--------------------------------------------------------- |
| `GET`    | `/api/homes`               | List all households         | `200 [{ id, name, createdAt }]`                            |
| `POST`   | `/api/homes`               | Create a new household      | Body: `{ "name": string }`<br>Response: `201 { id, name }` |
| `GET`    | `/api/homes/:homeId`       | Get household with members  | `200 { id, name, members: [...] }`                         |
| `PATCH`  | `/api/homes/:homeId`       | Rename household            | Body: `{ "name": string }`<br>Response: `200 { id, name }` |
| `DELETE` | `/api/homes/:homeId`       | Delete household & all data | `200 { success: true }`                                    |
| `POST`   | `/api/homes/:homeId/reset` | Reset all bills & balances  | `200 { success: true }`                                    |

### Members (`/api/homes/:homeId/members`)

| Method   | Endpoint                               | Description          | Payload / Response                                                 |
| :------- | :------------------------------------- | :------------------- | :----------------------------------------------------------------- |
| `POST`   | `/api/homes/:homeId/members`           | Add a member to home | Body: `{ "name": string }`<br>Response: `201 { id, homeId, name }` |
| `DELETE` | `/api/homes/:homeId/members/:memberId` | Remove member        | `200 { success: true }`                                            |

### Bills & Splitting (`/api/homes/:homeId/bills`)

| Method   | Endpoint                   | Description              | Payload / Response                                                                                                    |
| :------- | :------------------------- | :----------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/homes/:homeId/bills` | List bills with shares   | `200 [{ id, title, totalCents, shares: [...] }]`                                                                      |
| `POST`   | `/api/homes/:homeId/bills` | Create and split bill    | Body: `{ "title": string, "totalCents": number }`<br>Response: `201 { id, homeId, title, totalCents, shares: [...] }` |
| `PATCH`  | `/api/bills/:billId`       | Edit bill title          | Body: `{ "title": string }`<br>Response: `200 { id, title }`                                                          |
| `DELETE` | `/api/bills/:billId`       | Delete bill & its shares | `200 { success: true }`                                                                                               |

### Payments & Balances

| Method | Endpoint                                 | Description               | Payload / Response                                                                        |
| :----- | :--------------------------------------- | :------------------------ | :---------------------------------------------------------------------------------------- |
| `POST` | `/api/bills/:billId/shares/:shareId/pay` | Pay a share               | Header: `Idempotency-Key: <key>`<br>Response: `200 { id, memberId, amountCents, paidAt }` |
| `GET`  | `/api/homes/:homeId/balances`            | Aggregate member balances | `200 { balances: [{ memberId, name, outstandingCents }] }`                                |

---

## 💻 Getting Started & Local Setup

### Prerequisites

- **Node.js**: v20 or newer
- **pnpm**: v9 or newer (`npm install -g pnpm`)

### 1. Clone the repository

```bash
git clone https://github.com/ragyam-sinha/Shared-Bill-Splitter.git
cd Shared-Bill-Splitter
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Run development servers

```bash
pnpm dev
```

Both services start concurrently:
- **Frontend Dashboard:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://127.0.0.1:8787](http://127.0.0.1:8787)
- **API Health Check:** [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health)

---

## 🧪 Testing & Quality Assurance

All quality commands pass with zero errors:

```bash
# 1. Run full Vitest integration suite (24/24 passing in Cloudflare Workers runtime)
pnpm test

# 2. Run Biome formatting & linting checks
pnpm check

# 3. Automatically fix formatting discrepancies
pnpm check:fix

# 4. Run TypeScript compiler across all packages (zero errors, strict mode)
pnpm typecheck

# 5. Build production bundle for the frontend
pnpm build
```

---

## 📹 3-Minute Video Walkthrough Script

Use this structured timeline for recording your assignment demo:

- **0:00 - 0:45 | Architecture & Monorepo Overview:**
  - Introduce the project: Monorepo with Hono on Cloudflare Workers, Cloudflare D1 (SQLite), and React 19 SPA.
  - Showcase the 9 named constraints in `api/migrations/0001_init.sql` protecting data integrity.
- **0:45 - 1:30 | Household Setup & Uneven Bill Splitting:**
  - Create a household and add 3 members (Alice, Bob, Charlie).
  - Add a $10.00 (1000¢) bill and explain the deterministic remainder allocation (334¢, 333¢, 333¢).
  - Demonstrate the live split breakdown preview in the UI.
- **1:30 - 2:15 | Atomic Payments, Idempotency & Concurrency:**
  - Click "Pay" on a member's share and show the real-time balance update.
  - Explain how the `Idempotency-Key` header and atomic `UPDATE ... WHERE paid_at IS NULL` query prevent double payments and handle race conditions.
  - Demonstrate the **Paid Bills History** tab once all shares are settled.
- **2:15 - 3:00 | Resilience, Bonus Features & Trade-offs:**
  - Demonstrate the bonus features: Inline household rename, mistaken member removal, and reset balance option.
  - Explain the network resilience: 8-second request timeouts and per-share loading states.
  - Summarize the core trade-off: **Atomic SQLite updates vs. distributed Redis mutexes** (lower complexity, zero external latency, robust ACID guarantees).

---

## 👤 Author & Acknowledgements

- **Developer:** [Ragyam Sinha](https://github.com/ragyam-sinha)
- **Project Repository:** [Shared-Bill-Splitter](https://github.com/ragyam-sinha/Shared-Bill-Splitter)
- **Submission:** SDE Intern Assignment: Shared Bill Splitter
