import { Router } from 'express';
import { AuthController } from '../controllers/auth';
import { authenticate } from '../middleware/auth';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for auth endpoints
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 5, // limit each IP to 5 requests per windowMs
//   message: {
//     success: false,
//     error: 'Too many authentication attempts, please try again later'
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// const generalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 10, // limit each IP to 10 requests per windowMs
//   message: {
//     success: false,
//     error: 'Too many requests, please try again later'
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Authentication routes
router.post('/register', /*generalLimiter,*/ AuthController.register);
router.post('/login', /*authLimiter,*/ AuthController.login);
router.post('/refresh',/*generalLimiter,*/ AuthController.refreshToken);
router.get('/verify-email/:token', AuthController.verifyEmail);
router.post('/resend-verification', /*generalLimiter,*/ AuthController.resendVerification);
router.post('/send-email-otp', /*generalLimiter,*/ AuthController.sendEmailOTP);
router.post('/verify-email-otp', /*generalLimiter,*/ AuthController.verifyEmailOTP);
router.post('/request-password-reset', /*generalLimiter,*/ AuthController.requestPasswordReset);
router.post('/reset-password', /*authLimiter,*/ AuthController.resetPassword);

// User info route
router.get('/me', /*generalLimiter,*/ authenticate, AuthController.getCurrentUser);

// KYC skip route
router.post('/skip-kyc', /*generalLimiter,*/ authenticate, AuthController.skipKYC);

// Development helper routes
router.get('/check-environment', AuthController.checkEnvironment);
router.post('/activate-account', AuthController.activateAccount);

export default router;