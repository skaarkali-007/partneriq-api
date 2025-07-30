import { Router } from 'express';
import { MarketerAnalyticsController } from '../controllers/marketerAnalytics';
import { authenticate } from '../middleware/auth';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route GET /api/v1/marketer-analytics/me
 * @desc Get current marketer's analytics dashboard
 * @access Private (Marketer)
 * @query startDate, endDate, marketingSpend?
 */
router.get('/me', MarketerAnalyticsController.getCurrentMarketerAnalytics);

/**
 * @route GET /api/v1/marketer-analytics/:marketerId/conversion-rate
 * @desc Get conversion rate analysis for a marketer
 * @access Private (Marketer/Admin)
 * @query startDate, endDate
 */
router.get('/:marketerId/conversion-rate', MarketerAnalyticsController.getConversionRateAnalysis);

/**
 * @route GET /api/v1/marketer-analytics/:marketerId/commission-trends
 * @desc Get commission trend analysis for a marketer
 * @access Private (Marketer/Admin)
 * @query startDate, endDate
 */
router.get('/:marketerId/commission-trends', MarketerAnalyticsController.getCommissionTrendAnalysis);

/**
 * @route GET /api/v1/marketer-analytics/:marketerId/acquisition-cost
 * @desc Get customer acquisition cost analysis for a marketer
 * @access Private (Marketer/Admin)
 * @query startDate, endDate, marketingSpend?
 */
router.get('/:marketerId/acquisition-cost', MarketerAnalyticsController.getCustomerAcquisitionCost);

/**
 * @route GET /api/v1/marketer-analytics/:marketerId/benchmark
 * @desc Get performance benchmark for a marketer
 * @access Private (Marketer/Admin)
 * @query startDate, endDate
 */
router.get('/:marketerId/benchmark', MarketerAnalyticsController.getPerformanceBenchmark);

/**
 * @route GET /api/v1/marketer-analytics/:marketerId/dashboard
 * @desc Get comprehensive marketer analytics dashboard
 * @access Private (Marketer/Admin)
 * @query startDate, endDate, marketingSpend?
 */
router.get('/:marketerId/dashboard', MarketerAnalyticsController.getMarketerDashboard);

export default router;