/**
 * E2E navigateur — parcours 15 de l'acceptance (offline → sync → interruption).
 *
 * Exécution : serveurs démarrés (backend :8080 + Vite :3000) puis
 *   E2E_BASE_URL=http://127.0.0.1:3000 bun test tests/e2e/
 * Sans E2E_BASE_URL, la suite est ignorée (les tests unitaires/intégration
 * couvrent la logique ; ici on pilote un vrai Chromium headless).
 *
 * Le binaire chromium + ses librairies proviennent du paquet npm
 * @sparticuz/chromium (aucun téléchargement hors registre requis).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { brotliDecompressSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { chromium as playwright } from 'playwright-core';
import chromiumPkg from '@sparticuz/chromium';

const BASE = process.env.E2E_BASE_URL ?? '';
const PIN = process.env.E2E_PIN ?? '12345';
const PHONE = `07${String(Date.now() % 100000000).padStart(8, '0')}`;
const NAME = `Cliente E2E ${PHONE.slice(-4)}`;

let browser: Browser | null = null;
let page: Page | null = null;

function prepareChromium(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclat-e2e-'));
  const bin = path.join(path.dirname(require.resolve('@sparticuz/chromium/package.json')), 'bin');
  fs.writeFileSync(path.join(dir, 'al2023.tar'), brotliDecompressSync(fs.readFileSync(path.join(bin, 'al2023.tar.br'))));
  execSync(`tar -xf ${path.join(dir, 'al2023.tar')} -C ${dir}`);
  // librairies NSS/expat du paquet + chromium/swiftshader extraits par le paquet lui-même
  process.env.LD_LIBRARY_PATH = `${path.join(dir, 'lib')}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`;
  return execSync(`${process.execPath} -e "import('@sparticuz/chromium').then(async (m) => console.log(await m.default.executablePath()))"`)
    .toString()
    .trim();
}

async function login(p: Page): Promise<void> {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  // course : session active (cookie) → tableau de bord, sinon formulaire de login
  await Promise.any([
    p.getByRole('button', { name: 'Tableau de bord' }).waitFor({ timeout: 20000 }).catch(() => 'timeout'),
    p.locator('input[type=password]').first().waitFor({ timeout: 20000 }).catch(() => 'timeout'),
  ]);
  if (await p.getByRole('button', { name: 'Tableau de bord' }).isVisible().catch(() => false)) return;
  await p.locator('input[type=password]').first().click();
  await p.keyboard.type(PIN, { delay: 120 });
  await p.getByRole('button', { name: "Déverrouiller l'application" }).click();
  await p.getByRole('button', { name: 'Tableau de bord' }).waitFor({ timeout: 15000 });
}

describe.skipIf(!BASE)('E2E navigateur — mode hors ligne', () => {
  beforeAll(async () => {
    const exe = prepareChromium();
    browser = await playwright.launch({ executablePath: exe, args: chromiumPkg.args, headless: true });
    page = await browser.newPage();
    await login(page);
  }, 60000);

  afterAll(async () => {
    await browser?.close();
  });

  test('création client hors ligne → en attente → synchro → client présent côté serveur', async () => {
    expect(page).toBeTruthy();

    // 1. coupure réseau : toutes les requêtes /api/v1 échouent (comme une vraie panne)
    await page!.route('**/api/v1/**', (route) => route.abort('connectionrefused'));

    // 2. navigation + création d'un client via l'UI
    await page!.getByRole('button', { name: 'Clients', exact: true }).click();
    await page!.getByRole('button', { name: 'Ajouter un client' }).click();
    const nameLabel = page!.getByText('Nom complet', { exact: true }).first();
    await nameLabel.waitFor({ timeout: 10000 });
    await page!.locator('xpath=//label[contains(., "Nom complet")]/following::input[1]').fill(NAME);
    await page!.locator('xpath=//label[contains(., "Téléphone")]/following::input[1]').fill(PHONE);
    await page!.getByRole('button', { name: 'Enregistrer' }).click();

    // 3. l'opération part dans l'outbox : bannière de synchro avec compteur
    await page!.getByText(/1 opération\(s\) en attente/).waitFor({ timeout: 15000 });

    // 4. le client est visible depuis le cache local (pas de confirmation mensongère)
    await page!.locator('input[placeholder*="Rechercher"]').fill(NAME);
    await page!.getByText(NAME).first().waitFor({ timeout: 10000 });

    // 5. retour du réseau → sync manuelle → la file se vide
    await page!.unroute('**/api/v1/**');
    await page!.getByRole('button', { name: 'Synchroniser' }).click();
    await page!.getByText(/opération\(s\) en attente/).waitFor({ state: 'detached', timeout: 30000 });

    // 6. preuve serveur : le client existe côté Go (mêmes services que en ligne) —
    // la fin de la bannière précède la fin du POST, on sonde jusqu'à 5 s
    let found: { fullName?: string; phone?: string } | undefined;
    for (let i = 0; i < 10 && !found; i++) {
      await page!.waitForTimeout(500);
      const server = await page!.evaluate(async (name) => {
        const res = await fetch(`/api/v1/clients?q=${encodeURIComponent(name)}`, { credentials: 'include' });
        if (!res.ok) return { error: res.status };
        const body = (await res.json()) as { items?: Array<{ fullName?: string; phone?: string }> };
        return { items: body.items };
      }, NAME);
      expect((server as { error?: number }).error).toBeUndefined();
      const items = (server as { items?: Array<{ fullName?: string; phone?: string }> }).items ?? [];
      found = items.find((c) => c.phone === PHONE);
    }
    expect(found?.fullName).toBe(NAME);
  }, 60000);

  test('fermeture du navigateur pendant l’attente : l’outbox persiste et se synchronise à la reprise', async () => {
    // état propre : reload (la session cookie est conservée)
    await page!.reload({ waitUntil: 'networkidle' });
    await login(page!);

    // 1. nouvelle coupure + second client (retour sur la vue Clients)
    await page!.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
    await page!.getByRole('button', { name: 'Clients', exact: true }).click();
    const phone2 = `05${String(Date.now() % 100000000).padStart(8, '0')}`;
    const name2 = `Client E2E Reload ${phone2.slice(-4)}`;
    await page!.getByRole('button', { name: 'Ajouter un client' }).click();
    await page!.getByText('Nom complet', { exact: true }).first().waitFor({ timeout: 10000 });
    await page!.locator('xpath=//label[contains(., "Nom complet")]/following::input[1]').fill(name2);
    await page!.locator('xpath=//label[contains(., "Téléphone")]/following::input[1]').fill(phone2);
    await page!.getByRole('button', { name: 'Enregistrer' }).click();
    await page!.getByText(/1 opération\(s\) en attente/).waitFor({ timeout: 15000 });

    // 2. « fermeture » : reload complet — l'IndexedDB (outbox v4) doit survivre
    await page!.reload({ waitUntil: 'networkidle' });
    await login(page!);

    // 3. à la reprise, la bannière ré-affiche l'opération en attente (persistée avant envoi)
    await page!.getByText(/opération\(s\) en attente/).waitFor({ timeout: 20000 });

    // 4. sync → file vide → client présent côté serveur (aucune perte, aucun doublon)
    await page!.unroute('**/api/v1/**');
    await page!.getByRole('button', { name: 'Synchroniser' }).click();
    await page!.getByText(/opération\(s\) en attente/).waitFor({ state: 'detached', timeout: 30000 });
    let synced: Array<{ phone?: string }> = [];
    for (let i = 0; i < 10 && synced.length === 0; i++) {
      await page!.waitForTimeout(500);
      const server = await page!.evaluate(async (name) => {
        const res = await fetch(`/api/v1/clients?q=${encodeURIComponent(name)}`, { credentials: 'include' });
        if (!res.ok) return { error: res.status };
        return { items: (await res.json() as { items?: Array<{ phone?: string }> }).items };
      }, name2);
      expect((server as { error?: number }).error).toBeUndefined();
      synced = ((server as { items?: Array<{ phone?: string }> }).items ?? []).filter((c) => c.phone === phone2);
    }
    expect(synced).toHaveLength(1);
  }, 60000);
});
