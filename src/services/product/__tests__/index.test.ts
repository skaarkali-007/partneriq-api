import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProductService, CreateProductData, UpdateProductData } from '../index';
import { Product } from '../../../models/Product';

describe('ProductService', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Product.deleteMany({});
  });

  describe('createProduct', () => {
    it('should create a product with percentage-based commission', async () => {
      const productData: CreateProductData = {
        name: 'Investment Fund A',
        description: 'A high-yield investment fund',
        category: 'Investment',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/fund-a',
        tags: ['investment', 'high-yield']
      };

      const product = await ProductService.createProduct(productData);

      expect(product.name).toBe(productData.name);
      expect(product.commissionType).toBe('percentage');
      expect(product.commissionRate).toBe(0.05);
      expect(product.status).toBe('active');
      expect(product.tags).toEqual(['investment', 'high-yield']);
    });

    it('should create a product with flat-rate commission', async () => {
      const productData: CreateProductData = {
        name: 'Real Estate Investment',
        description: 'Commercial real estate opportunity',
        category: 'Real Estate',
        commissionType: 'flat',
        commissionFlatAmount: 500,
        minInitialSpend: 10000,
        landingPageUrl: 'https://example.com/real-estate',
        status: 'inactive'
      };

      const product = await ProductService.createProduct(productData);

      expect(product.commissionType).toBe('flat');
      expect(product.commissionFlatAmount).toBe(500);
      expect(product.status).toBe('inactive');
    });

    it('should throw error if commission rate is missing for percentage-based commission', async () => {
      const productData: CreateProductData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage',
        // commissionRate missing
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/test'
      };

      await expect(ProductService.createProduct(productData)).rejects.toThrow(
        'Commission rate is required for percentage-based commissions'
      );
    });

    it('should throw error if commission flat amount is missing for flat-rate commission', async () => {
      const productData: CreateProductData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'flat',
        // commissionFlatAmount missing
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/test'
      };

      await expect(ProductService.createProduct(productData)).rejects.toThrow(
        'Commission flat amount is required for flat-rate commissions'
      );
    });
  });

  describe('getProductById', () => {
    it('should return product by ID', async () => {
      const productData: CreateProductData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const createdProduct = await ProductService.createProduct(productData);
      const foundProduct = await ProductService.getProductById(createdProduct._id);

      expect(foundProduct).toBeTruthy();
      expect(foundProduct!.name).toBe(productData.name);
      expect(foundProduct!._id.toString()).toBe(createdProduct._id.toString());
    });

    it('should return null for non-existent product', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const product = await ProductService.getProductById(nonExistentId);

      expect(product).toBeNull();
    });
  });

  describe('updateProduct', () => {
    let productId: string;

    beforeEach(async () => {
      const productData: CreateProductData = {
        name: 'Original Product',
        description: 'Original description',
        category: 'Original',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/original'
      };

      const product = await ProductService.createProduct(productData);
      productId = product._id;
    });

    it('should update product successfully', async () => {
      const updateData: UpdateProductData = {
        name: 'Updated Product',
        description: 'Updated description',
        commissionRate: 0.05,
        status: 'inactive'
      };

      const updatedProduct = await ProductService.updateProduct(productId, updateData);

      expect(updatedProduct).toBeTruthy();
      expect(updatedProduct!.name).toBe('Updated Product');
      expect(updatedProduct!.description).toBe('Updated description');
      expect(updatedProduct!.commissionRate).toBe(0.05);
      expect(updatedProduct!.status).toBe('inactive');
      expect(updatedProduct!.category).toBe('Original'); // Unchanged
    });

    it('should return null for non-existent product', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const updateData: UpdateProductData = { name: 'Updated' };

      const result = await ProductService.updateProduct(nonExistentId, updateData);

      expect(result).toBeNull();
    });

    it('should validate commission structure when updating commission type', async () => {
      const updateData: UpdateProductData = {
        commissionType: 'flat'
        // commissionFlatAmount missing
      };

      await expect(ProductService.updateProduct(productId, updateData)).rejects.toThrow(
        'Commission flat amount is required for flat-rate commissions'
      );
    });
  });

  describe('deleteProduct', () => {
    let productId: string;

    beforeEach(async () => {
      const productData: CreateProductData = {
        name: 'Product to Delete',
        description: 'This product will be deleted',
        category: 'Test',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/delete'
      };

      const product = await ProductService.createProduct(productData);
      productId = product._id;
    });

    it('should delete product successfully', async () => {
      const result = await ProductService.deleteProduct(productId);

      expect(result).toBe(true);

      // Verify product is deleted
      const deletedProduct = await ProductService.getProductById(productId);
      expect(deletedProduct).toBeNull();
    });

    it('should return false for non-existent product', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const result = await ProductService.deleteProduct(nonExistentId);

      expect(result).toBe(false);
    });
  });

  describe('getProducts', () => {
    beforeEach(async () => {
      const products: CreateProductData[] = [
        {
          name: 'Investment Fund A',
          description: 'High-yield investment fund',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/fund-a',
          tags: ['investment', 'high-yield'],
          status: 'active'
        },
        {
          name: 'Real Estate Fund',
          description: 'Commercial real estate investment',
          category: 'Real Estate',
          commissionType: 'flat',
          commissionFlatAmount: 500,
          minInitialSpend: 5000,
          landingPageUrl: 'https://example.com/real-estate',
          tags: ['real-estate', 'commercial'],
          status: 'active'
        },
        {
          name: 'Inactive Product',
          description: 'This product is inactive',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.02,
          minInitialSpend: 100,
          landingPageUrl: 'https://example.com/inactive',
          status: 'inactive'
        }
      ];

      await Promise.all(products.map(p => ProductService.createProduct(p)));
    });

    it('should return all products with default pagination', async () => {
      const result = await ProductService.getProducts({});

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter products by category', async () => {
      const result = await ProductService.getProducts({ category: 'Investment' });

      expect(result.data).toHaveLength(1);
      expect(result.data![0].category).toBe('Investment');
    });

    it('should filter products by status', async () => {
      const result = await ProductService.getProducts({ status: 'active' });

      expect(result.data).toHaveLength(2);
      result.data!.forEach(product => {
        expect(product.status).toBe('active');
      });
    });

    it('should filter products by tags', async () => {
      const result = await ProductService.getProducts({ tags: ['investment'] });

      expect(result.data).toHaveLength(1);
      expect(result.data![0].tags).toContain('investment');
    });

    it('should search products by name, description, or category', async () => {
      const result = await ProductService.getProducts({ search: 'investment' });

      expect(result.data!.length).toBeGreaterThan(0);
      result.data!.forEach(product => {
        const searchText = `${product.name} ${product.description} ${product.category}`.toLowerCase();
        expect(searchText).toContain('investment');
      });
    });

    it('should handle pagination correctly', async () => {
      const result = await ProductService.getProducts({ page: 1, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.pages).toBe(2);
    });

    it('should sort products correctly', async () => {
      const result = await ProductService.getProducts({ 
        sortBy: 'name', 
        sortOrder: 'asc' 
      });

      expect(result.data![0].name).toBe('Inactive Product');
      expect(result.data![1].name).toBe('Investment Fund A');
      expect(result.data![2].name).toBe('Real Estate Fund');
    });

    it('should filter products by commission type', async () => {
      const result = await ProductService.getProducts({ commissionType: 'percentage' });

      expect(result.data).toHaveLength(2);
      result.data!.forEach(product => {
        expect(product.commissionType).toBe('percentage');
      });
    });

    it('should filter products by commission rate range', async () => {
      const result = await ProductService.getProducts({ 
        minCommissionRate: 0.04,
        maxCommissionRate: 0.06
      });

      expect(result.data).toHaveLength(1);
      expect(result.data![0].commissionRate).toBe(0.05);
      expect(result.data![0].commissionType).toBe('percentage');
    });

    it('should filter products by initial spend range', async () => {
      const result = await ProductService.getProducts({ 
        minInitialSpend: 2000,
        maxInitialSpend: 10000
      });

      expect(result.data).toHaveLength(1);
      expect(result.data![0].minInitialSpend).toBe(5000);
    });

    it('should search products including tags', async () => {
      const result = await ProductService.getProducts({ search: 'high-yield' });

      expect(result.data!.length).toBeGreaterThan(0);
      result.data!.forEach(product => {
        const searchableText = `${product.name} ${product.description} ${product.category} ${product.tags.join(' ')}`.toLowerCase();
        expect(searchableText).toContain('high-yield');
      });
    });

    it('should combine multiple filters correctly', async () => {
      const result = await ProductService.getProducts({ 
        status: 'active',
        category: 'Investment',
        tags: ['investment'],
        minCommissionRate: 0.04
      });

      expect(result.data).toHaveLength(1);
      const product = result.data![0];
      expect(product.status).toBe('active');
      expect(product.category).toBe('Investment');
      expect(product.tags).toContain('investment');
      expect(product.commissionRate).toBeGreaterThanOrEqual(0.04);
    });
  });

  describe('getActiveProducts', () => {
    beforeEach(async () => {
      const products: CreateProductData[] = [
        {
          name: 'Active Product 1',
          description: 'Active product',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/active1',
          status: 'active'
        },
        {
          name: 'Inactive Product',
          description: 'Inactive product',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/inactive',
          status: 'inactive'
        }
      ];

      await Promise.all(products.map(p => ProductService.createProduct(p)));
    });

    it('should return only active products', async () => {
      const result = await ProductService.getActiveProducts({});

      expect(result.data).toHaveLength(1);
      expect(result.data![0].status).toBe('active');
      expect(result.data![0].name).toBe('Active Product 1');
    });
  });

  describe('getProductsByCategory', () => {
    beforeEach(async () => {
      const products: CreateProductData[] = [
        {
          name: 'Investment Product',
          description: 'Investment product',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/investment'
        },
        {
          name: 'Real Estate Product',
          description: 'Real estate product',
          category: 'Real Estate',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/realestate'
        }
      ];

      await Promise.all(products.map(p => ProductService.createProduct(p)));
    });

    it('should return products from specific category', async () => {
      const result = await ProductService.getProductsByCategory('Investment', {});

      expect(result.data).toHaveLength(1);
      expect(result.data![0].category).toBe('Investment');
    });
  });

  describe('getCategories', () => {
    beforeEach(async () => {
      const products: CreateProductData[] = [
        {
          name: 'Product 1',
          description: 'Description 1',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/1'
        },
        {
          name: 'Product 2',
          description: 'Description 2',
          category: 'Real Estate',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/2'
        },
        {
          name: 'Product 3',
          description: 'Description 3',
          category: 'Investment', // Duplicate category
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/3'
        }
      ];

      await Promise.all(products.map(p => ProductService.createProduct(p)));
    });

    it('should return unique categories sorted alphabetically', async () => {
      const categories = await ProductService.getCategories();

      expect(categories).toEqual(['Investment', 'Real Estate']);
    });
  });

  describe('getTags', () => {
    beforeEach(async () => {
      const products: CreateProductData[] = [
        {
          name: 'Product 1',
          description: 'Description 1',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/1',
          tags: ['investment', 'high-yield']
        },
        {
          name: 'Product 2',
          description: 'Description 2',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/2',
          tags: ['real-estate', 'commercial', 'investment'] // Duplicate tag
        }
      ];

      await Promise.all(products.map(p => ProductService.createProduct(p)));
    });

    it('should return unique tags sorted alphabetically', async () => {
      const tags = await ProductService.getTags();

      expect(tags).toEqual(['commercial', 'high-yield', 'investment', 'real-estate']);
    });
  });
});