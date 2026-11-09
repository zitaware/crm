import { redirect } from 'next/navigation';

export default async function SalaryImportNewRedirect({
  searchParams,
}: {
  searchParams: Promise<{ draftId?: string }>;
}) {
  const { draftId } = await searchParams;
  redirect(draftId ? `/employee-costing/new?draftId=${encodeURIComponent(draftId)}` : '/employee-costing/new');
}
