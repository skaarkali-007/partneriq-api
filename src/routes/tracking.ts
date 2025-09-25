import { Router } from 'express';
import * as TrackingController from '../controllers/tracking';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes (no authentication required)
// Referral link redirect and click tracking
router.get('/track/:trackingCode', TrackingController.handleReferralRedirect);
router.post('/track/:trackingCode/click', TrackingController.trackClick);
router.post('/conversions', TrackingController.recordConversion);
router.post('/conversions/deduplication', TrackingController.recordConversionWithDeduplication);

// Temporary test endpoint for creating referral links without authentication
router.post('/test/links', TrackingController.createReferralLink);

// Protected routes (authentication required)
router.use(authenticate);

// Referral link management routes
router.post('/links', TrackingController.createReferralLink);
router.get('/links/:marketerId', TrackingController.getMarketerReferralLinks);
router.put('/links/:linkId/status', TrackingController.toggleReferralLinkStatus);
router.delete('/links/:linkId', TrackingController.deleteReferralLink);
router.get('/links/:linkId/analytics', TrackingController.getReferralLinkAnalytics);

// Click and conversion tracking data routes
router.get('/clicks/:trackingCode', TrackingController.getClickEvents);
router.get('/conversions/:trackingCode', TrackingController.getConversionEvents);
router.get('/conversions/advanced/search', TrackingController.getAdvancedConversionEvents);

// Analytics routes
router.get('/analytics/conversions', TrackingController.getConversionAnalytics);

// Statistics routes
router.get('/stats/:marketerId', TrackingController.getMarketerStats);

export default router;