import { Router } from 'express';
import {
  calculateCommission,
  getCommissionSummary,
  getCommissions,
  getCommissionById,
  updateCommissionStatus,
  approveCommission,
  rejectCommission,
  markCommissionAsPaid,
  getAvailableBalance,
  getEligibleCommissions,
  bulkApproveCommissions,
  getCommissionAnalytics,
  batchCalculateCommissions,
  recalculateCommission,
  getProductCommissionPerformance,
  processAutomatedCommissionUpdates,
  getCommissionLifecycleStats,
  getCommissionStatusHistory,
  processClawback,
  processPartialClawback,
  applyManualAdjustment,
  getCommissionAdjustments,
  getCommissionWithAdjustments,
  getClawbackStatistics
} from '../controllers/commission';
import { authenticate } from '../middleware/auth';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Commission calculation and management
router.post('/calculate', calculateCommission);
router.post('/batch-calculate', batchCalculateCommissions);

// Commission retrieval
router.get('/summary/:marketerId', getCommissionSummary);
router.get('/balance/:marketerId', getAvailableBalance);
router.get('/', getCommissions);
router.get('/:id', getCommissionById);

// Commission status management
router.put('/:id/status', updateCommissionStatus);
router.put('/:id/approve', approveCommission);
router.put('/:id/reject', rejectCommission);
router.put('/:id/mark-paid', markCommissionAsPaid);
router.put('/:id/recalculate', recalculateCommission);

// Clawback and adjustment management (admin only)
router.post('/:id/clawback', processClawback);
router.post('/:id/partial-clawback', processPartialClawback);
router.post('/:id/adjustment', applyManualAdjustment);
router.get('/:id/adjustments', getCommissionAdjustments);
router.get('/:id/with-adjustments', getCommissionWithAdjustments);

// Commission history and audit
router.get('/:id/history', getCommissionStatusHistory);

// Bulk operations (admin only)
router.get('/eligible/approval', getEligibleCommissions);
router.post('/bulk/approve', bulkApproveCommissions);
router.post('/automated/process', processAutomatedCommissionUpdates);

// Analytics and reporting
router.get('/analytics/data', getCommissionAnalytics);
router.get('/analytics/lifecycle', getCommissionLifecycleStats);
router.get('/analytics/clawback', getClawbackStatistics);
router.get('/analytics/product/:productId', getProductCommissionPerformance);

export default router;