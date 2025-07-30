import { Router } from 'express';
import { ProductController } from '../controllers/product';
import { ProductMaterialController, upload } from '../controllers/productMaterial';
import { authenticate } from '../middleware/auth';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for product endpoints
const productLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all product routes
router.use(productLimiter);

// Public routes (no authentication required)
router.get('/search', ProductController.searchProducts);
router.get('/active', ProductController.getActiveProducts);
router.get('/categories', ProductController.getCategories);
router.get('/tags', ProductController.getTags);
router.get('/discover', ProductController.getProductsForMarketers);
router.get('/recommendations', ProductController.getRecommendedProducts);
router.get('/stats', ProductController.getProductStats);

// Public routes for materials (no authentication required)
router.get('/:productId/materials/active', ProductMaterialController.getActiveMaterialsByProduct);

// Protected routes (authentication required)
router.use(authenticate);

// Protected routes for materials (specific routes before general ones)
router.get('/materials/types', ProductMaterialController.getMaterialTypes);
router.get('/materials/tags', ProductMaterialController.getMaterialTags);
router.get('/materials/:id', ProductMaterialController.getMaterialById);
router.get('/materials', ProductMaterialController.getMaterials);

// Admin-only routes for materials
router.post('/materials/upload', upload.single('file'), ProductMaterialController.uploadMaterial);
router.put('/materials/:id', ProductMaterialController.updateMaterial);
router.delete('/materials/:id', ProductMaterialController.deleteMaterial);

// Routes accessible by both marketers and admins
router.get('/', ProductController.getProducts);
router.get('/:productId/materials/stats', ProductMaterialController.getMaterialStats);
router.get('/:productId/materials', ProductMaterialController.getMaterialsByProduct);
router.get('/:id', ProductController.getProductById);

// Admin-only routes (will need role-based middleware in the future)
router.post('/', ProductController.createProduct);
router.put('/:id', ProductController.updateProduct);
router.delete('/:id', ProductController.deleteProduct);

export default router;