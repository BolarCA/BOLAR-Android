'use client';
import { useMarkNotificationRead, useNotifications, type NotificationDto } from '@/lib/hooks/notification';
import { Badge, Button, Card, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** In-app notification inbox (Day 28): the recipient's own messages, rendered from approved templates. */
export function NotificationsInbox() {
  const q = useNotifications({ channel: 'in_app' });
  const markRead = useMarkNotificationRead();
  return (
    <Card title="Messages">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No messages', description: 'Updates about your requests, invoices and notices appear here.' }} onRetry={() => void q.refetch()} skeleton="cards">
        {(d) => (
          <ul className="divide-y divide-line">
            {d.pages.flatMap((p) => p.items).map((n: NotificationDto) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-navy-900">{n.subject ?? n.templateKey}</p>
                  {n.body && <p className="mt-1 text-sm text-ink">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString()} · <Badge tone={statusTone(n.status)}>{n.status}</Badge></p>
                </div>
                {!n.readAt ? <Button variant="secondary" onClick={() => markRead.mutate(n.id)} aria-label={`Mark "${n.subject ?? n.templateKey}" as read`}>Mark read</Button> : <Badge>read</Badge>}
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </Card>
  );
}
