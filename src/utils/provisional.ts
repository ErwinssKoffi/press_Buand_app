/**
 * Références provisoires hors ligne (Prompt 09 §10-11) : clairement
 * distinguées du ticket officiel généré par le serveur.
 */

export const PROVISIONAL_TICKET_PREFIX = 'LOCAL-';

/** Ticket provisoire LOCAL-YYMMDD-XXXX (jamais confondu avec EP-YYYY-NNNN). */
export function provisionalTicket(now = new Date()): string {
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${PROVISIONAL_TICKET_PREFIX}${y}${m}${d}-${rand}`;
}

export function isProvisionalTicket(ticket: string | undefined): boolean {
  return Boolean(ticket && ticket.startsWith(PROVISIONAL_TICKET_PREFIX));
}
