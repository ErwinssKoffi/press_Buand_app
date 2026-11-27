/**
 * Rendu des photos de réserves (Prompt 08 §11 — stratégie privée du backend).
 * Les photos fraîchement capturées restent des data URLs locales ; celles
 * migrées/restées côté serveur n'exposent que `url` (endpoint authentifié
 * /api/v1/orders/{id}/photos/{photoId} — cookie de session requis).
 */
import type { IntakePhoto } from '../types/pressing';

/** Préfixe les URL relatives avec la base API configurée (cross-origin). */
export function apiUrl(path: string): string {
  const base = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '';
  return path.startsWith('http') ? path : `${base}${path}`;
}

export function photoSrc(ph: Pick<IntakePhoto, 'dataUrl' | 'url'> | undefined): string {
  if (!ph) return '';
  if (ph.dataUrl) return ph.dataUrl;
  if (ph.url) return apiUrl(ph.url);
  return '';
}
