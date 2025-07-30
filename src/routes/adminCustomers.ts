import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { adminAuthenticate } from '../middleware/adminAuth';
import {
  getCustomerApplications,
  getCustomerApplication,
  updateCustomerStatus,
  updateCustomerPayment,
  bulkUpdateCustomerStatus,
  getCustomerApplicationStats
} from '../controllers/adminCustomers';

const router = express.Router();

// Apply authentication and admin role requirement to all routes
router.use(authenticate);
router.use(requireRole('admin'));
router.use(adminAuthenticate);

// Get all customer applications with filtering and pagination
router.get('/applications', getCustomerApplications);

// Get customer application statistics
router.get('/applications/stats', getCustomerApplicationStats);

// Get detailed customer application
router.get('/applications/:customerId', getCustomerApplication);

// Update customer application status
router.put('/applications/:customerId/status', updateCustomerStatus);

// Update customer payment information
router.put('/applications/:customerId/payment', updateCustomerPayment);

// Bulk update customer statuses
router.post('/applications/bulk-status', bulkUpdateCustomerStatus);

export default router;