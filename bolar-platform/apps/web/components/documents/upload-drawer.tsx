'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { uploadDocument, UploadError, formatBytes, type DocumentDetailDto, type PendingUpload, type UploadProgress } from '@/lib/hooks/document';
import { Alert, Badge, Button, Drawer, Input, Select } from '@/components/ui';

const OWNER_TYPES = [['org', 'Organization'], ['property', 'Property'], ['unit', 'Unit'], ['lease', 'Lease'], ['tenant_profile', 'Tenant profile'], ['work_order', 'Work order'], ['vendor', 'Vendor'], ['case', 'Case'], ['application', 'Application']] as const;
const CATEGORIES = ['general', 'lease', 'id', 'screening_report', 'insurance', 'notice', 'invoice'];
const MAX_BYTES = 25 * 1024 * 1024;

type Status = { kind: 'idle' } | { kind: 'busy'; progress: UploadProgress } | { kind: 'done'; doc: DocumentDetailDto } | { kind: 'error'; message: string; pending?: PendingUpload };

/** Upload drawer (Day 26): metadata -> POST /documents -> PUT bytes to the signed URL with progress -> finalize. Retry resumes the same version. */
export function UploadDrawer({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: { ownerType: string; ownerId: string } }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [ownerType, setOwnerType] = useState(defaults?.ownerType ?? 'org');
  const [ownerId, setOwnerId] = useState(defaults?.ownerId ?? '');
  const [classification, setClassification] = useState('internal');
  const [category, setCategory] = useState('general');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const effectiveOwnerId = ownerType === 'org' ? (me?.org.id ?? '') : ownerId;

  function pick(f: File | null) {
    setFileError(null);
    if (f && f.size > MAX_BYTES) { setFileError('Files are limited to 25 MB.'); setFile(null); return; }
    if (f && f.size === 0) { setFileError('The file is empty.'); setFile(null); return; }
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function run(resume?: PendingUpload) {
    if (!file) { setFileError('Choose a file to upload.'); return; }
    setStatus({ kind: 'busy', progress: { phase: 'creating', percent: 0 } });
    try {
      const { document } = await uploadDocument({ ownerType, ownerId: effectiveOwnerId, title, classification, category }, file, (progress) => setStatus({ kind: 'busy', progress }), resume);
      setStatus({ kind: 'done', doc: document });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      if (err instanceof UploadError) setStatus({ kind: 'error', message: err.message, pending: err.pending });
      else setStatus({ kind: 'error', message: err instanceof ApiError ? describe(err) : err instanceof Error ? err.message : 'Upload failed' });
    }
  }

  function reset() { setStatus({ kind: 'idle' }); setFile(null); setTitle(''); setFileError(null); }

  return (
    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Upload a document">
      {status.kind === 'done' ? (
        <div className="space-y-4">
          <Alert tone="success" title={`Uploaded "${status.doc.title}"`}>
            <p className="mt-1 text-xs">Version {status.doc.versions[0]?.version} · {status.doc.versions[0] ? formatBytes(status.doc.versions[0].sizeBytes) : ''} · scan <Badge tone="success">{status.doc.versions[0]?.scanStatus}</Badge></p>
            {status.doc.gated && <p className="mt-2 text-xs">This file is {status.doc.classification}. Opening it requires an approved purpose, even for the uploader.</p>}
          </Alert>
          <div className="flex gap-2"><Button onClick={reset}>Upload another</Button><Button variant="secondary" onClick={() => { reset(); onClose(); }}>Done</Button></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(); }} aria-busy={status.kind === 'busy'}>
          <Input id="upload-title" label="Title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id="upload-owner-type" label="Linked to" value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
              {OWNER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {ownerType === 'org'
              ? <Input label="Owner id" value={me?.org.name ?? ''} readOnly hint="Organization-wide document" />
              : <Input label="Owner id" required value={ownerId} onChange={(e) => setOwnerId(e.target.value)} hint="Paste the id from the property, lease or work order screen" />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id="upload-classification" label="Classification" value={classification} onChange={(e) => setClassification(e.target.value)}>
              <option value="public">public</option><option value="internal">internal</option><option value="confidential">confidential (approval to open)</option><option value="restricted">restricted (hidden unless cleared)</option>
            </Select>
            <Select id="upload-category" label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </Select>
          </div>
          <label htmlFor="upload-file" className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">File</span>
            <input id="upload-file" type="file" required={!file} aria-describedby="file-hint" className="block w-full text-sm" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <span id="file-hint" className="mt-1 block text-xs text-muted">Up to 25 MB. {file ? `${file.name} · ${formatBytes(file.size)}` : ''}</span>
            {fileError && <span role="alert" className="mt-1 block text-xs text-danger-600">{fileError}</span>}
          </label>
          {status.kind === 'busy' && <Progress progress={status.progress} />}
          {status.kind === 'error' && (
            <Alert tone="danger" title={status.message}>
              {status.pending && <Button type="button" variant="secondary" className="mt-2" onClick={() => void run(status.pending)}>Retry upload</Button>}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={status.kind === 'busy'}>Upload</Button>
            <Button type="button" variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function describe(err: ApiError): string {
  if (err.body.fieldErrors?.length) return `${err.message}: ${err.body.fieldErrors.map((f) => `${f.path.replace(/^body\./, '')} ${f.message}`).join('; ')}`;
  if (err.code === 'legal_hold') return 'This document is under legal hold.';
  return err.message;
}

function Progress({ progress }: { progress: UploadProgress }) {
  const label = progress.phase === 'creating' ? 'Registering document…' : progress.phase === 'uploading' ? `Uploading ${progress.percent}%` : progress.phase === 'finalizing' ? 'Verifying and scanning…' : 'Done';
  return (
    <div>
      <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-2 w-full overflow-hidden rounded-full bg-navy-100">
        <div className="h-full bg-cobalt-500 transition-all" style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted" aria-live="polite">{label}</p>
    </div>
  );
}
