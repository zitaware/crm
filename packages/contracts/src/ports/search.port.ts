/** What the top-bar search looks through. Each kind is searched only for a user who may read it. */
export type GlobalSearchKind = 'PROJECT' | 'CLIENT' | 'LEAD' | 'INVOICE' | 'VENDOR_BILL' | 'VENDOR' | 'EMPLOYEE';

/** The read permission each kind needs; the same one its own list screen needs. */
export const GLOBAL_SEARCH_PERMISSIONS: Record<GlobalSearchKind, string> = {
  PROJECT: 'project.read',
  CLIENT: 'client.read',
  LEAD: 'lead.read',
  INVOICE: 'invoice.read',
  VENDOR_BILL: 'vendor_bill.read',
  VENDOR: 'vendor.read',
  EMPLOYEE: 'employee.read',
};

/** One match: what it is, what to call it, and where it opens. */
export interface GlobalSearchHit {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  /** A second line that tells two matches apart: the client, project, vendor, code… */
  subtitle: string | null;
  /** The screen that shows it. */
  href: string;
}

export interface SearchPort {
  /**
   * Matches by name or number, a few per kind, newest first. A user sees only
   * what their own list screens show: projects (and their invoices and vendor
   * bills) as the project lists scope them, and only their legal entities'.
   */
  search(input: {
    organizationId: string;
    actorId: string;
    query: string;
    kinds: GlobalSearchKind[];
    canSeeAllProjects: boolean;
  }): Promise<GlobalSearchHit[]>;
}
