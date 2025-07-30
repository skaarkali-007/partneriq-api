import { Router } from 'express';
import {
  startOnboarding,
  updatePersonalInfo,
  updateSimplePersonalInfo,
  uploadKYCDocuments,
  completeSignature,
  getOnboardingStatus,
  validateStepData,
  uploadMiddleware,
  recordConversion,
  getDetailedCustomerStatus,
  getMarketerCustomers,
  getOnboardingAnalytics,
  updateCustomerStatus
} from '../controllers/customer';

const router = Router();

// Start customer onboarding process
router.post('/onboarding/start', startOnboarding);

// Get customer onboarding status
router.get('/onboarding/:customerId/status', getOnboardingStatus);

// Update personal information (Step 1)
router.put('/onboarding/:customerId/personal-info', updatePersonalInfo);

// Update simple personal information (Step 1 for simple onboarding)
router.put('/onboarding/:customerId/simple-personal-info', updateSimplePersonalInfo);

// Upload KYC documents (Step 2)
router.post('/onboarding/:customerId/kyc-documents', uploadMiddleware, uploadKYCDocuments);

// Complete e-signature (Step 3)
router.post('/onboarding/:customerId/signature', completeSignature);

// Validate step data
router.post('/onboarding/validate/:step', validateStepData);

// Record conversion when customer makes initial spend
router.post('/:customerId/conversion', recordConversion);

// Get detailed customer status (for marketers)
router.get('/:customerId/detailed-status', getDetailedCustomerStatus);

// Get customers for a marketer
router.get('/marketer/:marketerId/customers', getMarketerCustomers);

// Get onboarding analytics for a marketer
router.get('/marketer/:marketerId/analytics', getOnboardingAnalytics);

// Update customer status (admin only)
router.put('/:customerId/status', updateCustomerStatus);

export default router;