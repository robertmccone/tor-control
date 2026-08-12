import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a data-URL QR code for the given value. */
export default function QrCode({ value, size = 176, className = '' }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!value) return undefined;
    let cancelled = false;

    QRCode.toDataURL(value, {
      width: size * 2, // Render at 2x so the image stays sharp on HiDPI.
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0f14ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        className={`grid place-items-center rounded-lg bg-ink-800 p-3 text-center text-xs text-ink-400 ${className}`}
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-lg bg-white p-2 ${className}`}
      style={{ width: size, height: size }}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR code for ${value}`}
          width={size}
          height={size}
          className="h-full w-full"
        />
      ) : (
        <div className="h-full w-full animate-pulse rounded bg-ink-100/20" />
      )}
    </div>
  );
}
