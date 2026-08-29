/**
 * Governance fixtures — users, roles, approvals, the audit log, anomaly
 * flags and segregation-of-duties conflicts. SRS ch.15.6 and ch.20.
 */

import type {
  AnomalyFlag,
  AnomalyKind,
  ApprovalKind,
  ApprovalRequest,
  ApprovalStatus,
  AuditEntry,
  Localised,
  Money,
  PermissionKey,
  Role,
  RoleKey,
  Session,
  SodConflict,
  User,
} from "../types";
import {
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  SOD_PAIRS,
  permissionsForRole,
  roleRequiresMfa,
} from "../permissions";
import { ACTIVE_TENANT_ID, brands, branches } from "./org";
import { employees } from "./workforce";
import { chance, createRng, float, int, pick, seqId } from "./rng";
import { hoursAgo, minutesAgo, NOW_MS } from "./clock";

const rng = createRng(0x2d90);
const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const roles: Role[] = ROLE_KEYS.map((key, i) => {
  const definition = ROLE_DEFINITIONS[key];
  return {
    id: seqId("rol", i + 1),
    key,
    name: definition.name,
    description: definition.character,
    system: true,
    permissions: definition.permissions,
    defaultScope: definition.defaultScope,
    userCount: 0,
  };
});

// One cloned custom role, to show that FR-SEC-011 is supported.
roles.push({
  id: seqId("rol", roles.length + 1),
  key: "branch_manager",
  name: { en: "Branch Manager (no refunds)", ar: "مدير فرع (بدون استرداد)" },
  description: {
    en: "Cloned from Branch Manager with refund issuance removed, for new managers in their first 90 days.",
    ar: "منسوخ من مدير الفرع مع إزالة صلاحية الاسترداد، للمديرين الجدد في أول ٩٠ يومًا.",
  },
  system: false,
  permissions: ROLE_DEFINITIONS.branch_manager.permissions.filter(
    (p) => p !== "pos.refund.issue" && p !== "pos.discount.approve",
  ),
  defaultScope: "branch",
  userCount: 0,
});

export const roleById = new Map(roles.map((r) => [r.id, r]));
export const roleByKey = new Map(roles.filter((r) => r.system).map((r) => [r.key, r]));

// ---------------------------------------------------------------------------
// Users — SRS §14.1, a User is a credential, not a person in a job
// ---------------------------------------------------------------------------

interface UserSeed {
  roleKey: RoleKey;
  en: string;
  ar: string;
  email: string;
  scope: "tenant" | "brand" | "branch_set" | "branch";
  scopeIds: string[];
  employeeIndex: number | null;
}

const USER_SEEDS: UserSeed[] = [
  { roleKey: "owner", en: "Youssef Rashad", ar: "يوسف رشاد", email: "youssef.rashad@levant.example", scope: "tenant", scopeIds: [], employeeIndex: null },
  { roleKey: "operations_director", en: "Amal Saeed", ar: "أمل سعيد", email: "amal.saeed@levant.example", scope: "brand", scopeIds: [brands[0]!.id], employeeIndex: 1 },
  { roleKey: "brand_manager", en: "Dina Wahba", ar: "دينا وهبة", email: "dina.wahba@levant.example", scope: "brand", scopeIds: [brands[0]!.id], employeeIndex: 2 },
  { roleKey: "branch_manager", en: "Mona Ezzat", ar: "منى عزت", email: "mona.ezzat@levant.example", scope: "branch", scopeIds: [branches[0]!.id], employeeIndex: 3 },
  { roleKey: "shift_supervisor", en: "Rami Kamal", ar: "رامي كمال", email: "rami.kamal@levant.example", scope: "branch", scopeIds: [branches[0]!.id], employeeIndex: 8 },
  { roleKey: "cashier", en: "Salma Fathy", ar: "سلمى فتحي", email: "salma.fathy@levant.example", scope: "branch", scopeIds: [branches[0]!.id], employeeIndex: 9 },
  { roleKey: "waiter", en: "Omar Shafik", ar: "عمر شفيق", email: "omar.shafik@levant.example", scope: "branch", scopeIds: [branches[0]!.id], employeeIndex: 10 },
  { roleKey: "kitchen_staff", en: "Mahmoud Gaber", ar: "محمود جابر", email: "mahmoud.gaber@levant.example", scope: "branch", scopeIds: [branches[0]!.id], employeeIndex: 11 },
  { roleKey: "head_chef", en: "Sameh Naguib", ar: "سامح نجيب", email: "sameh.naguib@levant.example", scope: "branch_set", scopeIds: [branches[0]!.id, branches[1]!.id, branches[2]!.id], employeeIndex: 4 },
  { roleKey: "storekeeper", en: "Tarek Selim", ar: "طارق سليم", email: "tarek.selim@levant.example", scope: "branch", scopeIds: [branches[0]!.id], employeeIndex: 5 },
  { roleKey: "purchasing_officer", en: "Nourhan Fouad", ar: "نورهان فؤاد", email: "nourhan.fouad@levant.example", scope: "tenant", scopeIds: [], employeeIndex: 6 },
  { roleKey: "central_kitchen_manager", en: "Ihab Zaki", ar: "إيهاب زكي", email: "ihab.zaki@levant.example", scope: "branch_set", scopeIds: [branches[0]!.id, branches[1]!.id, branches[2]!.id, branches[3]!.id], employeeIndex: 12 },
  { roleKey: "accountant", en: "Nadia Halim", ar: "نادية حليم", email: "nadia.halim@external.example", scope: "tenant", scopeIds: [], employeeIndex: null },
  { roleKey: "auditor", en: "Bassem Nour", ar: "باسم نور", email: "bassem.nour@audit.example", scope: "tenant", scopeIds: [], employeeIndex: null },
  { roleKey: "hr_officer", en: "Hoda Mansour", ar: "هدى منصور", email: "hoda.mansour@levant.example", scope: "tenant", scopeIds: [], employeeIndex: 7 },
  { roleKey: "franchisee", en: "Layla Al-Otaibi", ar: "ليلى العتيبي", email: "layla.alotaibi@partner.example", scope: "branch_set", scopeIds: [branches[2]!.id, branches[3]!.id], employeeIndex: null },
  { roleKey: "platform_admin", en: "Karim Adel", ar: "كريم عادل", email: "karim.adel@ros.app", scope: "tenant", scopeIds: [], employeeIndex: null },
];

export const users: User[] = USER_SEEDS.map((seed, i) => {
  const requiresMfa = roleRequiresMfa(seed.roleKey);
  return {
    id: seqId("usr", i + 1),
    tenantId: ACTIVE_TENANT_ID,
    name: { en: seed.en, ar: seed.ar },
    email: seed.email,
    phone: `+2010${String(55_000_000 + i * 731_119).slice(0, 8)}`,
    // Every seeded persona is a demo login, so all of them must be able to
    // sign in. The `invited` and `suspended` rows the users table needs come
    // from the rank-and-file block below.
    status: "active",
    mfaEnrolled: requiresMfa || chance(rng, 0.5),
    lastLoginAt: chance(rng, 0.9) ? hoursAgo(int(rng, 1, 400)) : null,
    assignments: [
      {
        roleId: roleByKey.get(seed.roleKey)!.id,
        scopeLevel: seed.scope,
        scopeIds: seed.scopeIds,
        validFrom: null,
        validTo: null,
      },
    ],
    employeeId: seed.employeeIndex === null ? null : employees[seed.employeeIndex]!.id,
    locale: i % 3 === 0 ? "ar" : "en",
  };
});

// A user carrying a temporary elevation — FR-SEC-005.
const covering = users[3];
if (covering) {
  covering.assignments.push({
    roleId: roleByKey.get("operations_director")!.id,
    scopeLevel: "brand",
    scopeIds: [brands[0]!.id],
    validFrom: new Date(NOW_MS - 4 * 86_400_000).toISOString().slice(0, 10),
    validTo: new Date(NOW_MS + 6 * 86_400_000).toISOString().slice(0, 10),
  });
}

// Extra rank-and-file users so the users table is not just the demo personas.
for (let i = USER_SEEDS.length; i < 26; i += 1) {
  const employee = employees[i]!;
  const roleKey: RoleKey = pick(rng, ["branch_manager", "storekeeper", "head_chef"] as const);
  users.push({
    id: seqId("usr", i + 1),
    tenantId: ACTIVE_TENANT_ID,
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    status: chance(rng, 0.9) ? "active" : i % 2 === 0 ? "suspended" : "invited",
    mfaEnrolled: chance(rng, 0.4),
    lastLoginAt: chance(rng, 0.8) ? hoursAgo(int(rng, 2, 900)) : null,
    assignments: [
      {
        roleId: roleByKey.get(roleKey)!.id,
        scopeLevel: "branch",
        scopeIds: [employee.homeBranchId],
        validFrom: null,
        validTo: null,
      },
    ],
    employeeId: employee.id,
    locale: i % 2 === 0 ? "ar" : "en",
  });
}

export const userById = new Map(users.map((u) => [u.id, u]));

// Fill role user counts.
for (const role of roles) {
  role.userCount = users.filter((u) =>
    u.assignments.some((a) => a.roleId === role.id),
  ).length;
}

/** The demo user for a role — the identity the console signs in as. */
export function demoUserForRole(roleKey: RoleKey): User {
  const seedIndex = USER_SEEDS.findIndex((s) => s.roleKey === roleKey);
  return users[seedIndex >= 0 ? seedIndex : 0]!;
}

export function buildSession(roleKey: RoleKey, mfaSatisfied: boolean): Session {
  const user = demoUserForRole(roleKey);
  const definition = ROLE_DEFINITIONS[roleKey];
  const assignment = user.assignments[0]!;

  const brandId =
    definition.defaultScope === "brand" || definition.defaultScope === "branch"
      ? (assignment.scopeIds[0]?.startsWith("brd") ? assignment.scopeIds[0] : null)
      : null;

  const branchId =
    definition.defaultScope === "branch"
      ? (assignment.scopeIds.find((s) => s.startsWith("brn")) ?? branches[0]!.id)
      : null;

  return {
    user,
    roleKey,
    permissions: permissionsForRole(roleKey),
    tenantId: ACTIVE_TENANT_ID,
    brandId,
    branchId,
    mfaSatisfied,
  };
}

// ---------------------------------------------------------------------------
// Segregation of duties — FR-SEC-017
// ---------------------------------------------------------------------------

export const sodConflicts: SodConflict[] = (() => {
  const out: SodConflict[] = [];
  for (const user of users) {
    const held = new Set<PermissionKey>();
    for (const assignment of user.assignments) {
      const role = roleById.get(assignment.roleId);
      role?.permissions.forEach((p) => held.add(p));
    }
    const role = roleById.get(user.assignments[0]!.roleId)!;

    for (const pair of SOD_PAIRS) {
      if (held.has(pair.a) && held.has(pair.b)) {
        out.push({
          userId: user.id,
          userName: user.name,
          roleName: role.name,
          permissionA: pair.a,
          permissionB: pair.b,
          risk: pair.risk,
          blocking: pair.blocking,
        });
      }
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Approval requests — SRS §15.6
// ---------------------------------------------------------------------------

interface ApprovalSeed {
  kind: ApprovalKind;
  entityType: string;
  permission: PermissionKey;
  label: (n: number) => Localised;
  reason: Localised;
  min: number;
  max: number;
}

const APPROVAL_SEEDS: ApprovalSeed[] = [
  {
    kind: "discount", entityType: "order", permission: "pos.discount.approve",
    label: (n) => ({ en: `Order CRK-DTN-${1000 + n}`, ar: `طلب CRK-DTN-${1000 + n}` }),
    reason: { en: "25% discount exceeds the 15% limit for this role.", ar: "خصم ٢٥٪ يتجاوز حد ١٥٪ لهذا الدور." },
    min: 8_000, max: 120_000,
  },
  {
    kind: "refund", entityType: "order", permission: "pos.refund.issue",
    label: (n) => ({ en: `Refund on order CRK-NCR-${2000 + n}`, ar: `استرداد على طلب CRK-NCR-${2000 + n}` }),
    reason: { en: "Refund above the branch threshold.", ar: "استرداد يتجاوز حد الفرع." },
    min: 20_000, max: 340_000,
  },
  {
    kind: "purchase_order", entityType: "purchase_order", permission: "purchase.order.approve_tier_2",
    label: (n) => ({ en: `PO-${9100 + n}`, ar: `أمر شراء ${9100 + n}` }),
    reason: { en: "Value falls in approval tier 2 (Operations Director).", ar: "القيمة ضمن نطاق الاعتماد الثاني (مدير العمليات)." },
    min: 600_000, max: 4_800_000,
  },
  {
    kind: "waste", entityType: "waste_record", permission: "inventory.waste.approve",
    label: (n) => ({ en: `Waste record WST-${400 + n}`, ar: `سجل هدر WST-${400 + n}` }),
    reason: { en: "Waste value exceeds the approval threshold.", ar: "قيمة الهدر تتجاوز حد الاعتماد." },
    min: 40_000, max: 260_000,
  },
  {
    kind: "count_adjustment", entityType: "count_session", permission: "inventory.approve_high_variance",
    label: (n) => ({ en: `Count CNT-${2600 + n}`, ar: `جرد CNT-${2600 + n}` }),
    reason: { en: "Count variance exceeds the 6% posting threshold.", ar: "فرق الجرد يتجاوز حد الترحيل ٦٪." },
    min: 30_000, max: 480_000,
  },
  {
    kind: "expense", entityType: "expense", permission: "finance.expense.approve",
    label: (n) => ({ en: `Expense EXP-${3300 + n}`, ar: `مصروف EXP-${3300 + n}` }),
    reason: { en: "Expense above the branch posting threshold.", ar: "مصروف يتجاوز حد الترحيل بالفرع." },
    min: 500_000, max: 2_400_000,
  },
  {
    kind: "price_change", entityType: "price_list", permission: "menu.price.change",
    label: (n) => ({ en: `Price list change #${n}`, ar: `تغيير قائمة أسعار #${n}` }),
    reason: { en: "Change would move contribution margin below the configured floor.", ar: "التغيير سيخفض هامش المساهمة دون الحد المضبوط." },
    min: 0, max: 60_000,
  },
  {
    kind: "overtime", entityType: "overtime", permission: "hr.overtime.approve",
    label: (n) => ({ en: `Overtime week ${n}`, ar: `عمل إضافي أسبوع ${n}` }),
    reason: { en: "Overtime beyond the pre-approval threshold.", ar: "عمل إضافي يتجاوز حد الاعتماد المسبق." },
    min: 15_000, max: 180_000,
  },
  {
    kind: "stock_adjustment", entityType: "adjustment", permission: "inventory.adjust",
    label: (n) => ({ en: `Adjustment ADJ-${500 + n}`, ar: `تسوية ADJ-${500 + n}` }),
    reason: { en: "Manual adjustment above the value threshold.", ar: "تسوية يدوية تتجاوز حد القيمة." },
    min: 25_000, max: 300_000,
  },
];

const APPROVAL_STATUSES: ApprovalStatus[] = [
  "pending", "pending", "pending", "pending", "approved", "approved", "rejected", "escalated", "expired",
];

export const approvalRequests: ApprovalRequest[] = (() => {
  const out: ApprovalRequest[] = [];
  for (let i = 1; i <= 42; i += 1) {
    const seed = APPROVAL_SEEDS[(i - 1) % APPROVAL_SEEDS.length]!;
    const status = APPROVAL_STATUSES[(i * 5) % APPROVAL_STATUSES.length]!;
    const branch = branches[i % branches.length]!;
    const requester = users[(i * 3) % users.length]!;
    const decided = status === "approved" || status === "rejected";

    out.push({
      id: seqId("apr", i),
      tenantId: ACTIVE_TENANT_ID,
      reference: `APR-${String(8800 + i)}`,
      kind: seed.kind,
      entityType: seed.entityType,
      entityId: seqId(seed.entityType.slice(0, 3), i),
      entityLabel: seed.label(i),
      branchId: branch.id,
      branchName: branch.name,
      value: EGP(int(rng, seed.min, seed.max)),
      requestedBy: requester.id,
      requestedByName: requester.name,
      requestedAt: minutesAgo(int(rng, 8, 60 * 24 * 6)),
      requiredPermission: seed.permission,
      status,
      decidedBy: decided ? pick(rng, [users[0]!.name, users[1]!.name, users[3]!.name]) : null,
      decidedAt: decided ? minutesAgo(int(rng, 2, 60 * 24 * 3)) : null,
      comment: decided && chance(rng, 0.5) ? "Reviewed against the branch policy." : null,
      expiresAt: new Date(NOW_MS + int(rng, 1, 48) * 3_600_000).toISOString(),
      reason: seed.reason,
    });
  }
  return out.sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
  );
})();

export const pendingApprovals = approvalRequests.filter(
  (a) => a.status === "pending" || a.status === "escalated",
);

// ---------------------------------------------------------------------------
// Audit log — SRS §20.1
// ---------------------------------------------------------------------------

const AUDIT_ACTIONS: { action: string; entityType: string }[] = [
  { action: "auth.login.succeeded", entityType: "session" },
  { action: "auth.login.failed", entityType: "session" },
  { action: "order.discount.applied", entityType: "order" },
  { action: "order.line.voided", entityType: "order_line" },
  { action: "order.refund.issued", entityType: "order" },
  { action: "order.completed", entityType: "order" },
  { action: "menu.price.changed", entityType: "price_entry" },
  { action: "recipe.version.published", entityType: "recipe" },
  { action: "inventory.count.posted", entityType: "count_session" },
  { action: "inventory.adjustment.created", entityType: "adjustment" },
  { action: "inventory.waste.recorded", entityType: "waste_record" },
  { action: "purchase.order.approved", entityType: "purchase_order" },
  { action: "purchase.receipt.posted", entityType: "goods_receipt" },
  { action: "cash.session.closed", entityType: "cash_session" },
  { action: "cash.variance.approved", entityType: "cash_session" },
  { action: "finance.day.closed", entityType: "day_close" },
  { action: "security.role.updated", entityType: "role" },
  { action: "security.user.created", entityType: "user" },
  { action: "settings.branch.updated", entityType: "branch" },
  { action: "integration.credentials.rotated", entityType: "integration" },
  { action: "report.exported", entityType: "report" },
  { action: "support.impersonation.started", entityType: "session" },
];

/** A stable pseudo-hash; the real chain is SHA-256 server-side (FR-AUD-004). */
function fakeHash(seed: number): string {
  let h = seed >>> 0;
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    h = (Math.imul(h ^ (h >>> 13), 0x5bd1e995) + 0x9e3779b9) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

export const auditEntries: AuditEntry[] = (() => {
  const out: AuditEntry[] = [];
  let previousHash = fakeHash(1);

  for (let i = 1; i <= 320; i += 1) {
    const spec = AUDIT_ACTIONS[(i * 7) % AUDIT_ACTIONS.length]!;
    const actor = users[(i * 3) % users.length]!;
    const branch = branches[i % branches.length]!;
    const impersonated = spec.action.startsWith("support.") || chance(rng, 0.01);
    const hash = fakeHash(i * 7919);

    const before =
      spec.action === "menu.price.changed"
        ? { price: 12_500 }
        : spec.action === "security.role.updated"
          ? { permissions: 42 }
          : null;
    const after =
      spec.action === "menu.price.changed"
        ? { price: 13_500 }
        : spec.action === "security.role.updated"
          ? { permissions: 44 }
          : null;

    out.push({
      id: seqId("aud", i),
      tenantId: ACTIVE_TENANT_ID,
      branchId: branch.id,
      branchName: branch.name,
      occurredAt: minutesAgo(int(rng, 1, 60 * 24 * 21)),
      recordedAt: minutesAgo(int(rng, 1, 60 * 24 * 21)),
      actorId: actor.id,
      actorName: actor.name,
      actorType: spec.action.startsWith("auth.") ? "user" : chance(rng, 0.9) ? "user" : "system",
      impersonatedBy: impersonated ? { en: "TRENDOW Support · Karim Adel", ar: "دعم TRENDOW · كريم عادل" } : null,
      action: spec.action,
      entityType: spec.entityType,
      entityId: seqId(spec.entityType.slice(0, 3), int(rng, 1, 400)),
      before,
      after,
      reasonCode: chance(rng, 0.3) ? pick(rng, ["service_recovery", "quality_issue", "correction"]) : null,
      reasonText: chance(rng, 0.18) ? "Approved by the duty manager on shift." : null,
      approverName: chance(rng, 0.2) ? users[1]!.name : null,
      ipAddress: `197.${int(rng, 10, 250)}.${int(rng, 1, 250)}.${int(rng, 1, 250)}`,
      terminalId: chance(rng, 0.6) ? seqId("trm", int(rng, 1, 40)) : null,
      correlationId: seqId("cor", i),
      hash,
      previousHash,
    });
    previousHash = hash;
  }

  return out.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
})();

// ---------------------------------------------------------------------------
// Anomaly flags — SRS §13.7
// ---------------------------------------------------------------------------

const ANOMALY_SPECS: {
  kind: AnomalyKind;
  title: Localised;
  evidence: (subject: string, observed: number, baseline: number) => Localised;
}[] = [
  {
    kind: "excessive_voids",
    title: { en: "Void rate above peer baseline", ar: "معدل الإلغاء أعلى من خط الأساس" },
    evidence: (s, o, b) => ({
      en: `${s} recorded ${o} voids this week against a branch baseline of ${b}. 14 of them occurred between 22:00 and 23:00.`,
      ar: `سجّل ${s} ${o} عملية إلغاء هذا الأسبوع مقابل خط أساس للفرع يبلغ ${b}. وقعت ١٤ منها بين ٢٢:٠٠ و٢٣:٠٠.`,
    }),
  },
  {
    kind: "post_payment_void",
    title: { en: "Voids after payment initiation", ar: "إلغاءات بعد بدء الدفع" },
    evidence: (s, o) => ({
      en: `${s} voided ${o} lines after payment had begun. Each void is listed with its order number and timestamp.`,
      ar: `ألغى ${s} ${o} أصناف بعد بدء الدفع. كل عملية إلغاء مدرجة برقم الطلب والتوقيت.`,
    }),
  },
  {
    kind: "cash_variance_pattern",
    title: { en: "Consistent drawer shortage", ar: "عجز متكرر في الدرج" },
    evidence: (s, o, b) => ({
      en: `${s} closed short on ${o} of the last ${b} shifts, averaging −64.20 EGP. No other cashier on this drawer shows the pattern.`,
      ar: `أغلق ${s} بعجز في ${o} من آخر ${b} ورديات بمتوسط −٦٤٫٢٠ جنيه. لا يُظهر أي كاشير آخر على هذا الدرج النمط ذاته.`,
    }),
  },
  {
    kind: "waste_concentration",
    title: { en: "High-value waste concentrated in one shift", ar: "هدر مرتفع القيمة يتركز في وردية واحدة" },
    evidence: (s, o, b) => ({
      en: `${o}% of beef striploin waste this month was recorded on ${s}'s shift, which covers ${b}% of trading hours.`,
      ar: `تم تسجيل ${o}٪ من هدر الستربلوين هذا الشهر خلال وردية ${s}، التي تغطي ${b}٪ من ساعات العمل.`,
    }),
  },
  {
    kind: "discount_concentration",
    title: { en: "Discount concentration by employee", ar: "تركّز الخصومات لدى موظف" },
    evidence: (s, o, b) => ({
      en: `${s} applied ${o} discounts against a peer median of ${b}, all under the same reason code.`,
      ar: `طبّق ${s} ${o} خصمًا مقابل وسيط أقران يبلغ ${b}، جميعها تحت رمز السبب نفسه.`,
    }),
  },
  {
    kind: "no_sale_drawer_opens",
    title: { en: "No-sale drawer opens above baseline", ar: "فتح الدرج بلا بيع فوق خط الأساس" },
    evidence: (s, o, b) => ({
      en: `${s} opened the drawer without a transaction ${o} times per shift against a baseline of ${b}.`,
      ar: `فتح ${s} الدرج دون معاملة ${o} مرة في الوردية مقابل خط أساس ${b}.`,
    }),
  },
  {
    kind: "count_adjustment_pattern",
    title: { en: "Repeated positive count adjustments", ar: "تسويات جرد موجبة متكررة" },
    evidence: (s, o) => ({
      en: `${o} consecutive count sessions posted by ${s} produced positive adjustments on the same three items.`,
      ar: `${o} جلسات جرد متتالية رحّلها ${s} أنتجت تسويات موجبة على الأصناف الثلاثة نفسها.`,
    }),
  },
  {
    kind: "outside_trading_hours",
    title: { en: "Transactions outside trading hours", ar: "معاملات خارج ساعات العمل" },
    evidence: (s, o) => ({
      en: `${o} sales were recorded at ${s} between 03:10 and 03:40, after the configured close.`,
      ar: `سُجّلت ${o} مبيعات في ${s} بين ٠٣:١٠ و٠٣:٤٠، بعد وقت الإغلاق المضبوط.`,
    }),
  },
];

export const anomalyFlags: AnomalyFlag[] = ANOMALY_SPECS.flatMap((spec, si) =>
  Array.from({ length: si < 3 ? 2 : 1 }, (_, k) => {
    const index = si * 2 + k;
    const branch = branches[index % branches.length]!;
    const subject =
      spec.kind === "outside_trading_hours"
        ? branch.name
        : employees[(index * 5) % employees.length]!.name;
    const observed = int(rng, 12, 60);
    const baseline = Math.max(1, Math.round(observed / float(rng, 1.8, 4.2, 1)));
    const sigma = float(rng, 2.1, 5.4, 1);

    return {
      id: seqId("anm", index + 1),
      kind: spec.kind,
      title: spec.title,
      evidence: spec.evidence(subject.en, observed, baseline),
      branchId: branch.id,
      branchName: branch.name,
      subjectName: subject,
      observedValue: observed,
      baselineValue: baseline,
      sigma,
      detectedAt: hoursAgo(int(rng, 2, 24 * 9)),
      severity: sigma > 4 ? "high" : sigma > 3 ? "medium" : "low",
      status: pick(rng, ["open", "open", "reviewing", "dismissed", "confirmed"] as const),
    } satisfies AnomalyFlag;
  }),
);
