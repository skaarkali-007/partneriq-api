import { Request, Response } from 'express';
import { ProductService, CreateProductData, UpdateProductData, ProductSearchOptions } from '../services/product';
import { logger } from '../utils/logger';
import Joi from 'joi';

// Validation schemas
const createProductSchema = Joi.object({
  name: Joi.string().trim().max(255).required().messages({
    'string.max': 'Product name cannot exceed 255 characters',
    'any.required': 'Product name is required'
  }),
  description: Joi.string().trim().max(2000).required().messages({
    'string.max': 'Product description cannot exceed 2000 characters',
    'any.required': 'Product description is required'
  }),
  category: Joi.string().trim().max(100).required().messages({
    'string.max': 'Category cannot exceed 100 characters',
    'any.required': 'Product category is required'
  }),
  commissionType: Joi.string().valid('percentage', 'flat').required(),
  commissionRate: Joi.number().min(0).max(1).when('commissionType', {
    is: 'percentage',
    then: Joi.required(),
    otherwise: Joi.optional()
  }).messages({
    'number.min': 'Commission rate cannot be negative',
    'number.max': 'Commission rate cannot exceed 100%',
    'any.required': 'Commission rate is required for percentage-based commissions'
  }),
  commissionFlatAmount: Joi.number().min(0).when('commissionType', {
    is: 'flat',
    then: Joi.required(),
    otherwise: Joi.optional()
  }).messages({
    'number.min': 'Commission flat amount cannot be negative',
    'any.required': 'Commission flat amount is required for flat-rate commissions'
  }),
  minInitialSpend: Joi.number().min(0).required().messages({
    'number.min': 'Minimum initial spend cannot be negative',
    'any.required': 'Minimum initial spend is required'
  }),
  status: Joi.string().valid('active', 'inactive').optional(),
  landingPageUrl: Joi.string().uri().required().messages({
    'string.uri': 'Please provide a valid URL',
    'any.required': 'Landing page URL is required'
  }),
  tags: Joi.array().items(Joi.string().trim()).max(20).optional().messages({
    'array.max': 'Cannot have more than 20 tags'
  })
});

const updateProductSchema = Joi.object({
  name: Joi.string().trim().max(255).optional(),
  description: Joi.string().trim().max(2000).optional(),
  category: Joi.string().trim().max(100).optional(),
  commissionType: Joi.string().valid('percentage', 'flat').optional(),
  commissionRate: Joi.number().min(0).max(1).optional(),
  commissionFlatAmount: Joi.number().min(0).optional(),
  minInitialSpend: Joi.number().min(0).optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  landingPageUrl: Joi.string().uri().optional(),
  tags: Joi.array().items(Joi.string().trim()).max(20).optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('name', 'category', 'createdAt', 'updatedAt', 'commissionRate', 'minInitialSpend').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  category: Joi.string().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  tags: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  search: Joi.string().optional(),
  commissionType: Joi.string().valid('percentage', 'flat').optional(),
  minCommissionRate: Joi.number().min(0).max(1).optional(),
  maxCommissionRate: Joi.number().min(0).max(1).optional(),
  minInitialSpend: Joi.number().min(0).optional(),
  maxInitialSpend: Joi.number().min(0).optional()
});

export class ProductController {
  /**
   * Create a new product (Admin only)
   */
  static async createProduct(req: Request, res: Response) {
    try {
      // Validate request body
      const { error, value } = createProductSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const product = await ProductService.createProduct(value as CreateProductData);

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { product }
      });
    } catch (error: any) {
      logger.error('Create product error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create product'
      });
    }
  }

  /**
   * Get all products with filtering and pagination
   */
  static async getProducts(req: Request, res: Response) {
    try {
      // Validate query parameters
      const { error, value } = querySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      // Handle tags parameter (can be string or array)
      if (value.tags && typeof value.tags === 'string') {
        value.tags = value.tags.split(',').map((tag: string) => tag.trim());
      }

      const result = await ProductService.getProducts(value as ProductSearchOptions);

      res.json(result);
    } catch (error: any) {
      logger.error('Get products error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch products'
      });
    }
  }

  /**
   * Get active products only (for marketers)
   */
  static async getActiveProducts(req: Request, res: Response) {
    try {
      // Validate query parameters
      const { error, value } = querySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      // Handle tags parameter
      if (value.tags && typeof value.tags === 'string') {
        value.tags = value.tags.split(',').map((tag: string) => tag.trim());
      }

      const result = await ProductService.getActiveProducts(value);

      res.json(result);
    } catch (error: any) {
      logger.error('Get active products error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active products'
      });
    }
  }

  /**
   * Get product by ID
   */
  static async getProductById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

      const product = await ProductService.getProductById(id);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      res.json({
        success: true,
        data: { product }
      });
    } catch (error: any) {
      logger.error('Get product by ID error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch product'
      });
    }
  }

  /**
   * Update product (Admin only)
   */
  static async updateProduct(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

      // Validate request body
      const { error, value } = updateProductSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const product = await ProductService.updateProduct(id, value as UpdateProductData);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      res.json({
        success: true,
        message: 'Product updated successfully',
        data: { product }
      });
    } catch (error: any) {
      logger.error('Update product error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update product'
      });
    }
  }

  /**
   * Delete product (Admin only)
   */
  static async deleteProduct(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

      const deleted = await ProductService.deleteProduct(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      res.json({
        success: true,
        message: 'Product deleted successfully'
      });
    } catch (error: any) {
      logger.error('Delete product error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete product'
      });
    }
  }

  /**
   * Get all categories
   */
  static async getCategories(req: Request, res: Response) {
    try {
      const categories = await ProductService.getCategories();

      res.json({
        success: true,
        data: { categories }
      });
    } catch (error: any) {
      logger.error('Get categories error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch categories'
      });
    }
  }

  /**
   * Get all tags
   */
  static async getTags(req: Request, res: Response) {
    try {
      const tags = await ProductService.getTags();

      res.json({
        success: true,
        data: { tags }
      });
    } catch (error: any) {
      logger.error('Get tags error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tags'
      });
    }
  }

  /**
   * Advanced search for products with comprehensive filtering
   */
  static async searchProducts(req: Request, res: Response) {
    try {
      // Validate query parameters
      const { error, value } = querySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      // Handle tags parameter (can be string or array)
      if (value.tags && typeof value.tags === 'string') {
        value.tags = value.tags.split(',').map((tag: string) => tag.trim());
      }

      const result = await ProductService.searchProducts(value as ProductSearchOptions);

      res.json({
        ...result,
        message: 'Products search completed successfully'
      });
    } catch (error: any) {
      logger.error('Search products error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search products'
      });
    }
  }

  /**
   * Get products for marketers (active products only)
   */
  static async getProductsForMarketers(req: Request, res: Response) {
    try {
      // Validate query parameters
      const { error, value } = querySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      // Handle tags parameter
      if (value.tags && typeof value.tags === 'string') {
        value.tags = value.tags.split(',').map((tag: string) => tag.trim());
      }

      const result = await ProductService.getProductsForMarketers(value);

      res.json({
        ...result,
        message: 'Marketer products retrieved successfully'
      });
    } catch (error: any) {
      logger.error('Get products for marketers error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch products for marketers'
      });
    }
  }

  /**
   * Get product recommendations
   */
  static async getRecommendedProducts(req: Request, res: Response) {
    try {
      const { category, tags, limit } = req.query;
      
      let parsedTags: string[] | undefined;
      if (tags) {
        parsedTags = typeof tags === 'string' 
          ? tags.split(',').map((tag: string) => tag.trim())
          : tags as string[];
      }

      const parsedLimit = limit ? parseInt(limit as string, 10) : 5;
      
      if (parsedLimit > 20) {
        return res.status(400).json({
          success: false,
          error: 'Limit cannot exceed 20'
        });
      }

      const products = await ProductService.getRecommendedProducts(
        category as string,
        parsedTags,
        parsedLimit
      );

      res.json({
        success: true,
        data: { products },
        message: 'Recommended products retrieved successfully'
      });
    } catch (error: any) {
      logger.error('Get recommended products error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch recommended products'
      });
    }
  }

  /**
   * Get product statistics
   */
  static async getProductStats(req: Request, res: Response) {
    try {
      const stats = await ProductService.getProductStats();

      res.json({
        success: true,
        data: { stats },
        message: 'Product statistics retrieved successfully'
      });
    } catch (error: any) {
      logger.error('Get product stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch product statistics'
      });
    }
  }
}