import { Router } from 'express';
import { AdminReportingController } from '../controllers/adminReporting';
import { authenticate } from '../middleware/auth';
import { adminAuthenticate } from '../middleware/adminAuth';

const router = Router();

// Apply authentication and admin authorization to all routes
router.use(authenticate);
router.use(adminAuthenticate);

/**
 * @route GET /api/v1/admin-reporting/platform-performance
 * @desc Get platform-wide performance dashboard
 * @access Private (Admin only)
 * @query startDate, endDate
 */
router.get('/platform-performance', AdminReportingController.getPlatformPerformanceDashboard);

/**
 * @route GET /api/v1/admin-reporting/financial
 * @desc Get financial report for commission and payouts
 * @access Private (Admin only)
 * @query startDate, endDate
 */
router.get('/financial', AdminReportingController.getFinancialReport);

/**
 * @route GET /api/v1/admin-reporting/compliance
 * @desc Get compliance report for audit purposes
 * @access Private (Admin only)
 * @query startDate, endDate
 */
router.get('/compliance', AdminReportingController.getComplianceReport);

/**
 * @route GET /api/v1/admin-reporting/dashboard
 * @desc Get comprehensive admin dashboard with all reports
 * @access Private (Admin only)
 * @query startDate, endDate
 */
router.get('/dashboard', AdminReportingController.getAdminDashboard);

/**
 * @route GET /api/v1/admin-reporting/export
 * @desc Export report data in various formats
 * @access Private (Admin only)
 * @query reportType, startDate, endDate, format?
 */
router.get('/export', AdminReportingController.exportReport);

/**
 * @route GET /api/v1/admin-reporting/history
 * @desc Get report generation status and history
 * @access Private (Admin only)
 * @query page?, limit?, reportType?
 */
router.get('/history', AdminReportingController.getReportHistory);

export default router;