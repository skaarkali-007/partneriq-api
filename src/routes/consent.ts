import { Router } from 'express';
import {
  recordConsent,
  getCurrentConsent,
  withdrawConsent,
  getConsentHistory,
  createDataAccessRequest,
  verifyDataAccessRequest,
  getDataAccessRequests,
  checkConsentForPurpose
} from '../controllers/consent';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes (no authentication required)
router.post('/record', recordConsent);
router.get('/current', getCurrentConsent);
router.get('/verify/:token', verifyDataAccessRequest);

// Protected routes (authentication required)
router.post('/withdraw', authenticate, withdrawConsent);
router.get('/history', authenticate, getConsentHistory);
router.get('/check/:purpose', authenticate, checkConsentForPurpose);

// Data access request routes (authentication required)
router.post('/data-requests', authenticate, createDataAccessRequest);
router.get('/data-requests', authenticate, getDataAccessRequests);

export default router;