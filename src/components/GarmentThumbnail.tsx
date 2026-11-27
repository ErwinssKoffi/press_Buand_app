import React, { useState } from 'react';
import { Shirt } from 'lucide-react';

interface GarmentThumbnailProps {
  src: string;
  alt: string;
  sizeClass?: string;
}

export const GarmentThumbnail: React.FC<GarmentThumbnailProps> = ({
  src,
  alt,
  sizeClass = 'h-14 w-14',
}) => {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`${sizeClass} shrink-0 rounded-lg border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400`}
        title={alt}
      >
        <Shirt className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100`}
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
};
