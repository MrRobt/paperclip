import { z } from "zod";
import {
  ENVIRONMENT_DRIVERS,
  ENVIRONMENT_LEASE_CLEANUP_STATUSES,
  ENVIRONMENT_LEASE_STATUSES,
  ENVIRONMENT_STATUSES,
} from "../constants.js";

export const environmentDriverSchema = z.enum(ENVIRONMENT_DRIVERS);
export const environmentStatusSchema = z.enum(ENVIRONMENT_STATUSES);
export const environmentLeaseStatusSchema = z.enum(ENVIRONMENT_LEASE_STATUSES);
export const environmentLeaseCleanupStatusSchema = z.enum(ENVIRONMENT_LEASE_CLEANUP_STATUSES);

/** Interchangeable workers share this. Kept short and boring so it reads well in a URL or log. */
export const environmentPoolKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Pool key must be lowercase alphanumeric with . _ or -");

const environmentFields = {
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  driver: environmentDriverSchema,
  status: environmentStatusSchema.optional().default("active"),
  poolKey: environmentPoolKeySchema.optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
};

export const createEnvironmentSchema = z.object(environmentFields).strict();
export type CreateEnvironment = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  driver: environmentDriverSchema.optional(),
  status: environmentStatusSchema.optional(),
  poolKey: environmentPoolKeySchema.optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
}).strict();
export type UpdateEnvironment = z.infer<typeof updateEnvironmentSchema>;

export const probeEnvironmentConfigSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  driver: environmentDriverSchema,
  config: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
}).strict();
export type ProbeEnvironmentConfig = z.infer<typeof probeEnvironmentConfigSchema>;
