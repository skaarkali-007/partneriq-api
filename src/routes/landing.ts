import { Router } from 'express';
import {
  handleReferralClick,
  getLandingPageData,
  getProductInfo,
  validateTrackingCode
} from '../controllers/landing';

const router = Router();

// Handle referral link clicks (redirect to frontend)
router.get('/track/:trackingCode', handleReferralClick);

// Get landing page data for frontend
router.get('/data/:trackingCode', getLandingPageData);

// Get product information
router.get('/product/:productId', getProductInfo);

// Validate tracking code
router.get('/validate/:trackingCode', validateTrackingCode);

export default router;