import { CatalogItem, GarmentCategory } from '../types/pressing';

export const GARMENT_IMAGES = {
  bazin: '/src/assets/images/garment_bazin_boubou_1795689543459.jpg',
  kita: '/src/assets/images/garment_kita_pagne_1795689545446.jpg',
  wax: '/src/assets/images/garment_wax_ensemble_1795689544003.jpg',
  suit: '/src/assets/images/garment_costume_suit_1795689546054.jpg',
  shirt: '/src/assets/images/garment_dress_shirt_1795689545417.jpg',
  dress: '/src/assets/images/garment_evening_dress_1795689546083.jpg',
  casual: '/src/assets/images/garment_casual_stack_1795689546333.jpg',
  home: '/src/assets/images/garment_home_linen_1795689546910.jpg',
} as const;

export const CATALOG_IMAGE_PRESETS: { label: string; url: string }[] = [
  { label: 'Bazin / Boubou brodé', url: GARMENT_IMAGES.bazin },
  { label: 'Pagne Kita / Baoulé', url: GARMENT_IMAGES.kita },
  { label: 'Ensemble Pagne Wax', url: GARMENT_IMAGES.wax },
  { label: 'Costume / Veste', url: GARMENT_IMAGES.suit },
  { label: 'Chemise / Pantalon', url: GARMENT_IMAGES.shirt },
  { label: 'Robe de soirée', url: GARMENT_IMAGES.dress },
  { label: 'Polo / Jean / Quotidien', url: GARMENT_IMAGES.casual },
  { label: 'Couette / Draps / Maison', url: GARMENT_IMAGES.home },
];

export function resolveCatalogItemImage(
  item: Pick<CatalogItem, 'id' | 'name' | 'category' | 'imageUrl'>
): string {
  if (item.imageUrl) return item.imageUrl;

  const key = `${item.id} ${item.name}`.toLowerCase();
  if (key.includes('bazin') || key.includes('boubou')) return GARMENT_IMAGES.bazin;
  if (key.includes('kita') || key.includes('baoulé') || key.includes('baoule')) {
    return GARMENT_IMAGES.kita;
  }
  if (key.includes('wax') || key.includes('pagne')) return GARMENT_IMAGES.wax;
  if (key.includes('costume') || key.includes('veste') || key.includes('blazer')) {
    return GARMENT_IMAGES.suit;
  }
  if (key.includes('robe') || key.includes('soirée') || key.includes('soiree')) {
    return GARMENT_IMAGES.dress;
  }
  if (key.includes('chemise') || key.includes('pantalon classique')) {
    return GARMENT_IMAGES.shirt;
  }
  if (key.includes('polo') || key.includes('t-shirt') || key.includes('jean')) {
    return GARMENT_IMAGES.casual;
  }
  if (
    key.includes('couette') ||
    key.includes('drap') ||
    key.includes('rideau') ||
    key.includes('kilo') ||
    key.includes('linge')
  ) {
    return GARMENT_IMAGES.home;
  }

  const byCategory: Record<GarmentCategory, string> = {
    'Tenues traditionnelles': GARMENT_IMAGES.bazin,
    'Costumes & Bureau': GARMENT_IMAGES.suit,
    Quotidien: GARMENT_IMAGES.casual,
    'Maison & Linge': GARMENT_IMAGES.home,
  };
  return byCategory[item.category] || GARMENT_IMAGES.shirt;
}
