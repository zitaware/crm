import { Injectable } from '@nestjs/common';
import type { GlobalSearchHit, GlobalSearchKind, SearchPort } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

/** Matches shown per kind; the kind's own list has the rest. */
const PER_KIND = 5;

const like = (query: string) => ({ contains: query, mode: 'insensitive' as const });

/**
 * The top-bar search. Each kind is read the way its own list reads it, so a
 * user finds nothing their screens would not show: projects, invoices and
 * vendor bills follow the project lists' scope (ProjectsService.list), and
 * the Prisma entity scope (ADR-172) narrows everything to the user's legal
 * entities as it does for every other read.
 */
@Injectable()
export class SearchService implements SearchPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async search(input: { organizationId: string; actorId: string; query: string; kinds: GlobalSearchKind[]; canSeeAllProjects: boolean }): Promise<GlobalSearchHit[]> {
    const query = input.query.trim();
    if (query.length < 2 || input.kinds.length === 0) return [];
    const wants = new Set(input.kinds);
    const db = this.prisma.client;
    const organizationId = input.organizationId;

    // Projects a user without project.read_all is assigned to; null means every project.
    const needsProjectScope = !input.canSeeAllProjects && (wants.has('PROJECT') || wants.has('INVOICE') || wants.has('VENDOR_BILL'));
    const visibleProjectIds = needsProjectScope
      ? (await this.projects.list({ organizationId, actorId: input.actorId, canSeeAll: false })).map((p) => p.id)
      : null;
    const inVisibleProjects = visibleProjectIds ? { projectId: { in: visibleProjectIds } } : {};

    const searches: Array<Promise<GlobalSearchHit[]>> = [];

    if (wants.has('PROJECT')) {
      searches.push(
        db.project
          .findMany({
            where: { organizationId, name: like(query), ...(visibleProjectIds ? { id: { in: visibleProjectIds } } : {}) },
            select: { id: true, name: true, client: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: PER_KIND,
          })
          .then((rows) => rows.map((p) => ({ kind: 'PROJECT' as const, id: p.id, title: p.name, subtitle: p.client.name, href: `/projects/${p.id}` }))),
      );
    }

    if (wants.has('CLIENT') || wants.has('VENDOR')) {
      const parties = (profile: 'clientProfile' | 'vendorProfile') =>
        db.party.findMany({
          where: { organizationId, deletedAt: null, [profile]: { isNot: null }, OR: [{ name: like(query) }, { shortCode: like(query) }] },
          select: { id: true, name: true, shortCode: true, isActive: true },
          orderBy: { name: 'asc' },
          take: PER_KIND,
        });
      const note = (p: { shortCode: string | null; isActive: boolean }) => [p.shortCode, p.isActive ? null : 'Inactive'].filter(Boolean).join(' · ') || null;
      if (wants.has('CLIENT')) {
        searches.push(parties('clientProfile').then((rows) => rows.map((p) => ({ kind: 'CLIENT' as const, id: p.id, title: p.name, subtitle: note(p), href: `/clients/${p.id}` }))));
      }
      if (wants.has('VENDOR')) {
        // Vendors have no page of their own: the list opens filtered to the name.
        searches.push(
          parties('vendorProfile').then((rows) =>
            rows.map((p) => ({ kind: 'VENDOR' as const, id: p.id, title: p.name, subtitle: note(p), href: `/vendors?search=${encodeURIComponent(p.name)}` })),
          ),
        );
      }
    }

    if (wants.has('LEAD')) {
      searches.push(
        db.lead
          .findMany({
            where: { organizationId, OR: [{ title: like(query) }, { tenderNumber: like(query) }] },
            select: { id: true, title: true, tenderNumber: true, client: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: PER_KIND,
          })
          .then((rows) =>
            rows.map((l) => ({ kind: 'LEAD' as const, id: l.id, title: l.title, subtitle: [l.client.name, l.tenderNumber].filter(Boolean).join(' · '), href: `/leads/${l.id}` })),
          ),
      );
    }

    if (wants.has('INVOICE')) {
      searches.push(
        db.invoice
          .findMany({
            where: { organizationId, invoiceNumber: like(query), ...inVisibleProjects },
            select: { id: true, invoiceNumber: true, projectId: true, project: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: PER_KIND,
          })
          .then((rows) =>
            rows.map((i) => ({
              kind: 'INVOICE' as const,
              id: i.id,
              title: i.invoiceNumber ?? 'Draft invoice',
              subtitle: i.project.name,
              href: `/projects/${i.projectId}/invoices/${i.id}`,
            })),
          ),
      );
    }

    if (wants.has('VENDOR_BILL')) {
      // As the vendor bill list: a bill with no project is seen by whoever entered it.
      const billScope = visibleProjectIds ? { OR: [{ projectId: { in: visibleProjectIds } }, { projectId: null, createdBy: input.actorId }] } : {};
      searches.push(
        db.vendorBill
          .findMany({
            where: { organizationId, AND: [{ OR: [{ vendorBillNumber: like(query) }, { vendor: { name: like(query) } }] }, billScope] },
            select: { id: true, vendorBillNumber: true, vendor: { select: { name: true } }, project: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: PER_KIND,
          })
          .then((rows) =>
            rows.map((b) => ({
              kind: 'VENDOR_BILL' as const,
              id: b.id,
              title: b.vendorBillNumber,
              subtitle: [b.vendor.name, b.project?.name ?? 'Company overhead'].join(' · '),
              href: `/vendor-bills/${b.id}`,
            })),
          ),
      );
    }

    if (wants.has('EMPLOYEE')) {
      searches.push(
        db.employee
          .findMany({
            where: { organizationId, deletedAt: null, OR: [{ fullName: like(query) }, { employeeCode: like(query) }] },
            select: { id: true, fullName: true, employeeCode: true, status: true },
            orderBy: { fullName: 'asc' },
            take: PER_KIND,
          })
          .then((rows) =>
            rows.map((e) => ({
              kind: 'EMPLOYEE' as const,
              id: e.id,
              title: e.fullName,
              subtitle: e.status === 'ACTIVE' ? e.employeeCode : `${e.employeeCode} · Inactive`,
              // Employees have no page of their own: the list opens filtered to the code.
              href: `/employees?search=${encodeURIComponent(e.employeeCode)}`,
            })),
          ),
      );
    }

    return (await Promise.all(searches)).flat();
  }
}
