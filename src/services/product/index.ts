import { Product, IProduct } from '../../models/Product';
import { PaginationOptions, PaginatedResponse } from '../../types';
import { logger } from '../../utils/logger';

export interface CreateProductData {
  name: string;
  description: string;
  category: string;
  commissionType: 'percentage' | 'flat';
  commissionRate?: number;
  commissionFlatAmount?: number;
  minInitialSpend: number;
  status?: 'active' | 'inactive';
  landingPageUrl: string;
  tags?: string[];
}

export interface UpdateProductData extends Partial<CreateProductData> {}

export interface ProductSearchOptions extends Partial<PaginationOptions> {
  category?: string;
  status?: 'active' | 'inactive';
  tags?: string[];
  search?: string;
  minCommissionRate?: number;
  maxCommissionRate?: number;
  minInitialSpend?: number;
  maxInitialSpend?: number;
  commissionType?: 'percentage' | 'flat';
}

export class ProductService {
  /**
   * Create a new product
   */
  static async createProduct(productData: CreateProductData): Promise<IProduct> {
    try {
      // Validate commission structure
      if (productData.commissionType === 'percentage' && !productData.commissionRate) {
        throw new Error('Commission rate is required for percentage-based commissions');
      }
      
      if (productData.commissionType === 'flat' && !productData.commissionFlatAmount) {
        throw new Error('Commission flat amount is required for flat-rate commissions');
      }

      const product = new Product(productData);
      await product.save();
      
      logger.info(`Product created: ${product.name} (${product._id})`);
      return product;
    } catch (error: any) {
      logger.error('Error creating product:', error);
      throw error;
    }
  }

  /**
   * Get product by ID
   */
  static async getProductById(productId: string): Promise<IProduct | null> {
    try {
      const product = await Product.findById(productId);
      return product;
    } catch (error: any) {
      logger.error('Error fetching product by ID:', error);
      throw error;
    }
  }

  /**
   * Update product
   */
  static async updateProduct(productId: string, updateData: UpdateProductData): Promise<IProduct | null> {
    try {
      // Validate commission structure if being updated
      if (updateData.commissionType === 'percentage' && updateData.commissionRate === undefined) {
        throw new Error('Commission rate is required for percentage-based commissions');
      }
      
      if (updateData.commissionType === 'flat' && updateData.commissionFlatAmount === undefined) {
        throw new Error('Commission flat amount is required for flat-rate commissions');
      }

      const product = await Product.findByIdAndUpdate(
        productId,
        updateData,
        { new: true, runValidators: true }
      );
      
      if (product) {
        logger.info(`Product updated: ${product.name} (${product._id})`);
      }
      
      return product;
    } catch (error: any) {
      logger.error('Error updating product:', error);
      throw error;
    }
  }

  /**
   * Delete product
   */
  static async deleteProduct(productId: string): Promise<boolean> {
    try {
      const result = await Product.findByIdAndDelete(productId);
      
      if (result) {
        logger.info(`Product deleted: ${result.name} (${result._id})`);
        return true;
      }
      
      return false;
    } catch (error: any) {
      logger.error('Error deleting product:', error);
      throw error;
    }
  }

  /**
   * Get all products with pagination and filtering
   */
  static async getProducts(options: ProductSearchOptions): Promise<PaginatedResponse<IProduct>> {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        category,
        status,
        tags,
        search,
        minCommissionRate,
        maxCommissionRate,
        minInitialSpend,
        maxInitialSpend,
        commissionType
      } = options;

      // Build query
      const query: any = {};
      
      if (category) {
        query.category = category;
      }
      
      if (status) {
        query.status = status;
      }
      
      if (tags && tags.length > 0) {
        query.tags = { $in: tags };
      }
      
      if (commissionType) {
        query.commissionType = commissionType;
      }
      
      // Commission rate filtering (only for percentage-based commissions)
      if (minCommissionRate !== undefined || maxCommissionRate !== undefined) {
        query.commissionType = 'percentage';
        query.commissionRate = {};
        
        if (minCommissionRate !== undefined) {
          query.commissionRate.$gte = minCommissionRate;
        }
        
        if (maxCommissionRate !== undefined) {
          query.commissionRate.$lte = maxCommissionRate;
        }
      }
      
      // Initial spend filtering
      if (minInitialSpend !== undefined || maxInitialSpend !== undefined) {
        query.minInitialSpend = {};
        
        if (minInitialSpend !== undefined) {
          query.minInitialSpend.$gte = minInitialSpend;
        }
        
        if (maxInitialSpend !== undefined) {
          query.minInitialSpend.$lte = maxInitialSpend;
        }
      }
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } }
        ];
      }

      // Build sort object
      const sort: any = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

      // Execute query with pagination
      const skip = (page - 1) * limit;
      const [products, total] = await Promise.all([
        Product.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit),
        Product.countDocuments(query)
      ]);

      const pages = Math.ceil(total / limit);

      return {
        success: true,
        data: products,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      };
    } catch (error: any) {
      logger.error('Error fetching products:', error);
      throw error;
    }
  }

  /**
   * Get active products only (for marketers)
   */
  static async getActiveProducts(options: Omit<ProductSearchOptions, 'status'>): Promise<PaginatedResponse<IProduct>> {
    return this.getProducts({ ...options, status: 'active' });
  }

  /**
   * Get products by category
   */
  static async getProductsByCategory(category: string, options: Omit<ProductSearchOptions, 'category'>): Promise<PaginatedResponse<IProduct>> {
    return this.getProducts({ ...options, category });
  }

  /**
   * Get all unique categories
   */
  static async getCategories(): Promise<string[]> {
    try {
      const categories = await Product.distinct('category');
      return categories.sort();
    } catch (error: any) {
      logger.error('Error fetching categories:', error);
      throw error;
    }
  }

  /**
   * Get all unique tags
   */
  static async getTags(): Promise<string[]> {
    try {
      const tags = await Product.distinct('tags');
      return tags.sort();
    } catch (error: any) {
      logger.error('Error fetching tags:', error);
      throw error;
    }
  }

  /**
   * Advanced search for products with comprehensive filtering
   * This method provides enhanced search capabilities for marketers
   */
  static async searchProducts(options: ProductSearchOptions): Promise<PaginatedResponse<IProduct>> {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        category,
        status = 'active', // Default to active products for public search
        tags,
        search,
        minCommissionRate,
        maxCommissionRate,
        minInitialSpend,
        maxInitialSpend,
        commissionType
      } = options;

      // Build advanced query with text search
      const query: any = { status }; // Always filter by status for public search
      
      if (category) {
        query.category = category;
      }
      
      if (tags && tags.length > 0) {
        query.tags = { $in: tags };
      }
      
      if (commissionType) {
        query.commissionType = commissionType;
      }
      
      // Commission rate filtering (only for percentage-based commissions)
      if (minCommissionRate !== undefined || maxCommissionRate !== undefined) {
        query.commissionType = 'percentage';
        query.commissionRate = {};
        
        if (minCommissionRate !== undefined) {
          query.commissionRate.$gte = minCommissionRate;
        }
        
        if (maxCommissionRate !== undefined) {
          query.commissionRate.$lte = maxCommissionRate;
        }
      }
      
      // Initial spend filtering
      if (minInitialSpend !== undefined || maxInitialSpend !== undefined) {
        query.minInitialSpend = {};
        
        if (minInitialSpend !== undefined) {
          query.minInitialSpend.$gte = minInitialSpend;
        }
        
        if (maxInitialSpend !== undefined) {
          query.minInitialSpend.$lte = maxInitialSpend;
        }
      }
      
      // Enhanced text search with scoring
      if (search) {
        const searchRegex = new RegExp(search.split(' ').join('|'), 'i');
        query.$or = [
          { name: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $regex: searchRegex } }
        ];
      }

      // Build sort object with multiple sort criteria
      const sort: any = {};
      
      // Primary sort
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      // Secondary sort by creation date for consistency
      if (sortBy !== 'createdAt') {
        sort.createdAt = -1;
      }

      // Execute query with pagination
      const skip = (page - 1) * limit;
      const [products, total] = await Promise.all([
        Product.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit),
        Product.countDocuments(query)
      ]);

      const pages = Math.ceil(total / limit);

      return {
        success: true,
        data: products,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      };
    } catch (error: any) {
      logger.error('Error searching products:', error);
      throw error;
    }
  }

  /**
   * Get products with enhanced filtering for marketers
   * This method provides status-based visibility controls
   */
  static async getProductsForMarketers(options: Omit<ProductSearchOptions, 'status'>): Promise<PaginatedResponse<IProduct>> {
    // Marketers should only see active products
    return this.searchProducts({ ...options, status: 'active' });
  }

  /**
   * Get product recommendations based on category and tags
   */
  static async getRecommendedProducts(
    category?: string, 
    tags?: string[], 
    limit: number = 5
  ): Promise<IProduct[]> {
    try {
      const query: any = { status: 'active' };
      
      if (category || (tags && tags.length > 0)) {
        query.$or = [];
        
        if (category) {
          query.$or.push({ category });
        }
        
        if (tags && tags.length > 0) {
          query.$or.push({ tags: { $in: tags } });
        }
      }

      const products = await Product.find(query)
        .sort({ createdAt: -1 })
        .limit(limit);

      return products;
    } catch (error: any) {
      logger.error('Error fetching recommended products:', error);
      throw error;
    }
  }

  /**
   * Get product statistics for analytics
   */
  static async getProductStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    byCategory: { [key: string]: number };
    byCommissionType: { percentage: number; flat: number };
  }> {
    try {
      const [
        total,
        active,
        inactive,
        categoryStats,
        commissionTypeStats
      ] = await Promise.all([
        Product.countDocuments(),
        Product.countDocuments({ status: 'active' }),
        Product.countDocuments({ status: 'inactive' }),
        Product.aggregate([
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        Product.aggregate([
          { $group: { _id: '$commissionType', count: { $sum: 1 } } }
        ])
      ]);

      const byCategory: { [key: string]: number } = {};
      categoryStats.forEach((stat: any) => {
        byCategory[stat._id] = stat.count;
      });

      const byCommissionType = { percentage: 0, flat: 0 };
      commissionTypeStats.forEach((stat: any) => {
        byCommissionType[stat._id as 'percentage' | 'flat'] = stat.count;
      });

      return {
        total,
        active,
        inactive,
        byCategory,
        byCommissionType
      };
    } catch (error: any) {
      logger.error('Error fetching product stats:', error);
      throw error;
    }
  }
}