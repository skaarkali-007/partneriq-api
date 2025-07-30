import { Router } from 'express';
import * as paymentMethodController from '../controllers/paymentMethod';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All payment method routes require authentication
router.use(authenticate);

// GET /api/v1/payment-methods - Get all payment methods for authenticated user
router.get('/', paymentMethodController.getPaymentMethods);

// GET /api/v1/payment-methods/:id - Get specific payment method
router.get('/:id', paymentMethodController.getPaymentMethod);

// POST /api/v1/payment-methods - Create new payment method
router.post('/', paymentMethodController.createPaymentMethod);

// PUT /api/v1/payment-methods/:id - Update payment method
router.put('/:id', paymentMethodController.updatePaymentMethod);

// DELETE /api/v1/payment-methods/:id - Delete payment method
router.delete('/:id', paymentMethodController.deletePaymentMethod);

// PUT /api/v1/payment-methods/:id/default - Set payment method as default
router.put('/:id/default', paymentMethodController.setDefaultPaymentMethod);

// Admin routes (these will be mounted at /api/v1/admin/payment-methods in main routes)
export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

// PUT /api/v1/admin/payment-methods/:id/verify - Verify payment method (admin only)
adminRouter.put('/:id/verify', paymentMethodController.verifyPaymentMethod);

export default router;