# Backend request — complete the Workforce (HR) API

The console now manages employees (edit, pay, branch access, suspend/terminate,
PIN, roles) and shows a staffing panel on the Dashboard. All of that runs on
endpoints that already exist. The pages below still run on mock data because
the API has no way to *list* or *act on* these resources. Please add the
following, keeping the existing conventions (permission codes from §15.2,
tenant/branch scoping, `Idempotency-Key` on writes, minor-unit money strings,
cursor pagination with `limit <= 100`).

## 1. Attendance (page `/workforce/attendance`)
- `GET /workforce/attendance?branchId&employeeId&from&to&flags&cursor&limit`
  — list records. Permission: `hr.employee.view` or `report.view.workforce`.
  Each row: id, employeeId, employeeName, branchId, scheduledStart/End,
  clockIn/clockOut, method, regularHours, overtimeHours, breakMinutes,
  flags (`late_arrival | early_departure | missing_clock_out |
  outside_geofence | no_scheduled_shift | auto_closed`), corrected, cost.
- Keep `POST /workforce/attendance/{id}/correct` as is.

## 2. Schedules and shifts (page `/workforce/schedules`)
- `GET /workforce/schedules?branchId&weekStart` — list schedules with shifts.
- `PATCH /workforce/schedules/{scheduleId}/shifts/{shiftId}` and
  `DELETE` the same path — edit/remove a shift (re-run the rest, consecutive-day
  and certification validation, return `violations[]`).
- `POST /workforce/schedules/{scheduleId}/publish` — draft -> published.
- `POST /workforce/schedules/{scheduleId}/shifts/{shiftId}/acknowledge`.
- Shift rows should include `projectedCost` (minor units + currency).

## 3. Overtime (page `/workforce/overtime`)
- `GET /workforce/overtime?branchId&status&from&to` — list requests.
- `POST /workforce/overtime/{id}/approve` and `/reject` (body: `reason`).
  Permission: `hr.overtime.approve`.

## 4. Performance (page `/workforce/performance`)
- `GET /workforce/performance?branchId&from&to` — per-employee metrics
  (orders handled, average ticket, void/discount rate, hours, attendance rate).
  Permission: `hr.performance.view`.

## 5. Employees — small gaps
- `POST /workforce/employees/{id}/reactivate` — the console can suspend or
  terminate but cannot reverse a suspension. Body: `reason`.
- `GET /workforce/employees/{id}/compensation/history` — all effective-dated
  versions (the console only reads the current one).
- `DELETE /workforce/employees/{id}/branches/{branchId}` — the console can add
  a permitted branch but not remove one.
- Return `status`, `permittedBranchIds`, `userId` and `hasPin` on the list
  response so the roster does not need one call per row.
- Documents (food-handler cert etc.): `GET/POST/DELETE
  /workforce/employees/{id}/documents` with `type`, `reference`, `expiresOn`.
  The roster's "expiring documents" tile has no source today.
- Add `limit`/`cursor`/`status`/`branchId` filters to `GET /workforce/employees`
  (today the console fetches everything and filters in the browser).

## 6. Dashboard staffing summary
- `GET /workforce/summary?branchId&businessDay` — one call returning headcount
  by status plus the attendance block that `GET /reports/branches/{id}/overview`
  returns per branch, aggregated across the caller's branches. Today the
  console makes one overview call per branch (capped at 5) and sums them.
- Add `labourCostMinorUnits` for the day so the Dashboard's labour-cost and
  prime-cost tiles can stop showing a dash.

## Acceptance
- Every new route has a `@RequirePermission`, tenant scoping and OpenAPI
  schemas, so `npm run api:types` regenerates `lib/api/schema.ts` cleanly.
- 403 (not 404) when the caller lacks the permission, so the console can hide
  the feature quietly.
