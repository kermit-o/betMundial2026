import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(128),
  fullName: z.string().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD).'),
  jurisdiction: z.string().length(2),
  acceptTerms: z.boolean(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().min(6).max(8).optional(),
});

export const amountSchema = z.object({
  // Importe en minor units (entero, céntimos).
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const legSchema = z.object({
  selectionId: z.string().min(1),
  expectedOdds: z.number().positive(),
});

export const placeBetSchema = z.object({
  legs: z.array(legSchema).min(1).max(12),
  stake: z.number().int().positive(),
});

export const kycSchema = z.object({
  documentType: z.enum(['passport', 'national_id', 'driver_license']),
  documentNumber: z.string().min(5).max(64),
  fullNameOnDocument: z.string().min(2).max(120),
});

export const depositLimitSchema = z.object({ amount: z.number().int().nonnegative() });
export const lossLimitSchema = z.object({ amount: z.number().int().nonnegative().nullable() });
export const selfExcludeSchema = z.object({ days: z.number().int().min(1).max(3650) });

export const settleSchema = z.object({
  homeScore: z.number().int().min(0).max(50),
  awayScore: z.number().int().min(0).max(50),
});

// --- Seguridad de cuenta ---
export const forgotPasswordSchema = z.object({ email: z.string().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10), newPassword: z.string().min(8).max(128) });
export const verifyEmailSchema = z.object({ token: z.string().min(10) });
export const mfaEnableSchema = z.object({ code: z.string().min(6).max(8) });
export const mfaDisableSchema = z.object({ code: z.string().min(6).max(8) });

// --- Admin ---
export const marketStatusSchema = z.object({ status: z.enum(['open', 'suspended']) });
export const forceKycSchema = z.object({ status: z.enum(['verified', 'rejected', 'pending']) });
