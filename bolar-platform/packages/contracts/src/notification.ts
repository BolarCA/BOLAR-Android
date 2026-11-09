// notification contracts (Day 28): channel, template, recipient, delivery status, retry.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';
import { templateKeySchema } from './template.js';

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'in_app'] as const;
export const NOTIFICATION_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'suppressed'] as const;

/** Recipient address is never returned by the API nor written to logs; only the recipient id is exposed. */
export const notification = z
  .object({
    id: idSchema, channel: z.enum(NOTIFICATION_CHANNELS), recipientId: z.string(), templateKey: templateKeySchema, variables: z.record(z.string(), z.unknown()),
    status: z.enum(NOTIFICATION_STATUSES), attempts: z.number().int(), lastError: z.string().nullable(), sentAt: z.string().nullable(), readAt: z.string().nullable(), createdAt: z.string(),
    /** Rendered subject/body for in-app display (present for in_app notifications and for senders). */
    subject: z.string().nullable().optional(), body: z.string().optional(),
  })
  .openapi('Notification');
export const notificationPage = pageOf(notification, 'Notification');

export const notificationQuery = paginationQuery.extend({
  status: z.enum(NOTIFICATION_STATUSES).optional(), channel: z.enum(NOTIFICATION_CHANNELS).optional(), unread: z.coerce.boolean().optional(), recipientId: idSchema.optional(),
});

export const sendNotification = z
  .object({
    recipientUserId: idSchema, channel: z.enum(NOTIFICATION_CHANNELS), templateKey: templateKeySchema,
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
  })
  .openapi('SendNotification');

export type NotificationDto = z.infer<typeof notification>;
export type SendNotificationDto = z.infer<typeof sendNotification>;
