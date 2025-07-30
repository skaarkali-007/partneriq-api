import express from 'express';
import { getDashboardData, getCommissionDetails } from '../controllers/marketer';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// GET /api/v1/marketer/dashboard - Get marketer dashboard data
router.get('/dashboard', getDashboardData);

// GET /api/v1/marketer/commission-details - Get detailed commission information
router.get('/commission-details', getCommissionDetails);

export default router;