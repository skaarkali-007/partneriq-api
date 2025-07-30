import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics';
import { authenticate } from '../middleware/auth';
import { requireAdminMFA } from '../middleware/adminAuth';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route GET /api/v1/analytics/performance
 * @desc Get performance metrics
 * @access Private (Marketer/Admin)
 * @query startDate, endDate, marketerId?, productId?
 */
router.get('/performance', AnalyticsController.getPerformanceMetrics);

/**
 * @route GET /api/v1/analytics/conversions
 * @desc Get conversion analytics
 * @access Private (Marketer/Admin)
 * @query startDate, endDate, marketerId?
 */
router.get('/conversions', AnalyticsController.getConversionAnalytics);

/**
 * @route GET /api/v1/analytics/realtime
 * @desc Get real-time metrics
 * @access Private (Marketer/Admin)
 */
router.get('/realtime', AnalyticsController.getRealtimeMetrics);

/**
 * @route POST /api/v1/analytics/reports/custom
 * @desc Generate custom report
 * @access Private (Marketer/Admin)
 * @body reportType, filters?, groupBy?, sortBy?, limit?
 */
router.post('/reports/custom', AnalyticsController.generateCustomReport);

/**
 * @route GET /api/v1/analytics/reports/export
 * @desc Export report data
 * @access Private (Marketer/Admin)
 * @query reportType, filters?, groupBy?, sortBy?, format?
 */
router.get('/reports/export', AnalyticsController.exportReportData);

/**
 * @route GET /api/v1/analytics/dashboard/summary
 * @desc Get dashboard summary for current marketer
 * @access Private (Marketer)
 */
router.get('/dashboard/summary', AnalyticsController.getDashboardSummary);

// Admin-only routes
/**
 * @route POST /api/v1/analytics/realtime/initialize
 * @desc Initialize real-time analytics
 * @access Private (Admin only)
 */
router.post('/realtime/initialize', requireAdminMFA, AnalyticsController.initializeRealtimeAnalytics);

/**
 * @route GET /api/v1/analytics/admin/overview
 * @desc Get admin analytics overview
 * @access Private (Admin only)
 * @query period? (days)
 */
router.get('/admin/overview', requireAdminMFA, AnalyticsController.getAdminAnalyticsOverview);

export default router;