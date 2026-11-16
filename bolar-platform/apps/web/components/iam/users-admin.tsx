'use client';
import { useState } from 'react';
import { ROLES } from '@bolar/shared';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCreateInvitation, useInvitations, useRevokeInvitation, useUpdateUser, useUsers, type InvitationDto, type UserDto } from '@/lib/hooks/iam';
import { Badge, Button, Card, Drawer, Input, PageHeader, Select, Table, Alert, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Day 11 "staff invitation UI": users table, invite drawer, revoke, suspend. Shared by /admin/users and /subaccount/users. */
export function UsersAdmin() {
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const users = useUsers({ q: q || undefined });
  const invites = useInvitations();
  const update = useUpdateUser();
  const revoke = useRevokeInvitation();
  const canInvite = me?.permissions.includes('user:invite' as never);
  const canWrite = me?.permissions.includes('user:write' as never);

  return (
    <>
      <PageHeader title="Staff and roles" description="Invite staff, review scoped role assignments, and suspend accounts. Every change is audited." actions={canInvite && <Button onClick={() => setInviteOpen(true)}>Invite user</Button>} />
      <div className="mb-4 max-w-sm"><Input label="Search" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="space-y-8">
        <StateView isLoading={users.isLoading} error={users.error} data={users.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void users.refetch()}
          empty={{ title: 'No users yet', description: 'Invite your first staff member to get started.', action: canInvite && <Button onClick={() => setInviteOpen(true)}>Invite user</Button> }}>
          {(d) => (
            <>
              <Table<UserDto> caption="Users" rows={d.pages.flatMap((p) => p.items)} columns={[
                { key: 'name', header: 'User', render: (u) => <div><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></div> },
                { key: 'roles', header: 'Roles', render: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r, i) => <Badge key={i} tone="info">{r.role.replace(/_/g, ' ')}{r.scopeType !== 'org' ? ` · ${r.scopeType}` : ''}</Badge>)}</div> },
                { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.status)}>{u.status}</Badge> },
                { key: 'mfa', header: 'MFA', render: (u) => (u.mfaEnabled ? <Badge tone="success">enabled</Badge> : <Badge>off</Badge>) },
                { key: 'actions', header: '', className: 'text-right', render: (u) => canWrite && u.id !== me?.actor.id ? (
                  u.status === 'active'
                    ? <Button variant="secondary" onClick={() => update.mutate({ id: u.id, status: 'suspended' })} aria-label={`Suspend ${u.name}`}>Suspend</Button>
                    : <Button variant="secondary" onClick={() => update.mutate({ id: u.id, status: 'active' })} aria-label={`Reactivate ${u.name}`}>Reactivate</Button>
                ) : null },
              ]} />
              {users.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void users.fetchNextPage()} loading={users.isFetchingNextPage}>Load more</Button></div>}
            </>
          )}
        </StateView>
        {update.isError && <Alert tone="danger" title={update.error instanceof ApiError ? update.error.message : 'Update failed'} />}

        <Card title="Invitations">
          <StateView isLoading={invites.isLoading} error={invites.error} data={invites.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No invitations', description: 'Pending, accepted, expired and revoked invitations appear here.' }} onRetry={() => void invites.refetch()}>
            {(d) => (
              <Table<InvitationDto> caption="Invitations" rows={d.pages.flatMap((p) => p.items)} columns={[
                { key: 'email', header: 'Email', render: (i) => i.email },
                { key: 'role', header: 'Role', render: (i) => <Badge tone="info">{i.role.replace(/_/g, ' ')}</Badge> },
                { key: 'status', header: 'Status', render: (i) => <Badge tone={statusTone(i.status)}>{i.status}</Badge> },
                { key: 'expires', header: 'Expires', render: (i) => new Date(i.expiresAt).toLocaleDateString() },
                { key: 'actions', header: '', className: 'text-right', render: (i) => (i.status === 'pending' && canInvite ? <Button variant="ghost" onClick={() => revoke.mutate(i.id)} aria-label={`Revoke invitation for ${i.email}`}>Revoke</Button> : null) },
              ]} />
            )}
          </StateView>
        </Card>
      </div>
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

function InviteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateInvitation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('property_manager');
  const invitable = ROLES.filter((r) => r !== 'platform_admin' && r !== 'support_agent');
  return (
    <Drawer open={open} onClose={onClose} title="Invite a user">
      {create.isSuccess ? (
        <div className="space-y-4">
          <Alert tone="success" title={`Invitation sent to ${create.data.email}`}>{create.data.acceptUrl && <p className="mt-2 break-all text-xs">Local accept link: <a className="underline" href={create.data.acceptUrl}>{create.data.acceptUrl}</a></p>}</Alert>
          <Button onClick={() => { create.reset(); setEmail(''); onClose(); }}>Done</Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ email, role }); }}>
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            {invitable.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </Select>
          <p className="text-xs text-muted">Org-wide scope. Property- and case-scoped roles can be added after the user accepts.</p>
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not send invitation'} />}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Send invitation</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}
