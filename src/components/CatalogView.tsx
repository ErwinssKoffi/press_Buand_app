import React, { useMemo, useRef, useState } from 'react';
import { Copy, ImagePlus, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { CatalogItem, GarmentCategory, ServiceMode } from '../types/pressing';
import { formatFCFA, SERVICE_MODE_LABELS } from '../utils/formatters';
import { CATALOG_IMAGE_PRESETS, resolveCatalogItemImage } from '../utils/catalogImages';
import { processImportedCatalogImage } from '../utils/imageImport';
import { GarmentThumbnail } from './GarmentThumbnail';

interface CatalogViewProps {
  catalog: CatalogItem[];
  onSaveItem: (item: CatalogItem) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
}

const GARMENT_CATEGORIES: GarmentCategory[] = [
  'Tenues traditionnelles',
  'Costumes & Bureau',
  'Quotidien',
  'Maison & Linge',
];

export const CatalogView: React.FC<CatalogViewProps> = ({
  catalog,
  onSaveItem,
  onDeleteItem,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'Tout' | GarmentCategory>('Tout');
  const [statusFilter, setStatusFilter] = useState<'tous' | 'actifs' | 'masques'>('tous');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((item) => {
      if (categoryFilter !== 'Tout' && item.category !== categoryFilter) return false;
      if (statusFilter === 'actifs' && !item.active) return false;
      if (statusFilter === 'masques' && item.active) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.careNote || '').toLowerCase().includes(q)
      );
    });
  }, [catalog, search, categoryFilter, statusFilter]);

  const openNew = () => {
    setIsNew(true);
    setUploadError('');
    setEditing({
      id: `cat-${Date.now()}`,
      name: '',
      category: 'Costumes & Bureau',
      defaultMode: 'nettoyage_sec',
      priceFCFA: 1500,
      unit: 'pièce',
      active: true,
      turnaroundDays: 2,
      careNote: '',
    });
  };

  const handleDuplicate = (item: CatalogItem) => {
    setIsNew(true);
    setUploadError('');
    setEditing({
      ...item,
      id: `cat-${Date.now()}`,
      name: `${item.name} (Variante)`,
    });
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setUploadError('');
    setUploading(true);
    try {
      const dataUrl = await processImportedCatalogImage(file);
      setEditing({ ...editing, imageUrl: dataUrl });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Erreur lors de l'importation de l'image."
      );
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    await onSaveItem({
      ...editing,
      name: editing.name.trim(),
      priceFCFA: Math.max(0, Math.round(editing.priceFCFA)),
      turnaroundDays: Math.max(1, Math.round(editing.turnaroundDays || 2)),
      careNote: editing.careNote?.trim() || undefined,
      imageUrl: resolveCatalogItemImage(editing),
    });
    setEditing(null);
  };

  const handleQuickPriceStep = async (item: CatalogItem, delta: number) => {
    const nextPrice = Math.max(0, item.priceFCFA + delta);
    await onSaveItem({ ...item, priceFCFA: nextPrice });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white">
        {/* Header & Primary Action */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Grille tarifaire & Catalogue visuel (FCFA)
            </h2>
            <p className="text-xs text-slate-500">
              {catalog.filter((c) => c.active).length} prestations actives sur {catalog.length} ·
              Importez vos propres photos de tenues et configurez les consignes atelier
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Ajouter un article</span>
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['Tout', ...GARMENT_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'tous' | 'actifs' | 'masques')}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
            >
              <option value="tous">Tous les états</option>
              <option value="actifs">Actifs uniquement</option>
              <option value="masques">Masqués uniquement</option>
            </select>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un article, consigne..."
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {filteredCatalog.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Aucun article du catalogue ne correspond à votre recherche.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-3 px-4 font-medium">Article / Consigne atelier</th>
                  <th className="py-3 px-3 font-medium">Catégorie</th>
                  <th className="py-3 px-3 font-medium">Traitement & Délai</th>
                  <th className="py-3 px-3 font-medium text-right">Tarif (FCFA)</th>
                  <th className="py-3 px-3 font-medium">État</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCatalog.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      <div className="flex items-center gap-3">
                        <GarmentThumbnail
                          src={resolveCatalogItemImage(item)}
                          alt={item.name}
                          sizeClass="h-11 w-11"
                        />
                        <div>
                          <div>
                            <span>{item.name}</span>
                            <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                              /{item.unit}
                            </span>
                          </div>
                          {item.careNote && (
                            <div className="text-[11px] font-normal text-amber-800 mt-0.5">
                              {item.careNote}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{item.category}</td>
                    <td className="py-3 px-3 text-slate-600">
                      <div>{SERVICE_MODE_LABELS[item.defaultMode]}</div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        Délai std : {item.turnaroundDays || 2} j
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleQuickPriceStep(item, -100)}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 cursor-pointer"
                          title="Diminuer de 100 FCFA"
                        >
                          -
                        </button>
                        <span className="min-w-[82px] text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {formatFCFA(item.priceFCFA)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuickPriceStep(item, 100)}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 cursor-pointer"
                          title="Augmenter de 100 FCFA"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        onClick={() => onSaveItem({ ...item, active: !item.active })}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                          item.active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-slate-100 text-slate-500'
                        }`}
                      >
                        {item.active ? 'Actif' : 'Masqué'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsNew(false);
                            setUploadError('');
                            setEditing(item);
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(item)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                          title="Dupliquer cet article"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {confirmDeleteId === item.id ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteItem(item.id);
                              setConfirmDeleteId(null);
                            }}
                            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 cursor-pointer"
                          >
                            Confirmer
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                            title="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal with Image Import */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {isNew ? 'Nouvel article tarifaire' : 'Configurer l’article'}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-4">
              {/* Custom Image Upload + Live Preview */}
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <GarmentThumbnail
                  src={resolveCatalogItemImage(editing)}
                  alt={editing.name || 'Aperçu'}
                  sizeClass="h-20 w-20"
                />
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-semibold text-slate-900">
                    Photo de l&apos;article (stockée en local)
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Importez une photo depuis votre Mac/PC (JPG, PNG, WebP) ou choisissez un
                    visuel studio ci-dessous.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{uploading ? 'Traitement...' : 'Importer une image'}</span>
                    </button>
                    {editing.imageUrl && editing.imageUrl.startsWith('data:image') && (
                      <button
                        type="button"
                        onClick={() => setEditing({ ...editing, imageUrl: undefined })}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        <ImagePlus className="h-3 w-3" />
                        <span>Réinitialiser auto</span>
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/*"
                      onChange={handleImageFileChange}
                      className="hidden"
                    />
                  </div>
                  {uploadError && (
                    <p className="text-[11px] font-medium text-red-700">{uploadError}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Désignation de l&apos;article
                </label>
                <input
                  type="text"
                  required
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Ex: Grand Boubou Bazin 3 pièces"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({ ...editing, category: e.target.value as GarmentCategory })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {GARMENT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Traitement par défaut
                  </label>
                  <select
                    value={editing.defaultMode}
                    onChange={(e) =>
                      setEditing({ ...editing, defaultMode: e.target.value as ServiceMode })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {Object.entries(SERVICE_MODE_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Prix unitaire (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    required
                    value={editing.priceFCFA}
                    onChange={(e) =>
                      setEditing({ ...editing, priceFCFA: Number(e.target.value) || 0 })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Unité
                  </label>
                  <select
                    value={editing.unit}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        unit: e.target.value as 'pièce' | 'kg' | 'paire',
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    <option value="pièce">pièce</option>
                    <option value="kg">kg</option>
                    <option value="paire">paire</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Délai standard (j)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={editing.turnaroundDays ?? 2}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        turnaroundDays: Math.max(1, Number(e.target.value) || 2),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Consigne d&apos;entretien / Atelier (optionnel)
                </label>
                <input
                  type="text"
                  value={editing.careNote || ''}
                  onChange={(e) => setEditing({ ...editing, careNote: e.target.value })}
                  placeholder="Ex: Protéger les broderies dorées, repassage vapeur douce"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Visuels studio intégrés
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {CATALOG_IMAGE_PRESETS.map((preset) => {
                    const currentUrl = resolveCatalogItemImage(editing);
                    const selected = currentUrl === preset.url;
                    return (
                      <button
                        key={preset.url}
                        type="button"
                        onClick={() => setEditing({ ...editing, imageUrl: preset.url })}
                        className={`rounded-lg border p-1 transition-colors cursor-pointer ${
                          selected
                            ? 'border-teal-700 ring-2 ring-teal-700/20 bg-teal-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                        title={preset.label}
                      >
                        <img
                          src={preset.url}
                          alt={preset.label}
                          referrerPolicy="no-referrer"
                          className="h-12 w-full rounded object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
                >
                  Enregistrer l&apos;article
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
