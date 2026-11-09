'use client';

import { useState } from 'react';
import { App, Button, Form, Input, Modal, Upload } from 'antd';
import { trpc } from '@/server/trpc';
import type { QuickAddBoxProps } from '@/components/quick-add-select';

export interface LegalEntityCoreValues {
  legalName: string;
  panNumber: string;
  registeredAddress: string;
  placeOfSupply?: string;
  jurisdiction?: string;
  stateCode?: string;
}

export type BrandingImageInput = { contentType: 'image/png' | 'image/jpeg'; dataBase64: string };
/** undefined: unchanged; null: removed. */
export type ImageDraft = BrandingImageInput | null | undefined;
export interface LegalEntityImages {
  logo: ImageDraft;
  seal: ImageDraft;
  authorizedSign: ImageDraft;
}

export const NO_IMAGES: LegalEntityImages = { logo: undefined, seal: undefined, authorizedSign: undefined };

const MAX_BRANDING_IMAGE_BYTES = 5 * 1024 * 1024;

function readBrandingFile(file: File): Promise<BrandingImageInput> {
  const contentType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    return Promise.reject(new Error('Use a PNG or JPEG.'));
  }
  if (file.size > MAX_BRANDING_IMAGE_BYTES) {
    return Promise.reject(new Error('Each image must be under 5 MB.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      const dataBase64 = comma >= 0 ? result.slice(comma + 1) : '';
      if (!dataBase64) {
        reject(new Error('Could not read this image.'));
        return;
      }
      resolve({ contentType, dataBase64 });
    };
    reader.readAsDataURL(file);
  });
}

function BrandingImageField({
  label,
  saved,
  draft,
  onChange,
}: {
  label: string;
  saved: BrandingImageInput | null;
  draft: ImageDraft;
  onChange: (next: ImageDraft) => void;
}) {
  const { message } = App.useApp();
  const shown = draft === undefined ? saved : draft;
  const preview = shown ? `data:${shown.contentType};base64,${shown.dataBase64}` : null;

  return (
    <div className="mb-4">
      <div className="mb-1 text-[13px] font-semibold text-ink">{label}</div>
      <p className="mb-2 text-[12px] text-muted">PNG or JPEG, up to 5 MB. Stored in S3 and printed on invoices.</p>
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URL preview of a file the user just picked
          <img src={preview} alt="" className="h-16 max-w-[140px] rounded-ui border border-ui bg-white object-contain" />
        ) : (
          <div className="flex h-16 w-[140px] items-center justify-center rounded-ui border border-dashed border-ui text-[12px] text-muted-2">
            None
          </div>
        )}
        <Upload
          accept="image/png,image/jpeg"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            void readBrandingFile(file)
              .then((image) => onChange(image))
              .catch((error: unknown) => message.error(error instanceof Error ? error.message : 'Could not read this image.'));
            return false;
          }}
        >
          <Button size="small">Choose image</Button>
        </Upload>
        {shown ? (
          <Button size="small" onClick={() => onChange(null)}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The legal entity form's fields, inside a `Form<LegalEntityCoreValues>`. The
 * Legal Entities page and the F2 box both render these, so they always match.
 * The print images are held by the caller. In edit mode the PAN is locked and
 * `saved` holds the stored images (undefined when they could not be loaded).
 */
export function LegalEntityFields({
  mode,
  saved,
  images,
  onImagesChange,
  autoFocus,
}: {
  mode: 'create' | 'edit';
  saved?: { logo?: ImageDraft; seal?: ImageDraft; authorizedSign?: ImageDraft } | undefined;
  images: LegalEntityImages;
  onImagesChange: (next: LegalEntityImages) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <Form.Item label="Legal name" name="legalName" rules={[{ required: true, message: 'Legal name is required.' }, { max: 200 }]}>
        <Input {...(autoFocus ? { autoFocus: true } : {})} placeholder="e.g. Acme Technologies Pvt Ltd" />
      </Form.Item>
      <Form.Item
        label="PAN"
        name="panNumber"
        rules={[{ required: true, message: 'PAN is required.' }, { len: 10, message: 'PAN must be exactly 10 characters.' }]}
        extra={mode === 'edit' ? 'PAN cannot be changed after creation.' : undefined}
      >
        <Input disabled={mode === 'edit'} placeholder="e.g. AAACA1234A" maxLength={10} />
      </Form.Item>
      <Form.Item
        label="Registered address"
        name="registeredAddress"
        rules={[{ required: true, message: 'Registered address is required.' }, { max: 2000 }]}
      >
        <Input.TextArea rows={3} placeholder="Registered office address" />
      </Form.Item>
      <Form.Item label="Place of supply" name="placeOfSupply" rules={[{ max: 120 }]} extra="Printed on the tax invoice. Example: AHMEDABAD.">
        <Input placeholder="e.g. AHMEDABAD" maxLength={120} />
      </Form.Item>
      <Form.Item label="Jurisdiction" name="jurisdiction" rules={[{ max: 120 }]} extra="Printed as “Subject to … Jurisdiction”.">
        <Input placeholder="e.g. Ahmedabad" maxLength={120} />
      </Form.Item>
      <Form.Item label="State code on invoice" name="stateCode" rules={[{ max: 10 }]} extra="Printed beside the seller state. Example: GUJ.">
        <Input placeholder="e.g. GUJ" maxLength={10} />
      </Form.Item>

      <h5 className="mb-3 mt-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Print images</h5>
      {mode === 'edit' && !saved ? <p className="text-[13px] text-muted">Could not load the saved images. Please retry.</p> : null}
      {mode === 'create' || saved ? (
        <>
          <BrandingImageField label="Logo" saved={saved?.logo ?? null} draft={images.logo} onChange={(logo) => onImagesChange({ ...images, logo })} />
          <BrandingImageField label="Seal" saved={saved?.seal ?? null} draft={images.seal} onChange={(seal) => onImagesChange({ ...images, seal })} />
          <BrandingImageField
            label="Authorized sign"
            saved={saved?.authorizedSign ?? null}
            draft={images.authorizedSign}
            onChange={(authorizedSign) => onImagesChange({ ...images, authorizedSign })}
          />
        </>
      ) : null}
    </>
  );
}

/** What `legalEntities.create` is sent, from the page and the F2 box alike. */
export function legalEntityCreateInput(values: LegalEntityCoreValues, images: LegalEntityImages) {
  return {
    ...values,
    ...(images.logo ? { logo: images.logo } : {}),
    ...(images.seal ? { seal: images.seal } : {}),
    ...(images.authorizedSign ? { authorizedSign: images.authorizedSign } : {}),
  };
}

const ADD_FORM_ID = 'legal-entity-quick-add';

/** Mounted afresh each time the box opens (the box is destroyed when hidden), so nothing is left from the last one. */
function LegalEntityAddForm({ initialText, onSubmit }: { initialText: string; onSubmit: (values: LegalEntityCoreValues, images: LegalEntityImages) => void }) {
  const [form] = Form.useForm<LegalEntityCoreValues>();
  const [images, setImages] = useState<LegalEntityImages>(NO_IMAGES);
  return (
    <Form<LegalEntityCoreValues>
      form={form}
      name={ADD_FORM_ID}
      layout="vertical"
      requiredMark
      initialValues={{ legalName: initialText, panNumber: '', registeredAddress: '', placeOfSupply: '', jurisdiction: '', stateCode: '' }}
      onFinish={(values) => onSubmit(values, images)}
    >
      <LegalEntityFields mode="create" images={images} onImagesChange={setImages} autoFocus />
      <p className="m-0 text-[12px] text-muted">GST registrations can be added later in Legal Entities.</p>
    </Form>
  );
}

/** The F2 box of the legal entity picker: the full Add Legal Entity form, with what was typed as the name. */
export function LegalEntityAddBox({ open, initialText, onClose, onCreated }: QuickAddBoxProps) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const create = trpc.legalEntities.create.useMutation({
    onSuccess: async (created) => {
      message.success(`Legal entity ${created.legalName} added.`);
      onCreated({ value: created.id, label: created.legalName });
      await utils.legalEntities.list.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal
      open={open}
      width={560}
      title="Add legal entity"
      okText="Add legal entity"
      okButtonProps={{ htmlType: 'submit', form: ADD_FORM_ID }}
      confirmLoading={create.isPending}
      onCancel={onClose}
      destroyOnHidden
    >
      <LegalEntityAddForm initialText={initialText} onSubmit={(values, images) => create.mutate(legalEntityCreateInput(values, images))} />
    </Modal>
  );
}
