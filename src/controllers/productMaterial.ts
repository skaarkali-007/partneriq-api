import { Request, Response } from 'express';
import { ProductMaterialService, CreateMaterialData, UpdateMaterialData, MaterialSearchOptions } from '../services/product/materialService';
import { logger } from '../utils/logger';
import Joi from 'joi';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

// Validation schemas
const createMaterialSchema = Joi.object({
  productId: Joi.string().required().messages({
    'any.required': 'Product ID is required'
  }),
  materialType: Joi.string().valid('banner', 'email_template', 'fact_sheet', 'image', 'document').required().messages({
    'any.required': 'Material type is required',
    'any.only': 'Material type must be one of: banner, email_template, fact_sheet, image, document'
  }),
  title: Joi.string().trim().max(255).required().messages({
    'string.max': 'Title cannot exceed 255 characters',
    'any.required': 'Title is required'
  }),
  description: Joi.string().trim().max(1000).optional().messages({
    'string.max': 'Description cannot exceed 1000 characters'
  }),
  dimensions: Joi.string().pattern(/^\d+x\d+$/).optional().messages({
    'string.pattern.base': 'Dimensions must be in format "widthxheight" (e.g., "300x250")'
  }),
  tags: Joi.array().items(Joi.string().trim()).max(10).optional().messages({
    'array.max': 'Cannot have more than 10 tags'
  }),
  isActive: Joi.boolean().optional()
});

const updateMaterialSchema = Joi.object({
  materialType: Joi.string().valid('banner', 'email_template', 'fact_sheet', 'image', 'document').optional(),
  title: Joi.string().trim().max(255).optional(),
  description: Joi.string().trim().max(1000).optional(),
  dimensions: Joi.string().pattern(/^\d+x\d+$/).optional(),
  tags: Joi.array().items(Joi.string().trim()).max(10).optional(),
  isActive: Joi.boolean().optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('title', 'materialType', 'createdAt', 'updatedAt').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  productId: Joi.string().optional(),
  materialType: Joi.string().valid('banner', 'email_template', 'fact_sheet', 'image', 'document').optional(),
  isActive: Joi.boolean().optional(),
  tags: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional()
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'materials');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, '');
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random string
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Define allowed file types
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/html',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only one file at a time
  }
});

export class ProductMaterialController {
  /**
   * Upload and create a new product material
   */
  static async uploadMaterial(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      // Validate request body
      const { error, value } = createMaterialSchema.validate(req.body);
      if (error) {
        // Clean up uploaded file if validation fails
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          logger.warn('Failed to clean up uploaded file:', unlinkError);
        }

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      // Create material data with file information
      const materialData: CreateMaterialData = {
        ...value,
        fileUrl: `/uploads/materials/${req.file.filename}`,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      };

      const material = await ProductMaterialService.createMaterial(materialData);

      res.status(201).json({
        success: true,
        message: 'Material uploaded successfully',
        data: { material }
      });
    } catch (error: any) {
      // Clean up uploaded file if material creation fails
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          logger.warn('Failed to clean up uploaded file:', unlinkError);
        }
      }

      logger.error('Upload material error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to upload material'
      });
    }
  }

  /**
   * Get all materials with filtering and pagination
   */
  static async getMaterials(req: Request, res: Response) {
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

      const result = await ProductMaterialService.getMaterials(value as MaterialSearchOptions);

      res.json(result);
    } catch (error: any) {
      logger.error('Get materials error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch materials'
      });
    }
  }

  /**
   * Get materials by product ID
   */
  static async getMaterialsByProduct(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      if (!productId) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

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

      const result = await ProductMaterialService.getMaterialsByProduct(productId, value);

      res.json(result);
    } catch (error: any) {
      logger.error('Get materials by product error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch materials'
      });
    }
  }

  /**
   * Get active materials by product ID
   */
  static async getActiveMaterialsByProduct(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      if (!productId) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

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

      const result = await ProductMaterialService.getActiveMaterialsByProduct(productId, value);

      res.json(result);
    } catch (error: any) {
      logger.error('Get active materials by product error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active materials'
      });
    }
  }

  /**
   * Get material by ID
   */
  static async getMaterialById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Material ID is required'
        });
      }

      const material = await ProductMaterialService.getMaterialById(id);

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      res.json({
        success: true,
        data: { material }
      });
    } catch (error: any) {
      logger.error('Get material by ID error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material'
      });
    }
  }

  /**
   * Update material (Admin only)
   */
  static async updateMaterial(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Material ID is required'
        });
      }

      // Validate request body
      const { error, value } = updateMaterialSchema.validate(req.body);
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

      const material = await ProductMaterialService.updateMaterial(id, value as UpdateMaterialData);

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      res.json({
        success: true,
        message: 'Material updated successfully',
        data: { material }
      });
    } catch (error: any) {
      logger.error('Update material error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update material'
      });
    }
  }

  /**
   * Delete material (Admin only)
   */
  static async deleteMaterial(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Material ID is required'
        });
      }

      const deleted = await ProductMaterialService.deleteMaterial(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      res.json({
        success: true,
        message: 'Material deleted successfully'
      });
    } catch (error: any) {
      logger.error('Delete material error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete material'
      });
    }
  }

  /**
   * Get material types
   */
  static async getMaterialTypes(req: Request, res: Response) {
    try {
      const { productId } = req.query;
      const types = await ProductMaterialService.getMaterialTypes(productId as string);

      res.json({
        success: true,
        data: { types }
      });
    } catch (error: any) {
      logger.error('Get material types error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material types'
      });
    }
  }

  /**
   * Get material tags
   */
  static async getMaterialTags(req: Request, res: Response) {
    try {
      const { productId } = req.query;
      const tags = await ProductMaterialService.getMaterialTags(productId as string);

      res.json({
        success: true,
        data: { tags }
      });
    } catch (error: any) {
      logger.error('Get material tags error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material tags'
      });
    }
  }

  /**
   * Get material statistics for a product
   */
  static async getMaterialStats(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      if (!productId) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }

      const stats = await ProductMaterialService.getMaterialStats(productId);

      res.json({
        success: true,
        data: { stats }
      });
    } catch (error: any) {
      logger.error('Get material stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material statistics'
      });
    }
  }
}