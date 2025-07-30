import { Router } from 'express';
import authRoutes from './auth';
import mfaRoutes from './mfa';
import profileRoutes from './profile';
import productRoutes from './product';
import trackingRoutes from './tracking';
import commissionRoutes from './commission';
import paymentMethodRoutes, { adminRouter as paymentMethodAdminRoutes } from './paymentMethod';
import payoutRoutes, { adminRouter as payoutAdminRoutes } from './payout';
import adminRoutes from './admin';
import adminCustomersRoutes from './adminCustomers';
import consentRoutes from './consent';
import gdprRoutes, { adminRouter as gdprAdminRoutes } from './gdpr';
import customerRoutes from './customer';
import landingRoutes from './landing';
import analyticsRoutes from './analytics';
import marketerAnalyticsRoutes from './marketerAnalytics';
import marketerRoutes from './marketer';
import adminReportingRoutes from './adminReporting';
import { authenticate } from '../middleware/auth';

const router = Router();

// Mount route modules
router.use('/auth', authRoutes);
router.use('/mfa', mfaRoutes);
router.use('/profile', profileRoutes);
router.use('/products', productRoutes);
router.use('/tracking', trackingRoutes);
router.use('/commissions', commissionRoutes);
router.use('/payment-methods', paymentMethodRoutes);
router.use('/payouts', payoutRoutes);
router.use('/consent', consentRoutes);
router.use('/gdpr', gdprRoutes);
router.use('/customers', customerRoutes);
router.use('/landing', landingRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/marketer-analytics', marketerAnalyticsRoutes);
router.use('/marketer', marketerRoutes);
router.use('/admin-reporting', adminReportingRoutes);

// Admin routes (require authentication)
router.use('/admin', adminRoutes);
router.use('/admin/customers', authenticate, adminCustomersRoutes);
router.use('/admin/payment-methods', authenticate, paymentMethodAdminRoutes);
router.use('/admin/payouts', authenticate, payoutAdminRoutes);
router.use('/admin/gdpr', authenticate, gdprAdminRoutes);

// Health check for API
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router;