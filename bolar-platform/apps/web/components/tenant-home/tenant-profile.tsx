'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useTenantProfile, type ContactMethodDto, type EmergencyContactDto, type TenantProfileDetailDto } from '@/lib/hooks/tenant-profile';
import { useMfaSetup, useMfaVerify, useMyTenantProfileId } from '@/lib/hooks/portal-home';
import { Alert, Badge, Button, Card, Input, PageHeader, statusTone } from '@/components/ui';
import { EmptyState, StateView } from '@/components/ui/state-view';

/**
 * Resident profile (p48 "profile"): own TenantProfile (contacts, emergency contacts, occupants) read through the
 * self-access path of GET /tenant-profiles/:id, plus sign-in security with the TOTP enrolment flow.
 */
export function TenantProfile() {
  const { me } = useAuth();
  const mine = useMyTenantProfileId();
  return (
    <>
      <PageHeader title="Profile" description="Your contact details, emergency contacts and sign-in security. Ask your property manager to change anything shown as read-only." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Account">
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-muted">Name</dt><dd className="mt-0.5 font-medium text-navy-900">{me?.actor.name}</dd></div>
            <div><dt className="text-muted">Sign-in email</dt><dd className="mt-0.5 font-medium text-navy-900">{me?.actor.email}</dd></div>
            <div><dt className="text-muted">Organization</dt><dd className="mt-0.5 font-medium text-navy-900">{me?.org.name}</dd></div>
          </dl>
        </Card>
        <SecurityCard />
        <div className="md:col-span-2">
          {mine.isLoading ? <div role="status" aria-busy="true" className="h-40 animate-pulse rounded-[14px] bg-navy-100"><span className="sr-only">Loading profile</span></div>
            : mine.error ? <Alert tone="danger" title="We couldn't load your tenant profile">{mine.error instanceof ApiError ? mine.error.message : 'Try again in a moment.'}</Alert>
            : mine.profileId ? <ProfileDetails id={mine.profileId} />
            : <EmptyState title="No tenant profile linked yet" description={mine.hasLease ? 'Your lease exists but is not linked to this login. Your property manager can connect it.' : 'Your contact and emergency details appear here once your property manager links a lease to this login.'} />}
        </div>
      </div>
      <p className="mt-6 text-sm"><Link href="/tenant" className="inline-flex min-h-11 items-center font-semibold text-cobalt-700 hover:underline">← Back to home</Link></p>
    </>
  );
}

function ProfileDetails({ id }: { id: string }) {
  const q = useTenantProfile(id);
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} skeleton="detail" onRetry={() => void q.refetch()} resource={{ type: 'tenant_profile', id, classification: 'confidential' }}>
      {(p) => <ProfileBody profile={p} />}
    </StateView>
  );
}

function ProfileBody({ profile: p }: { profile: TenantProfileDetailDto }) {
  const primaryContacts: { label: string; value: string | null }[] = [{ label: 'Email', value: p.email }, { label: 'Phone', value: p.phone }];
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="tenant-profile">
      <Card title="Contact methods" actions={<Badge tone={statusTone(p.status)}>{p.status}</Badge>}>
        <ul className="divide-y divide-line">
          {primaryContacts.map((c) => <li key={c.label} className="flex items-center justify-between gap-3 py-3"><span className="text-sm text-muted">{c.label}</span><span className="font-medium text-navy-900">{c.value ?? '—'}</span></li>)}
          {p.contacts.map((c: ContactMethodDto) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <span className="text-sm capitalize text-muted">{c.kind}{c.isPrimary ? ' (primary)' : ''}</span>
              <span className="font-medium text-navy-900">{c.value ?? '—'}{c.verifiedAt && <Badge tone="success">verified</Badge>}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Contact changes go through your property manager so the lease record stays accurate.</p>
      </Card>
      <Card title="Emergency contacts">
        {p.emergencyContacts.length === 0 ? <EmptyState title="No emergency contact on file" description="Tell your property manager who to call in an emergency; it is stored confidentially." /> : (
          <ul className="divide-y divide-line">
            {p.emergencyContacts.map((e: EmergencyContactDto) => (
              <li key={e.id} className="py-3"><p className="font-medium text-navy-900">{e.name ?? '—'}</p><p className="text-sm text-muted">{e.relationship} · {e.phone ?? '—'}</p></li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Household">
        {p.occupants.length === 0 ? <p className="text-sm text-muted">No additional occupants are listed on your lease.</p> : (
          <ul className="divide-y divide-line">{p.occupants.map((o) => <li key={o.id} className="flex items-center justify-between py-3"><span className="font-medium text-navy-900">{o.name}</span><span className="text-sm text-muted">{o.relationship.replace(/_/g, ' ')}{o.isMinor ? ' · minor' : ''}</span></li>)}</ul>
        )}
      </Card>
      <Card title="Privacy">
        <p className="text-sm text-ink">Your profile is classified <Badge tone="violet">{p.classification}</Badge>. Staff see sensitive fields only with an approved purpose, and every access is audited. You may request a copy or deletion of your data at any time.</p>
        <p className="mt-3 text-sm text-muted">Active leases on this profile: {p.activeLeaseCount}</p>
      </Card>
    </div>
  );
}

/** TOTP enrolment: POST /auth/mfa/setup gives the secret; POST /auth/mfa/verify with the first code enables MFA. */
function SecurityCard() {
  const { me } = useAuth();
  const setup = useMfaSetup();
  const verify = useMfaVerify();
  const [code, setCode] = useState('');
  const enabled = Boolean(me?.actor.mfaEnabled);
  return (
    <Card title="Sign-in security" actions={<Badge tone={enabled ? 'success' : 'warning'}>{enabled ? 'Two-step on' : 'Two-step off'}</Badge>}>
      <div data-testid="mfa-status" data-enabled={enabled}>
        {enabled ? (
          <p className="text-sm text-ink">Two-step verification protects your account. You will be asked for a code from your authenticator app when signing in on a new device.</p>
        ) : setup.data ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); verify.mutate(code, { onSuccess: () => setCode('') }); }}>
            <p className="text-sm text-ink">Add this key to an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
            <p className="break-all rounded-lg bg-navy-50 p-3 font-mono text-sm" aria-label="Setup key">{setup.data.secret}</p>
            <Input label="6-digit code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            {verify.isError && <Alert tone="danger" title={verify.error instanceof ApiError ? verify.error.message : 'Verification failed'} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>Turn on two-step</Button>
              <Button type="button" variant="secondary" onClick={() => { setup.reset(); setCode(''); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-ink">Add a second step to sign in: a code from an authenticator app on your phone. Recommended before paying rent online.</p>
            {setup.isError && <div className="mt-2"><Alert tone="danger" title={setup.error instanceof ApiError ? setup.error.message : 'Could not start setup'} /></div>}
            <Button className="mt-4" onClick={() => setup.mutate()} loading={setup.isPending}>Set up two-step verification</Button>
          </>
        )}
      </div>
    </Card>
  );
}
