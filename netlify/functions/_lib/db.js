import { neon } from '@neondatabase/serverless';

// neon() uses HTTP, so there is no pool to leak across serverless invocations.
// Still point DATABASE_URL at the POOLED Neon endpoint for safety.
export const sql = neon(process.env.DATABASE_URL);
