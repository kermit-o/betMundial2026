import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentProvider } from '../src/payments/stripe.js';

const cfg = {
  secretKey: 'sk_test_dummy',
  webhookSecret: 'whsec_test_secret',
  successUrl: 'https://example.com/ok',
  cancelUrl: 'https://example.com/cancel',
};

describe('StripePaymentProvider', () => {
  const provider = new StripePaymentProvider(cfg);
  const stripe = new Stripe(cfg.secretKey);

  it('verifica una firma de webhook válida y rechaza las inválidas', () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123' } },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: cfg.webhookSecret });

    expect(provider.verifyWebhookSignature(payload, header)).toBe(true);
    expect(provider.verifyWebhookSignature(payload, 'firma-invalida')).toBe(false);
    expect(provider.verifyWebhookSignature(payload, undefined)).toBe(false);
    // Cuerpo manipulado con la misma cabecera => firma inválida.
    expect(provider.verifyWebhookSignature(payload + ' ', header)).toBe(false);
  });

  it('mapea los eventos de checkout a estados de pago', () => {
    expect(
      provider.parseWebhook({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }),
    ).toEqual({ providerRef: 'cs_1', status: 'completed' });

    expect(
      provider.parseWebhook({ type: 'checkout.session.expired', data: { object: { id: 'cs_2' } } }),
    ).toEqual({ providerRef: 'cs_2', status: 'failed' });

    // Evento no relevante: providerRef vacío para que no case con ningún intent.
    expect(
      provider.parseWebhook({ type: 'payment_intent.created', data: { object: { id: 'pi_x' } } }),
    ).toEqual({ providerRef: '', status: 'completed' });
  });

  it('exige las credenciales obligatorias al construirse', () => {
    expect(() => new StripePaymentProvider({ ...cfg, secretKey: '' })).toThrow();
    expect(() => new StripePaymentProvider({ ...cfg, webhookSecret: '' })).toThrow();
    expect(() => new StripePaymentProvider({ ...cfg, successUrl: '' })).toThrow();
  });
});
