import { config } from '../config.js';
import type { KycProvider, PaymentProvider } from './provider.js';
import { SandboxKycProvider, SandboxPaymentProvider } from './sandbox.js';
import { StripePaymentProvider } from './stripe.js';

/**
 * Factory de proveedores. Selecciona la implementación según variables de
 * entorno. Para añadir un proveedor real basta con registrarlo aquí; el resto
 * del código no cambia.
 */
const paymentProviders: Record<string, () => PaymentProvider> = {
  sandbox: () => new SandboxPaymentProvider(),
  stripe: () =>
    new StripePaymentProvider({
      secretKey: config.stripeSecretKey,
      webhookSecret: config.stripeWebhookSecret,
      successUrl: config.stripeSuccessUrl,
      cancelUrl: config.stripeCancelUrl,
    }),
};

const kycProviders: Record<string, () => KycProvider> = {
  sandbox: () => new SandboxKycProvider(),
  // onfido: () => new OnfidoKycProvider(...),
};

let paymentInstance: PaymentProvider | null = null;
let kycInstance: KycProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!paymentInstance) {
    const name = config.paymentProvider;
    const factory = paymentProviders[name];
    if (!factory) throw new Error(`Proveedor de pago desconocido: ${name}`);
    paymentInstance = factory();
  }
  return paymentInstance;
}

export function getKycProvider(): KycProvider {
  if (!kycInstance) {
    const name = process.env.KYC_PROVIDER ?? 'sandbox';
    const factory = kycProviders[name];
    if (!factory) throw new Error(`Proveedor KYC desconocido: ${name}`);
    kycInstance = factory();
  }
  return kycInstance;
}

export * from './provider.js';
export { SandboxPaymentProvider, SandboxKycProvider } from './sandbox.js';
