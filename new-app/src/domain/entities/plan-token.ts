import crypto from 'node:crypto';

export interface PlanSnapshotItem {
  personKey: string;
  personName: string;
  assignedTo: string;
  targetIsoDate: string;
  title: string;
  sourceTaskId?: number;
  originalEstimate?: number;
  activity?: string;
  description?: string;
}

export interface PlanSnapshot {
  todayIso: string;
  nextThursdayIso: string;
  createdAt: string;
  totalPlanned: number;
  personCount: number;
  items: PlanSnapshotItem[];
}

export function getPlanSigningSecret(): string {
  return (
    process.env.PLAN_SIGNING_SECRET ||
    'workops-production-plan-signing-secret-32-chars-long-key!'
  );
}

export function computePlanHash(snapshot: any): string {
  const json = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  return crypto.createHash('sha256').update(json).digest('hex');
}

export interface GeneratedPlanToken {
  planToken: string;
  tokenHash: string;
  planHash: string;
  expiresAt: number;
}

export function generatePlanToken(
  snapshot: any,
  ttlMs = 10 * 60 * 1000,
  secret = getPlanSigningSecret()
): GeneratedPlanToken {
  const planHash = computePlanHash(snapshot);
  const expiresAt = Date.now() + ttlMs;
  const payloadToSign = `${planHash}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');
  const planToken = `pln_${planHash}.${expiresAt}.${signature}`;
  const tokenHash = crypto.createHash('sha256').update(planToken).digest('hex');

  return {
    planToken,
    tokenHash,
    planHash,
    expiresAt,
  };
}

export interface VerifyPlanTokenResult {
  valid: boolean;
  planHash?: string;
  expiresAt?: number;
  tokenHash?: string;
  error?: 'PLAN_TAMPERED' | 'PLAN_EXPIRED' | 'INVALID_FORMAT';
}

export function verifyPlanToken(
  planToken: string,
  secret = getPlanSigningSecret(),
  now = Date.now()
): VerifyPlanTokenResult {
  if (!planToken || typeof planToken !== 'string') {
    return { valid: false, error: 'INVALID_FORMAT' };
  }

  const raw = planToken.startsWith('pln_') ? planToken.slice(4) : planToken;
  const parts = raw.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'INVALID_FORMAT' };
  }

  const [planHash, expiresAtStr, signature] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) {
    return { valid: false, error: 'INVALID_FORMAT' };
  }

  const payloadToSign = `${planHash}:${expiresAt}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');

  // Constant-time comparison for timing attack defense
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSig, 'hex');
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, error: 'PLAN_TAMPERED' };
  }

  const tokenHash = crypto.createHash('sha256').update(planToken).digest('hex');

  if (now > expiresAt) {
    return { valid: false, error: 'PLAN_EXPIRED', expiresAt, planHash, tokenHash };
  }

  return { valid: true, planHash, expiresAt, tokenHash };
}
