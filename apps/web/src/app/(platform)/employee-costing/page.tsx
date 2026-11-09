import { Suspense } from 'react';
import { EmployeeCostingScreen } from './screen';

export default function EmployeeCostingPage() {
  return (
    <Suspense fallback={null}>
      <EmployeeCostingScreen />
    </Suspense>
  );
}
