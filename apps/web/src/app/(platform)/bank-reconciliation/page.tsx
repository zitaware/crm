import { redirect } from 'next/navigation';

/** Bank reconciliation is hidden. The permission does not open this screen. */
export default function BankReconciliationPage() {
  redirect('/');
}
