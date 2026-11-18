'use client';

export default function PrintButton({ fileUrl }) {
  return <button className="button button-secondary" type="button" onClick={() => {
    const preview = window.open(fileUrl, '_blank', 'noopener');
    if (preview) preview.addEventListener('load', () => preview.print(), { once: true });
  }}>Cetak</button>;
}
