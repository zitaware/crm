export type DocumentStatus = 'PENDING_UPLOAD' | 'UPLOADED' | 'DELETED';

export interface DocumentSummary {
  id: string;
  /** Classifies the document itself (e.g. "Tender Notice"). Distinct from
   * DocumentLink.entityType, which is the business entity the document is
   * attached to — a link's entityType is validated against this category's
   * document_category_entity_types (no rows = applies to every entity type). */
  documentCategoryId: string | null;
  documentGroupId: string;
  originalFilename: string;
  contentType: string;
  /** bigint transmitted as a decimal string. */
  sizeBytes: string;
  checksum: string;
  status: DocumentStatus;
  uploadedBy: string;
  /** Resolved display name for `uploadedBy`, looked up only where it's
   * actually rendered (listLinksForEntity) — null elsewhere (e.g.
   * initiateUpload/confirmUpload's own return value, never shown in the
   * UI) or if the uploading user no longer exists. */
  uploadedByName: string | null;
  uploadedAt: string | null;
  /** Client-side AES-256-GCM encryption — the server never sees the
   * password. When true, decrypting requires the password plus
   * encryptionSalt/encryptionIv (only returned by getDownloadUrl, not
   * exposed here, to keep list payloads lean). */
  isEncrypted: boolean;
  version: number;
}

export interface DocumentLinkSummary {
  id: string;
  documentId: string;
  entityType: string;
  entityId: string;
  linkType: string | null;
  createdAt: string;
}

export interface DocumentPort {
  /** Creates a PENDING_UPLOAD document row and returns a presigned S3 PUT
   * URL the client uploads directly to (the API never proxies file bytes).
   * A fresh documentGroupId is generated every call — Phase 2 does not yet
   * expose an explicit "upload a new version of document X" command. */
  initiateUpload(input: {
    organizationId: string;
    documentCategoryId: string | undefined;
    originalFilename: string;
    contentType: string;
    sizeBytes: string;
    checksum: string;
    isEncrypted: boolean | undefined;
    encryptionSalt: string | undefined;
    encryptionIv: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<{ document: DocumentSummary; uploadUrl: string }>;

  /** Marks a PENDING_UPLOAD document UPLOADED once the client reports its
   * direct-to-S3 PUT succeeded. */
  confirmUpload(input: {
    organizationId: string;
    documentId: string;
    actorId: string;
    correlationId: string;
  }): Promise<DocumentSummary>;

  /** Rejects (VALIDATION_FAILED) if the document has a documentCategoryId
   * and that category has one or more document_category_entity_types rows
   * that do NOT include entityType — i.e. the category is restricted to a
   * specific set of entity types and this isn't one of them. No rows for
   * the category means it applies to every entity type, so any entityType
   * is accepted. A document with no category assigned skips this check
   * entirely. */
  linkToEntity(input: {
    organizationId: string;
    documentId: string;
    entityType: string;
    entityId: string;
    linkType: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<DocumentLinkSummary>;

  listLinksForEntity(input: {
    organizationId: string;
    entityType: string;
    entityId: string;
    /** undefined = no filter, every link regardless of linkType (the
     * original, pre-tagging behavior). null = only untagged links — what a
     * generic "Documents" section must pass so a typed link (e.g. an
     * invoice's INVOICE_INWARD_COPY_LINK_TYPE) doesn't also show up there.
     * A string = only links with that exact linkType. */
    linkType: string | null | undefined;
  }): Promise<Array<DocumentLinkSummary & { document: DocumentSummary }>>;

  softDelete(input: {
    organizationId: string;
    documentId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  /** Requires status === 'UPLOADED' (a PENDING_UPLOAD or DELETED document
   * can't be downloaded). Records DOCUMENT_DOWNLOADED. encryptionSalt/
   * encryptionIv are only ever returned here, not in DocumentSummary. */
  getDownloadUrl(input: {
    organizationId: string;
    documentId: string;
    actorId: string;
    correlationId: string;
  }): Promise<{
    downloadUrl: string;
    originalFilename: string;
    contentType: string;
    isEncrypted: boolean;
    encryptionSalt: string | null;
    encryptionIv: string | null;
  }>;
}
