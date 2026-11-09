import type { MasterTypeKey } from '@zitaware/contracts';

/**
 * Client registry of the organization-scoped generic masters — drives both
 * the `/masters` catalogue tiles and the generic `/masters/[type]` screen's
 * titles/labels. One entry per `MasterTypeKey` (the 12 identical-shape
 * tables served by the generic `masters.*` API). Geography (states/
 * districts/cities) and penalty categories are separate registries/routes
 * added in their own increments, so no catalogue tile links to a screen
 * that does not exist yet.
 */
export interface MasterCatalogItem {
  type: MasterTypeKey;
  pluralLabel: string;
  singularLabel: string;
  description: string;
  group: string;
  /** Permission required to see the tile and open the screen. */
  permission: string;
}

export const MASTER_CATALOG: MasterCatalogItem[] = [
  {
    type: 'internal_departments',
    pluralLabel: 'Departments',
    singularLabel: 'Department',
    description: 'Internal org departments used on employee records.',
    group: 'HR & Organization',
    permission: 'master.read',
  },
  {
    type: 'designations',
    pluralLabel: 'Designations',
    singularLabel: 'Designation',
    description: 'Job titles / designations for employees.',
    group: 'HR & Organization',
    permission: 'master.read',
  },
  {
    type: 'employment_types',
    pluralLabel: 'Employment Types',
    singularLabel: 'Employment Type',
    description: 'Full-time, contract and other employment classifications.',
    group: 'HR & Organization',
    permission: 'master.read',
  },
  {
    type: 'client_types',
    pluralLabel: 'Client Types',
    singularLabel: 'Client Type',
    description: 'Classifies the client relationship (enterprise, SMB, individual, etc.).',
    group: 'CRM',
    permission: 'master.read',
  },
  {
    type: 'lead_types',
    pluralLabel: 'Lead Types',
    singularLabel: 'Lead Type',
    description: 'Lead source categories used in the CRM.',
    group: 'CRM',
    permission: 'master.read',
  },
  {
    type: 'lead_sources',
    pluralLabel: 'Lead Sources',
    singularLabel: 'Lead Source',
    description: 'Where a lead originated from.',
    group: 'CRM',
    permission: 'master.read',
  },
  {
    type: 'project_types',
    pluralLabel: 'Project Types',
    singularLabel: 'Project Type',
    description: 'Commercial classification of projects.',
    group: 'Projects',
    permission: 'master.read',
  },
  {
    type: 'document_categories',
    pluralLabel: 'Document Categories',
    singularLabel: 'Document Category',
    description: 'Classifications applied to uploaded documents.',
    group: 'Documents & Finance',
    permission: 'master.read',
  },
  {
    type: 'expense_categories',
    pluralLabel: 'Expense Categories',
    singularLabel: 'Expense Category',
    description: 'Categories used to classify expenses.',
    group: 'Documents & Finance',
    permission: 'master.read',
  },
  {
    type: 'units_of_measure',
    pluralLabel: 'Units of Measure',
    singularLabel: 'Unit of Measure',
    description: 'Units used for vendor bill line-item quantities (Qty, Litre, Meter, etc).',
    group: 'Documents & Finance',
    permission: 'master.read',
  },
  {
    type: 'product_categories',
    pluralLabel: 'Product Categories',
    singularLabel: 'Product Category',
    description: 'Categories used to classify inventory products and items.',
    group: 'Documents & Finance',
    permission: 'master.read',
  },
  {
    type: 'allocation_targets',
    pluralLabel: 'Allocation Targets',
    singularLabel: 'Allocation Target',
    description: 'Approved non-project destinations for an employee’s month — bench, internal work, training, leave.',
    group: 'HR & Organization',
    permission: 'master.read',
  },
];

export function findMasterCatalogItem(type: string): MasterCatalogItem | undefined {
  return MASTER_CATALOG.find((item) => item.type === type);
}

/**
 * Geography masters — separate from the generic registry because they use
 * the geography.* API (hierarchical, global) rather than masters.*. Counts
 * come from geography.getCounts, keyed by `countKey`.
 */
export interface GeographyCatalogItem {
  path: string;
  pluralLabel: string;
  description: string;
  countKey: 'states' | 'districts' | 'cities';
  permission: string;
}

export const GEOGRAPHY_CATALOG: GeographyCatalogItem[] = [
  {
    path: '/masters/states',
    pluralLabel: 'States',
    description: 'Statutory Indian states and union territories.',
    countKey: 'states',
    permission: 'master.read',
  },
  {
    path: '/masters/districts',
    pluralLabel: 'Districts',
    description: 'Districts under each state.',
    countKey: 'districts',
    permission: 'master.read',
  },
  {
    path: '/masters/cities',
    pluralLabel: 'Cities',
    description: 'Cities under each district.',
    countKey: 'cities',
    permission: 'master.read',
  },
];
