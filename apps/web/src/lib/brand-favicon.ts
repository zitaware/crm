'use client';

import { useEffect } from 'react';

const BRAND = '#0f5bff';

/** "Concentric IT Services Private Limited" → "CI", as the sidebar shows it. */
function initialsOf(name: string): string {
  const words = name
    .replace(/\b(private|pvt|limited|ltd|llp)\b\.?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.map((word) => word.charAt(0)).slice(0, 2).join('') || '?').toUpperCase();
}

/** A 64px square: the initials in white on brand blue. */
function initialsIcon(name: string): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = BRAND;
  context.beginPath();
  context.roundRect(0, 0, 64, 64, 12);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = 'bold 30px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(initialsOf(name), 32, 35);
  return canvas.toDataURL('image/png');
}

/**
 * White labelling for the browser tab (ADR-188): the tab icon becomes the
 * user's own legal entity's logo, or its initials when it has none. Without
 * a brand the app's own favicon stays. The original icon comes back when the
 * shell unmounts (sign-out).
 */
export function useBrandFavicon(brand: { name: string; logoSrc: string | null } | undefined, logoPending: boolean) {
  const name = brand?.name;
  const logoSrc = brand?.logoSrc ?? null;
  useEffect(() => {
    // Wait for a logo that is on its way, so the tab does not flash the initials first.
    if (!name || logoPending) return;
    const href = logoSrc ?? initialsIcon(name);
    if (!href) return;
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const originals = links.map((link) => link.href);
    let added: HTMLLinkElement | null = null;
    if (links.length === 0) {
      added = document.createElement('link');
      added.rel = 'icon';
      document.head.appendChild(added);
      links.push(added);
    }
    for (const link of links) link.href = href;
    return () => {
      links.forEach((link, i) => {
        if (link !== added) link.href = originals[i] ?? link.href;
      });
      added?.remove();
    };
  }, [name, logoSrc, logoPending]);
}
