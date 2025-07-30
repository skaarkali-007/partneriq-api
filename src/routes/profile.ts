import { Router } from 'express';
import { ProfileController } from '../controllers/profile';
import { authenticate } from '../middleware/auth';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for profile endpoints
const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: {
    success: false,
    error: 'Too many profile requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 uploads per hour
  message: {
    success: false,
    error: 'Too many upload attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware to check admin role
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};

// Profile management routes
router.post('/', profileLimiter, authenticate, ProfileController.createProfile);
router.get('/', profileLimiter, authenticate, ProfileController.getProfile);
router.put('/', profileLimiter, authenticate, ProfileController.updateProfile);

// KYC document routes
router.post('/kyc/upload', uploadLimiter, authenticate, ProfileController.uploadKYCDocument);
router.post('/kyc', uploadLimiter, authenticate, ProfileController.submitKYC);
router.delete('/kyc/documents/:documentId', profileLimiter, authenticate, ProfileController.deleteKYCDocument);

// Compliance quiz route
router.post('/compliance-quiz', profileLimiter, authenticate, ProfileController.submitComplianceQuiz);

// Admin-only routes
router.get('/admin/all', profileLimiter, authenticate, requireAdmin, ProfileController.getAllProfilesForReview);
router.get('/admin/:userId/kyc/documents/:documentId', profileLimiter, authenticate, requireAdmin, ProfileController.getKYCDocument);
router.put('/admin/:userId/kyc/review', profileLimiter, authenticate, requireAdmin, ProfileController.reviewKYC);

export default router;