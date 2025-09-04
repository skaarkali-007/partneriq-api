import { Router } from 'express';
import { AdminController } from '../controllers/admin';
import { authenticate } from '../middleware/auth';
import { adminAuthenticate, adminRateLimit, logAdminActivity, requireAdminMFA } from '../middleware/adminAuth';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(adminAuthenticate);
router.use(adminRateLimit(200, 15 * 60 * 1000)); // 200 requests per 15 minutes
router.use(logAdminActivity);

// Dashboard and Analytics
router.get('/dashboard/stats', AdminController.getDashboardStats);
router.get('/activity-logs', AdminController.getActivityLogs);
router.get('/activity-logs/export', AdminController.exportActivityLogs);
router.get('/audit/stats', AdminController.getAuditStats);

// User Management
router.get('/users', AdminController.getAllUsers);
router.get('/users/:userId', AdminController.getUserDetails);
router.put('/users/:userId/status', /*requireAdminMFA,*/ AdminController.updateUserStatus);
router.post('/users/bulk-action', /*requireAdminMFA,*/ AdminController.bulkUserAction);

// KYC Management
router.get('/users/:userId/kyc', AdminController.getKYCDocuments);
router.put('/users/:userId/kyc/status', /*requireAdminMFA,*/ AdminController.updateKYCStatus);
router.put('/users/:userId/kyc/documents/:documentId', AdminController.reviewKYCDocument);
router.get('/users/:userId/kyc/documents/:documentId/download', AdminController.downloadKYCDocument);

// Product Management
router.get('/products', AdminController.getAllProductsAdmin);
router.post('/products', AdminController.createProductAdmin); // Temporarily removed requireAdminMFA for development
router.put('/products/:productId', AdminController.updateProductAdmin); // Temporarily removed requireAdminMFA for development
router.delete('/products/:productId', AdminController.deleteProductAdmin); // Temporarily removed requireAdminMFA for development
router.get('/products/:productId/performance', AdminController.getProductPerformance);

// Commission Management
router.get('/commissions', AdminController.getAllCommissionsAdmin);
router.put('/commissions/:commissionId/status', AdminController.updateCommissionStatus); // Temporarily removed requireAdminMFA for development
router.post('/commissions/bulk-update', AdminController.bulkUpdateCommissions); // Temporarily removed requireAdminMFA for development

// Payout Management
router.get('/payouts', AdminController.getAllPayoutsAdmin);
router.put('/payouts/:payoutId/status', /*requireAdminMFA,*/ AdminController.updatePayoutStatusAdmin);
router.post('/payouts/bulk-process', /*requireAdminMFA,*/ AdminController.bulkProcessPayoutsAdmin);
router.get('/payouts/stats', AdminController.getPayoutStats);
router.get('/payouts/export', AdminController.exportPayoutReport);

export default router;