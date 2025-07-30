import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Product, IProduct } from '../Product';

describe('Product Model', () => {
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

  describe('Product Creation', () => {
    it('should create a product with valid percentage-based commission', async () => {
      const productData = {
        name: 'Investment Fund A',
        description: 'A high-yield investment fund for long-term growth',
        category: 'Investment',
        commissionType: 'percentage' as const,
        commissionRate: 0.05, // 5%
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/investment-fund-a',
        tags: ['investment', 'high-yield', 'long-term']
      };

      const product = new Product(productData);
      const savedProduct = await product.save();

      expect(savedProduct.name).toBe(productData.name);
      expect(savedProduct.description).toBe(productData.description);
      expect(savedProduct.category).toBe(productData.category);
      expect(savedProduct.commissionType).toBe(productData.commissionType);
      expect(savedProduct.commissionRate).toBe(productData.commissionRate);
      expect(savedProduct.minInitialSpend).toBe(productData.minInitialSpend);
      expect(savedProduct.landingPageUrl).toBe(productData.landingPageUrl);
      expect(savedProduct.tags).toEqual(productData.tags);
      expect(savedProduct.status).toBe('active'); // Default value
      expect(savedProduct.createdAt).toBeDefined();
      expect(savedProduct.updatedAt).toBeDefined();
    });

    it('should create a product with valid flat-rate commission', async () => {
      const productData = {
        name: 'Real Estate Investment',
        description: 'Commercial real estate investment opportunity',
        category: 'Real Estate',
        commissionType: 'flat' as const,
        commissionFlatAmount: 500,
        minInitialSpend: 10000,
        landingPageUrl: 'https://example.com/real-estate',
        status: 'inactive' as const
      };

      const product = new Product(productData);
      const savedProduct = await product.save();

      expect(savedProduct.commissionType).toBe('flat');
      expect(savedProduct.commissionFlatAmount).toBe(500);
      expect(savedProduct.status).toBe('inactive');
      expect(savedProduct.tags).toEqual([]); // Default empty array
    });

    it('should set default values correctly', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      const savedProduct = await product.save();

      expect(savedProduct.status).toBe('active');
      expect(savedProduct.tags).toEqual([]);
      expect(savedProduct.commissionType).toBe('percentage');
    });

    it('should require all mandatory fields', async () => {
      const product = new Product({});
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate name length', async () => {
      const productData = {
        name: 'a'.repeat(256), // Exceeds 255 character limit
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate description length', async () => {
      const productData = {
        name: 'Test Product',
        description: 'a'.repeat(2001), // Exceeds 2000 character limit
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate category length', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'a'.repeat(101), // Exceeds 100 character limit
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate landing page URL format', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'invalid-url'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate commission type enum', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'invalid' as any,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate status enum', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test',
        status: 'invalid' as any
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate commission rate range', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 1.5, // Exceeds 100%
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate negative commission rate', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: -0.1,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate negative commission flat amount', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'flat' as const,
        commissionFlatAmount: -100,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate negative minimum initial spend', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: -500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should validate maximum number of tags', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test',
        tags: Array(21).fill('tag') // Exceeds 20 tag limit
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });
  });

  describe('Commission Validation', () => {
    it('should require commission rate for percentage-based commissions', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        // commissionRate missing
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should require commission flat amount for flat-rate commissions', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'flat' as const,
        // commissionFlatAmount missing
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      
      await expect(product.save()).rejects.toThrow();
    });

    it('should allow commission rate to be undefined for flat-rate commissions', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'flat' as const,
        commissionFlatAmount: 100,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      const savedProduct = await product.save();
      
      expect(savedProduct.commissionRate).toBeUndefined();
      expect(savedProduct.commissionFlatAmount).toBe(100);
    });

    it('should allow commission flat amount to be undefined for percentage-based commissions', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.05,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test'
      };

      const product = new Product(productData);
      const savedProduct = await product.save();
      
      expect(savedProduct.commissionRate).toBe(0.05);
      expect(savedProduct.commissionFlatAmount).toBeUndefined();
    });
  });

  describe('JSON Transformation', () => {
    it('should transform _id to id and remove internal fields', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage' as const,
        commissionRate: 0.05,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/test',
        tags: ['test', 'product']
      };

      const product = new Product(productData);
      await product.save();

      const productJson = product.toJSON();

      expect(productJson.id).toBeDefined();
      expect(productJson.name).toBe(productData.name);
      expect(productJson.description).toBe(productData.description);
      expect(productJson.category).toBe(productData.category);
      expect(productJson.commissionType).toBe(productData.commissionType);
      expect(productJson.commissionRate).toBe(productData.commissionRate);
      expect(productJson.minInitialSpend).toBe(productData.minInitialSpend);
      expect(productJson.landingPageUrl).toBe(productData.landingPageUrl);
      expect(productJson.tags).toEqual(productData.tags);
      expect(productJson.status).toBe('active');
      expect(productJson.createdAt).toBeDefined();
      expect(productJson.updatedAt).toBeDefined();

      // Internal fields should be excluded
      expect(productJson._id).toBeUndefined();
      expect(productJson.__v).toBeUndefined();
    });
  });

  describe('Indexes', () => {
    it('should create products and verify they can be found by indexed fields', async () => {
      const products = [
        {
          name: 'Investment Fund A',
          description: 'High-yield investment',
          category: 'Investment',
          commissionType: 'percentage' as const,
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/fund-a',
          tags: ['investment', 'high-yield'],
          status: 'active' as const
        },
        {
          name: 'Real Estate Fund',
          description: 'Commercial real estate',
          category: 'Real Estate',
          commissionType: 'flat' as const,
          commissionFlatAmount: 500,
          minInitialSpend: 5000,
          landingPageUrl: 'https://example.com/real-estate',
          tags: ['real-estate', 'commercial'],
          status: 'inactive' as const
        }
      ];

      await Product.insertMany(products);

      // Test finding by name
      const foundByName = await Product.findOne({ name: 'Investment Fund A' });
      expect(foundByName).toBeTruthy();

      // Test finding by category
      const foundByCategory = await Product.find({ category: 'Investment' });
      expect(foundByCategory).toHaveLength(1);

      // Test finding by status
      const activeProducts = await Product.find({ status: 'active' });
      expect(activeProducts).toHaveLength(1);

      // Test finding by tags
      const foundByTags = await Product.find({ tags: 'investment' });
      expect(foundByTags).toHaveLength(1);
    });
  });
});