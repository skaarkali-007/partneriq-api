import { Router } from 'express';
import { MFAController } from '../controllers/mfa';
import { authenticate, requireEmailVerification } from '../middleware/auth';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for MFA endpoints
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    error: 'Too many MFA attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const mfaSetupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 setup attempts per hour
  message: {
    success: false,
    error: 'Too many MFA setup attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// All MFA routes require authentication and email verification
router.use(authenticate);
router.use(requireEmailVerification);

// MFA management routes
router.post('/setup', mfaSetupLimiter, MFAController.setupMFA);
router.post('/verify-setup', mfaLimiter, MFAController.verifyAndEnableMFA);
router.post('/verify', mfaLimiter, MFAController.verifyMFA);
router.post('/disable', mfaLimiter, MFAController.disableMFA);
router.post('/regenerate-backup-codes', mfaLimiter, MFAController.regenerateBackupCodes);
router.get('/status', MFAController.getMFAStatus);

export default router;