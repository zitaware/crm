import { redirect } from 'next/navigation';

/** Financial years are hidden. The permission does not open this screen. */
export default function FinancialYearsPage() {
  redirect('/');
}
