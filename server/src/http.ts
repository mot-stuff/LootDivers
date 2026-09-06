/**
 * Tiny HTTP helpers shared by the route modules (app.ts and the TASK-720
 * admin routes): the §2 contract error envelope and the UUID shape used to
 * pre-filter path parameters before they reach Postgres casts.
 */
import type { FastifyReply } from "fastify";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contract error shape: `{ error: { code, message } }` with a 4xx/5xx status. */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.status(status).send({ error: { code, message } });
}
