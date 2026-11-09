import { DocumentsList } from '@/components/documents/documents-list';
import { NotificationsInbox } from '@/components/documents/notifications-inbox';
export default function Page() {
  return (
    <div className="space-y-8">
      <DocumentsList scope="tenant" />
      <NotificationsInbox />
    </div>
  );
}
