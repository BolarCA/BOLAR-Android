import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';
import { registerWebhookProvider, onWebhook } from '../integrations/routes.js';
import { accountRoutes } from './accounts/routes.js';
import { ledgerRoutes } from './ledger/routes.js';
import { invoiceRoutes } from './invoice/routes.js';
import { paymentRoutes } from './payment/routes.js';
import { getPaymentProvider, handlePaymentWebhook } from './payment/service.js';

/**
 * Finance module (blueprint Days 36-40): chart of accounts, double-entry ledger with approval-gated adjustments,
 * invoices and rent schedules, payments through the provider adapter, bank-link stubs and the bookkeeper summary.
 * Order matters for Express: static paths (`/invoices/aging`) are declared before `/invoices/:id` in each file.
 */
export const financeRoutes: RouteDef[] = [...accountRoutes, ...ledgerRoutes, ...invoiceRoutes, ...paymentRoutes];

export const financeRouter: Router = Router();
mount(financeRouter, financeRoutes);

// Inbound payment webhooks (Day 39): signature verified by the adapter, persisted once by (provider, externalId), then
// mapped onto Payment state with the same allocation/journal logic as the synchronous path.
registerWebhookProvider('stripe', (headers, body) => getPaymentProvider().verifyWebhook(headers, body));
onWebhook('stripe', (event) => handlePaymentWebhook(event));

export { postJournal, reverseJournal, trialBalance, ledgerProof } from './ledger/service.js';
export { generateInvoices, createInvoice, issueInvoice } from './invoice/service.js';
export { createPayment, applyPaymentSuccess, applyPaymentFailure, handlePaymentWebhook, setProvidersForTests } from './payment/service.js';
