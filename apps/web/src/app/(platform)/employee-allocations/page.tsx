import { redirect } from 'next/navigation';

export default function EmployeeAllocationsRedirect() {
  redirect('/employee-costing?tab=allocation');
}
