import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import * as GDPRController from '../controllers/gdpr';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for GDPR operations (more restrictive due to sensitive nature)
const gdprLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many GDPR requests, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Admin rate limiter (slightly more permissive)
const adminGdprLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many admin GDPR requests, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// User GDPR routes (authenticated users can manage their own data)
router.use(authenticate);

/**
 * @route GET /api/v1/gdpr/data-summary
 * @desc Get user data summary
 * @access Private
 */
router.get('/data-summary', gdprLimiter, GDPRController.getUserDataSummary);

/**
 * @route GET /api/v1/gdpr/export
 * @desc Export user data for portability (GDPR Article 20)
 * @access Private
 */
router.get('/export', gdprLimiter, GDPRController.exportUserData);

/**
 * @route POST /api/v1/gdpr/rectify
 * @desc Rectify user data (GDPR Article 16)
 * @access Private
 */
router.post('/rectify', 
  gdprLimiter,
  [
    body('rectifications')
      .isArray({ min: 1 })
      .withMessage('Rectifications must be a non-empty array'),
    body('rectifications.*.field')
      .notEmpty()
      .withMessage('Field is required for each rectification'),
    body('rectifications.*.newValue')
      .exists()
      .withMessage('New value is required for each rectification'),
    body('rectifications.*.reason')
      .optional()
      .isString()
      .withMessage('Reason must be a string')
  ],
  GDPRController.rectifyUserData
);

/**
 * @route GET /api/v1/gdpr/deletion-eligibility
 * @desc Check if user data can be deleted
 * @access Private
 */
router.get('/deletion-eligibility', gdprLimiter, GDPRController.checkDeletionEligibility);

/**
 * @route DELETE /api/v1/gdpr/delete
 * @desc Request user data deletion (GDPR Article 17)
 * @access Private
 */
router.delete('/delete',
  gdprLimiter,
  [
    body('reason')
      .optional()
      .isString()
      .withMessage('Reason must be a string')
  ],
  GDPRController.requestDataDeletion
);

// Admin GDPR routes
const adminRouter = Router();
adminRouter.use(requireRole('admin'));

/**
 * @route DELETE /api/v1/admin/gdpr/users/:userId/delete
 * @desc Admin delete user data
 * @access Admin
 */
adminRouter.delete('/users/:userId/delete',
  adminGdprLimiter,
  [
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required'),
    body('reason')
      .optional()
      .isString()
      .withMessage('Reason must be a string')
  ],
  GDPRController.adminDeleteUserData
);

/**
 * @route POST /api/v1/admin/gdpr/users/:userId/anonymize
 * @desc Admin anonymize user data
 * @access Admin
 */
adminRouter.post('/users/:userId/anonymize',
  adminGdprLimiter,
  [
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required'),
    body('reason')
      .optional()
      .isString()
      .withMessage('Reason must be a string')
  ],
  GDPRController.adminAnonymizeUserData
);

export { adminRouter };
export default router;