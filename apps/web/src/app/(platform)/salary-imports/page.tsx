import { redirect } from 'next/navigation';

export default function SalaryImportsRedirect() {
  redirect('/employee-costing?tab=salary');
}
