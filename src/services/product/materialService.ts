import { ProductMaterial, IProductMaterial } from '../../models/ProductMaterial';
import { Product } from '../../models/Product';
import { PaginationOptions, PaginatedResponse } from '../../types';
import { logger } from '../../utils/logger';
import fs from 'fs/promises';
import path from 'path';

export interface CreateMaterialData {
  productId: string;
  materialType: 'banner' | 'email_template' | 'fact_sheet' | 'image' | 'document';
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  dimensions?: string;
  tags?: string[];
  isActive?: boolean;
}

export interface UpdateMaterialData extends Partial<Omit<CreateMaterialData, 'productId' | 'fileUrl' | 'fileName' | 'fileSize' | 'mimeType'>> {}

export interface MaterialSearchOptions extends Partial<PaginationOptions> {
  productId?: string;
  materialType?: 'banner' | 'email_template' | 'fact_sheet' | 'image' | 'document';
  isActive?: boolean;
  tags?: string[];
}

export class ProductMaterialService {
  /**
   * Create a new product material
   */
  static async createMaterial(materialData: CreateMaterialData): Promise<IProductMaterial> {
    try {
      // Verify that the product exists
      const product = await Product.findById(materialData.productId);
      if (!product) {
        throw new Error('Product not found');
      }

      const material = new ProductMaterial(materialData);
      await material.save();
      
      logger.info(`Product material created: ${material.title} for product ${materialData.productId}`);
      return material;
    } catch (error: any) {
      logger.error('Error creating product material:', error);
      throw error;
    }
  }

  /**
   * Get material by ID
   */
  static async getMaterialById(materialId: string): Promise<IProductMaterial | null> {
    try {
      const material = await ProductMaterial.findById(materialId);
      return material;
    } catch (error: any) {
      logger.error('Error fetching material by ID:', error);
      throw error;
    }
  }

  /**
   * Update material
   */
  static async updateMaterial(materialId: string, updateData: UpdateMaterialData): Promise<IProductMaterial | null> {
    try {
      const material = await ProductMaterial.findByIdAndUpdate(
        materialId,
        updateData,
        { new: true, runValidators: true }
      );
      
      if (material) {
        logger.info(`Product material updated: ${material.title} (${material._id})`);
      }
      
      return material;
    } catch (error: any) {
      logger.error('Error updating product material:', error);
      throw error;
    }
  }

  /**
   * Delete material
   */
  static async deleteMaterial(materialId: string): Promise<boolean> {
    try {
      const material = await ProductMaterial.findById(materialId);
      if (!material) {
        return false;
      }

      // Delete the physical file if it exists
      try {
        const filePath = path.join(process.cwd(), 'uploads', 'materials', path.basename(material.fileUrl));
        await fs.unlink(filePath);
        logger.info(`Deleted file: ${filePath}`);
      } catch (fileError) {
        logger.warn(`Could not delete file: ${material.fileUrl}`, fileError);
        // Continue with database deletion even if file deletion fails
      }

      const result = await ProductMaterial.findByIdAndDelete(materialId);
      
      if (result) {
        logger.info(`Product material deleted: ${result.title} (${result._id})`);
        return true;
      }
      
      return false;
    } catch (error: any) {
      logger.error('Error deleting product material:', error);
      throw error;
    }
  }

  /**
   * Get materials with pagination and filtering
   */
  static async getMaterials(options: MaterialSearchOptions): Promise<PaginatedResponse<IProductMaterial>> {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        productId,
        materialType,
        isActive,
        tags
      } = options;

      // Build query
      const query: any = {};
      
      if (productId) {
        query.productId = productId;
      }
      
      if (materialType) {
        query.materialType = materialType;
      }
      
      if (isActive !== undefined) {
        query.isActive = isActive;
      }
      
      if (tags && tags.length > 0) {
        query.tags = { $in: tags };
      }

      // Build sort object
      const sort: any = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

      // Execute query with pagination
      const skip = (page - 1) * limit;
      const [materials, total] = await Promise.all([
        ProductMaterial.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit),
        ProductMaterial.countDocuments(query)
      ]);

      const pages = Math.ceil(total / limit);

      return {
        success: true,
        data: materials,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      };
    } catch (error: any) {
      logger.error('Error fetching product materials:', error);
      throw error;
    }
  }

  /**
   * Get materials by product ID
   */
  static async getMaterialsByProduct(productId: string, options: Omit<MaterialSearchOptions, 'productId'> = {}): Promise<PaginatedResponse<IProductMaterial>> {
    return this.getMaterials({ ...options, productId });
  }

  /**
   * Get active materials by product ID
   */
  static async getActiveMaterialsByProduct(productId: string, options: Omit<MaterialSearchOptions, 'productId' | 'isActive'> = {}): Promise<PaginatedResponse<IProductMaterial>> {
    return this.getMaterials({ ...options, productId, isActive: true });
  }

  /**
   * Get materials by type
   */
  static async getMaterialsByType(materialType: 'banner' | 'email_template' | 'fact_sheet' | 'image' | 'document', options: Omit<MaterialSearchOptions, 'materialType'> = {}): Promise<PaginatedResponse<IProductMaterial>> {
    return this.getMaterials({ ...options, materialType });
  }

  /**
   * Get all unique material types for a product
   */
  static async getMaterialTypes(productId?: string): Promise<string[]> {
    try {
      const query = productId ? { productId } : {};
      const types = await ProductMaterial.distinct('materialType', query);
      return types.sort();
    } catch (error: any) {
      logger.error('Error fetching material types:', error);
      throw error;
    }
  }

  /**
   * Get all unique tags for materials
   */
  static async getMaterialTags(productId?: string): Promise<string[]> {
    try {
      const query = productId ? { productId } : {};
      const tags = await ProductMaterial.distinct('tags', query);
      return tags.sort();
    } catch (error: any) {
      logger.error('Error fetching material tags:', error);
      throw error;
    }
  }

  /**
   * Get material statistics for a product
   */
  static async getMaterialStats(productId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    byType: Record<string, number>;
  }> {
    try {
      const [total, active, byType] = await Promise.all([
        ProductMaterial.countDocuments({ productId }),
        ProductMaterial.countDocuments({ productId, isActive: true }),
        ProductMaterial.aggregate([
          { $match: { productId } },
          { $group: { _id: '$materialType', count: { $sum: 1 } } }
        ])
      ]);

      const byTypeMap: Record<string, number> = {};
      byType.forEach(item => {
        byTypeMap[item._id] = item.count;
      });

      return {
        total,
        active,
        inactive: total - active,
        byType: byTypeMap
      };
    } catch (error: any) {
      logger.error('Error fetching material stats:', error);
      throw error;
    }
  }
}