import { Router } from 'express';
import * as payoutController from '../controllers/payout';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All payout routes require authentication
router.use(authenticate);

// Marketer routes
// POST /api/v1/payouts/request - Create payout request
router.post('/request', payoutController.createPayoutRequest);

// GET /api/v1/payouts - Get marketer's payout requests
router.get('/', payoutController.getPayoutRequests);

// GET /api/v1/payouts/balance - Get balance summary
router.get('/balance', payoutController.getBalanceSummary);

// GET /api/v1/payouts/:id - Get specific payout request
router.get('/:id', payoutController.getPayoutRequest);

// PUT /api/v1/payouts/:id/cancel - Cancel payout request
router.put('/:id/cancel', payoutController.cancelPayoutRequest);

// Admin routes (these will be mounted at /api/v1/admin/payouts in main routes)
export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

// GET /api/v1/admin/payouts - Get all payout requests (admin only)
adminRouter.get('/', payoutController.getAllPayoutRequests);

// PUT /api/v1/admin/payouts/:id/status - Update payout status (admin only)
adminRouter.put('/:id/status', payoutController.updatePayoutStatus);

// POST /api/v1/admin/payouts/:id/process - Process single payout through gateway (admin only)
adminRouter.post('/:id/process', payoutController.processPayout);

// POST /api/v1/admin/payouts/bulk-process - Bulk process payouts (admin only)
adminRouter.post('/bulk-process', payoutController.bulkProcessPayouts);

// GET /api/v1/admin/payouts/stats - Get bulk processing statistics (admin only)
adminRouter.get('/stats', payoutController.getBulkProcessingStats);

export default router;