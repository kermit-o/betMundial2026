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
});

export const amountSchema = z.object({
  // Importe en minor units (entero, céntimos).
  amount: z.number().int().positive(),
});

export const placeBetSchema = z.object({
  selectionId: z.string().min(1),
  stake: z.number().int().positive(),
  expectedOdds: z.number().positive(),
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
