import React, { useState } from 'react';
import { Download, Laptop, Monitor, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, os, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Installer l'application sur Mac ou Windows"
      >
        <Download className="h-3.5 w-3.5 text-teal-700" />
        <span>{isInstallable ? "Installer l'app" : 'Installer Mac / PC'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 id="pwa-install-title" className="text-lg font-semibold text-slate-900">
                  Installer Éclat Pressing sur votre ordinateur
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Fonctionne hors connexion internet avec votre base de données locale.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm text-slate-700">
              {isInstallable && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
                  <p className="font-medium text-teal-900">
                    Installation directe disponible sur ce navigateur
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await install();
                      setShowGuide(false);
                    }}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Lancer l&apos;installation maintenant
                  </button>
                </div>
              )}

              <div className={`rounded-lg border p-4 ${os === 'windows' ? 'border-teal-300 bg-slate-50' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Monitor className="h-4 w-4 text-slate-600" />
                  <span>Windows (Chrome ou Microsoft Edge)</span>
                </div>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600">
                  <li>Ouvrez cette page dans Chrome ou Edge (hors fenêtre intégrée si vous êtes en aperçu).</li>
                  <li>Cliquez sur l&apos;icône <strong>Installer</strong> dans la barre d&apos;adresse en haut à droite (ou menu ⋮ → <em>Installer Éclat Pressing</em>).</li>
                  <li>L&apos;application s&apos;ouvre dans sa propre fenêtre et reste accessible sur le Bureau / Menu Démarrer sans connexion.</li>
                </ol>
              </div>

              <div className={`rounded-lg border p-4 ${os === 'mac' ? 'border-teal-300 bg-slate-50' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Laptop className="h-4 w-4 text-slate-600" />
                  <span>macOS (Safari ou Google Chrome)</span>
                </div>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600">
                  <li><strong>Sur Safari :</strong> Cliquez sur <em>Fichier</em> dans la barre de menu en haut → <em>Ajouter au Dock…</em></li>
                  <li><strong>Sur Chrome Mac :</strong> Cliquez sur l&apos;icône d&apos;installation dans la barre d&apos;adresse → <em>Installer</em>.</li>
                  <li>Lancez l&apos;application directement depuis le Dock ou Spotlight, même sans internet.</li>
                </ol>
              </div>

              {os === 'ios' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">iPhone / iPad (Safari)</p>
                  <p className="mt-1 text-slate-600">
                    Appuyez sur le bouton <strong>Partager</strong> puis sur <strong>Sur l&apos;écran d&apos;accueil</strong>.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
