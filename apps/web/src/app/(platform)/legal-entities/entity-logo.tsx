'use client';

import { trpc } from '@/server/trpc';

/**
 * A legal entity's logo in the list, as printed on its invoices. The image
 * comes from its branding (shared with the edit form's cache), fetched only
 * when it has one; otherwise its initials stand in.
 */
export function EntityLogo({ legalEntityId, legalName, hasLogo }: { legalEntityId: string; legalName: string; hasLogo: boolean }) {
  const branding = trpc.legalEntities.getBranding.useQuery({ id: legalEntityId }, { enabled: hasLogo, staleTime: 5 * 60_000 });
  const logo = hasLogo ? branding.data?.logo : null;
  const box = 'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-ui border border-ui bg-surface';

  if (logo) {
    return (
      <span className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored data URL; next/image adds nothing here */}
        <img src={`data:${logo.contentType};base64,${logo.dataBase64}`} alt={`${legalName} logo`} className="h-full w-full object-contain p-[3px]" />
      </span>
    );
  }
  const initials = legalName
    .replace(/\b(private|pvt|limited|ltd|llp)\b\.?/gi, '')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span aria-hidden="true" className={`${box} bg-brand-soft font-display text-[13px] font-bold text-brand`}>
      {hasLogo && branding.isLoading ? '' : initials || '?'}
    </span>
  );
}
