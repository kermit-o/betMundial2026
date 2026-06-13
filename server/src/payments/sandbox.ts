import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import type {
  KycProvider,
  KycResult,
  KycSubmission,
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  WebhookEvent,
} from './provider.js';

const SANDBOX_WEBHOOK_SECRET = process.env.PAYMENTS_WEBHOOK_SECRET ?? 'sandbox-webhook-secret';

/**
 * Proveedor de pago de pruebas: confirma las operaciones de forma inmediata.
 * Replica el contrato de un PSP real (referencias, webhooks firmados) para que
 * el resto del sistema no cambie al enchufar un proveedor de producción.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';

  async createDeposit(_req: PaymentRequest): Promise<PaymentResult> {
    return { providerRef: `pi_${nanoid(12)}`, status: 'completed' };
  }

  async createPayout(_req: PaymentRequest): Promise<PaymentResult> {
    return { providerRef: `po_${nanoid(12)}`, status: 'completed' };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', SANDBOX_WEBHOOK_SECRET).update(rawBody).digest('hex');
    // Comparación en tiempo constante.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): WebhookEvent {
    const p = payload as { providerRef?: string; status?: string };
    return { providerRef: String(p.providerRef), status: p.status === 'failed' ? 'failed' : 'completed' };
  }

  /** Utilidad para firmar payloads de webhook en pruebas/integración. */
  static sign(rawBody: string): string {
    return crypto.createHmac('sha256', SANDBOX_WEBHOOK_SECRET).update(rawBody).digest('hex');
  }
}

/**
 * Proveedor KYC de pruebas: aprueba si el nombre del documento coincide con el
 * de la cuenta y el número de documento es plausible. Sustituible por un
 * proveedor real que devuelva 'pending' y confirme luego por webhook.
 */
export class SandboxKycProvider implements KycProvider {
  readonly name = 'sandbox';

  submit(s: KycSubmission): KycResult {
    const nameMatches = s.fullNameOnDocument.trim().toLowerCase() === s.expectedName.trim().toLowerCase();
    const validDoc = s.documentNumber.replace(/\s/g, '').length >= 5;
    return {
      reference: `kyc_${nanoid(12)}`,
      status: nameMatches && validDoc ? 'verified' : 'rejected',
    };
  }
}
