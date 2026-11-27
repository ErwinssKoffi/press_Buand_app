/**
 * Compresses and resizes a user-imported image file (PNG, JPG, WebP)
 * into a lightweight local square-cropped data URL suitable for IndexedDB & JSON backups.
 */
export async function processImportedCatalogImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Veuillez sélectionner un fichier image valide (JPG, PNG, WebP).');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire ce fichier image.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Format image non pris en charge.'));
    image.src = dataUrl;
  });

  const targetSize = 360;
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  // White background in case of transparent PNG
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, targetSize, targetSize);

  // Center-crop cover
  const scale = Math.max(targetSize / img.width, targetSize / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const dx = (targetSize - drawWidth) / 2;
  const dy = (targetSize - drawHeight) / 2;

  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);

  return canvas.toDataURL('image/jpeg', 0.84);
}
