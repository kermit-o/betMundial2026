import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  WebhookEvent,
} from './provider.js';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** URL a la que Stripe redirige tras un pago correcto. */
  successUrl: string;
  /** URL a la que Stripe redirige si el usuario cancela. */
  cancelUrl: string;
}

/**
 * Proveedor de pago con Stripe (modo test o producción según las claves).
 *
 * - Depósitos: crea una Checkout Session y devuelve `redirectUrl`. El abono a la
 *   cartera se confirma de forma asíncrona vía webhook `checkout.session.completed`.
 * - Retiros: Stripe no permite enviar dinero a usuarios sin Stripe Connect /
 *   Treasury. Aquí el retiro se registra como `pending` para procesarlo fuera de
 *   banda (o integrar Connect más adelante).
 * - Webhooks: la firma se verifica con `constructEvent` (secreto de firma).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;

  constructor(private readonly cfg: StripeConfig) {
    if (!cfg.secretKey) throw new Error('STRIPE_SECRET_KEY es obligatorio para el proveedor stripe.');
    if (!cfg.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET es obligatorio para el proveedor stripe.');
    if (!cfg.successUrl || !cfg.cancelUrl) {
      throw new Error('STRIPE_SUCCESS_URL y STRIPE_CANCEL_URL son obligatorios para el proveedor stripe.');
    }
    this.stripe = new Stripe(cfg.secretKey);
  }

  async createDeposit(req: PaymentRequest): Promise<PaymentResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: req.intentId,
      metadata: { intentId: req.intentId, userId: req.userId, kind: 'deposit' },
      line_items: [
        {
          quantity: 1,
          price_data: {
            // Stripe usa minor units (céntimos), igual que la plataforma.
            currency: req.currency.toLowerCase(),
            unit_amount: req.amount,
            product_data: { name: 'Depósito BetMundial2026' },
          },
        },
      ],
      success_url: this.cfg.successUrl,
      cancel_url: this.cfg.cancelUrl,
    });
    return {
      providerRef: session.id,
      status: 'pending',
      redirectUrl: session.url ?? undefined,
    };
  }

  async createPayout(_req: PaymentRequest): Promise<PaymentResult> {
    // Disbursement real requiere Stripe Connect/Treasury; se deja pendiente.
    return { providerRef: `po_${nanoid(16)}`, status: 'pending' };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    try {
      this.stripe.webhooks.constructEvent(rawBody, signature, this.cfg.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parseWebhook(payload: unknown): WebhookEvent {
    const event = payload as { type?: string; data?: { object?: Record<string, unknown> } };
    const obj = event.data?.object ?? {};
    const ref = String(obj.id ?? '');
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return { providerRef: ref, status: 'completed' };
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { providerRef: ref, status: 'failed' };
      default:
        // Evento no relevante: providerRef vacío no casa con ningún intent.
        return { providerRef: '', status: 'completed' };
    }
  }
}
