/**
 * Abstracción de proveedor de pago. La plataforma no conoce los detalles de
 * ningún PSP concreto: programa contra esta interfaz. Para producción basta con
 * implementar `PaymentProvider` para Stripe/Adyen/etc. y registrarlo en el factory.
 */
export interface PaymentRequest {
  intentId: string;
  userId: string;
  amount: number; // minor units
  currency: string;
}

export interface PaymentResult {
  providerRef: string;
  status: 'pending' | 'completed' | 'failed';
  /** URL de redirección a checkout (proveedores que lo requieran). */
  redirectUrl?: string;
}

export interface WebhookEvent {
  providerRef: string;
  status: 'completed' | 'failed';
}

export interface PaymentProvider {
  readonly name: string;
  createDeposit(req: PaymentRequest): PaymentResult;
  createPayout(req: PaymentRequest): PaymentResult;
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean;
  parseWebhook(payload: unknown): WebhookEvent;
}

/**
 * Abstracción de proveedor KYC/AML. Igual que pagos: implementar para
 * Onfido/Jumio/SumSub y registrar. Aquí sólo se exige la verificación.
 */
export interface KycSubmission {
  userId: string;
  documentType: string;
  documentNumber: string;
  fullNameOnDocument: string;
  expectedName: string;
}

export interface KycResult {
  reference: string;
  status: 'pending' | 'verified' | 'rejected';
}

export interface KycProvider {
  readonly name: string;
  submit(submission: KycSubmission): KycResult;
}
