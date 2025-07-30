import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../index';
import { Product } from '../models/Product';
import { User } from '../models/User';
import jwt from 'jsonwebtoken';

describe('Product API Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let authToken: string;
  let adminToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create test users and generate tokens
    const marketer = new User({
      email: 'marketer@test.com',
      password: 'Password123!',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });
    await marketer.save();

    const admin = new User({
      email: 'admin@test.com',
      password: 'Password123!',
      role: 'admin',
      status: 'active',
      emailVerified: true
    });
    await admin.save();

    // Generate JWT tokens using the same format as the app
    const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
    const signOptions: jwt.SignOptions = {
      expiresIn: '1h' as any,
      issuer: 'financial-affiliate-platform',
      audience: 'financial-affiliate-users'
    };

    authToken = jwt.sign(
      { userId: marketer._id, email: marketer.email, role: marketer.role },
      jwtSecret,
      signOptions
    );

    adminToken = jwt.sign(
      { userId: admin._id, email: admin.email, role: admin.role },
      jwtSecret,
      signOptions
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Product.deleteMany({});
  });

  describe('GET /api/v1/products/active', () => {
    it('should return active products without authentication', async () => {
      // Create test products
      await Product.create({
        name: 'Active Product',
        description: 'Active product description',
        category: 'Investment',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/active',
        status: 'active'
      });

      await Product.create({
        name: 'Inactive Product',
        description: 'Inactive product description',
        category: 'Investment',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/inactive',
        status: 'inactive'
      });

      const response = await request(app)
        .get('/api/v1/products/active')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Active Product');
      expect(response.body.data[0].status).toBe('active');
    });
  });

  describe('GET /api/v1/products/categories', () => {
    it('should return unique categories', async () => {
      await Product.create([
        {
          name: 'Product 1',
          description: 'Description 1',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/1'
        },
        {
          name: 'Product 2',
          description: 'Description 2',
          category: 'Real Estate',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/2'
        }
      ]);

      const response = await request(app)
        .get('/api/v1/products/categories')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.categories).toEqual(['Investment', 'Real Estate']);
    });
  });

  describe('POST /api/v1/products', () => {
    it('should create a product with valid data and admin token', async () => {
      const productData = {
        name: 'New Investment Fund',
        description: 'A new high-yield investment fund',
        category: 'Investment',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/new-fund',
        tags: ['investment', 'high-yield']
      };

      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(productData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.product.name).toBe(productData.name);
      expect(response.body.data.product.commissionRate).toBe(productData.commissionRate);
    });

    it('should return 401 without authentication', async () => {
      const productData = {
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/test'
      };

      await request(app)
        .post('/api/v1/products')
        .send(productData)
        .expect(401);
    });

    it('should return 400 with invalid data', async () => {
      const invalidData = {
        name: '', // Invalid: empty name
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/test'
      };

      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('should return a product by ID', async () => {
      const product = await Product.create({
        name: 'Test Product',
        description: 'Test description',
        category: 'Test',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com/test'
      });

      const response = await request(app)
        .get(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.product.name).toBe('Test Product');
    });

    it('should return 404 for non-existent product', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/v1/products/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Product not found');
    });
  });

  describe('PUT /api/v1/products/:id', () => {
    it('should update a product with valid data', async () => {
      const product = await Product.create({
        name: 'Original Product',
        description: 'Original description',
        category: 'Original',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/original'
      });

      const updateData = {
        name: 'Updated Product',
        commissionRate: 0.05
      };

      const response = await request(app)
        .put(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.product.name).toBe('Updated Product');
      expect(response.body.data.product.commissionRate).toBe(0.05);
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('should delete a product', async () => {
      const product = await Product.create({
        name: 'Product to Delete',
        description: 'This will be deleted',
        category: 'Test',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://example.com/delete'
      });

      const response = await request(app)
        .delete(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Product deleted successfully');

      // Verify product is deleted
      const deletedProduct = await Product.findById(product._id);
      expect(deletedProduct).toBeNull();
    });
  });

  describe('GET /api/v1/products', () => {
    beforeEach(async () => {
      await Product.create([
        {
          name: 'Investment Fund A',
          description: 'High-yield investment',
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
          description: 'Commercial real estate',
          category: 'Real Estate',
          commissionType: 'flat',
          commissionFlatAmount: 500,
          minInitialSpend: 5000,
          landingPageUrl: 'https://example.com/real-estate',
          tags: ['real-estate', 'commercial'],
          status: 'active'
        }
      ]);
    });

    it('should return paginated products', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter products by category', async () => {
      const response = await request(app)
        .get('/api/v1/products?category=Investment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].category).toBe('Investment');
    });

    it('should search products', async () => {
      const response = await request(app)
        .get('/api/v1/products?search=investment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should filter products by tags', async () => {
      const response = await request(app)
        .get('/api/v1/products?tags=investment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].tags).toContain('investment');
    });

    it('should filter products by commission type', async () => {
      const response = await request(app)
        .get('/api/v1/products?commissionType=flat')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].commissionType).toBe('flat');
    });

    it('should filter products by commission rate range', async () => {
      const response = await request(app)
        .get('/api/v1/products?minCommissionRate=0.04&maxCommissionRate=0.06')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].commissionRate).toBe(0.05);
    });

    it('should filter products by initial spend range', async () => {
      const response = await request(app)
        .get('/api/v1/products?minInitialSpend=2000&maxInitialSpend=10000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].minInitialSpend).toBe(5000);
    });

    it('should combine multiple filters', async () => {
      const response = await request(app)
        .get('/api/v1/products?status=active&category=Investment&tags=investment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      const product = response.body.data[0];
      expect(product.status).toBe('active');
      expect(product.category).toBe('Investment');
      expect(product.tags).toContain('investment');
    });

    it('should sort products by commission rate', async () => {
      const response = await request(app)
        .get('/api/v1/products?sortBy=commissionRate&sortOrder=desc')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(1);
      
      // Check that products with commission rates are sorted correctly
      const productsWithRates = response.body.data.filter((p: any) => p.commissionRate !== undefined);
      if (productsWithRates.length > 1) {
        expect(productsWithRates[0].commissionRate).toBeGreaterThanOrEqual(productsWithRates[1].commissionRate);
      }
    });
  });

  describe('GET /api/v1/products/search - Advanced Search and Filtering', () => {
    beforeEach(async () => {
      await Product.create([
        {
          name: 'Premium Investment Fund',
          description: 'High-yield premium investment opportunity',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.08,
          minInitialSpend: 10000,
          landingPageUrl: 'https://example.com/premium-fund',
          tags: ['investment', 'premium', 'high-yield'],
          status: 'active'
        },
        {
          name: 'Basic Investment Plan',
          description: 'Entry-level investment plan',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.03,
          minInitialSpend: 500,
          landingPageUrl: 'https://example.com/basic-plan',
          tags: ['investment', 'basic', 'entry-level'],
          status: 'active'
        },
        {
          name: 'Commercial Real Estate',
          description: 'Commercial property investment',
          category: 'Real Estate',
          commissionType: 'flat',
          commissionFlatAmount: 1000,
          minInitialSpend: 50000,
          landingPageUrl: 'https://example.com/commercial-re',
          tags: ['real-estate', 'commercial', 'property'],
          status: 'active'
        },
        {
          name: 'Inactive Fund',
          description: 'This fund is no longer available',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/inactive',
          tags: ['investment', 'inactive'],
          status: 'inactive'
        }
      ]);
    });

    it('should return only active products by default', async () => {
      const response = await request(app)
        .get('/api/v1/products/search')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      response.body.data.forEach((product: any) => {
        expect(product.status).toBe('active');
      });
    });

    it('should search products by name and description', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?search=premium')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Premium Investment Fund');
    });

    it('should search products by tags', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?search=commercial')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].tags).toContain('commercial');
    });

    it('should filter by category', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?category=Real Estate')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].category).toBe('Real Estate');
    });

    it('should filter by multiple tags', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?tags=investment,premium')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2); // Both products have 'investment' tag
      response.body.data.forEach((product: any) => {
        expect(product.tags).toEqual(expect.arrayContaining(['investment']));
      });
    });

    it('should filter by commission rate range', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?minCommissionRate=0.05&maxCommissionRate=0.10')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].commissionRate).toBe(0.08);
    });

    it('should filter by initial spend range', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?minInitialSpend=5000&maxInitialSpend=15000')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].minInitialSpend).toBe(10000);
    });

    it('should combine search with filters', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?search=investment&category=Investment&minCommissionRate=0.07')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Premium Investment Fund');
    });

    it('should sort results correctly', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?sortBy=commissionRate&sortOrder=desc')
        .expect(200);

      expect(response.body.success).toBe(true);
      const productsWithRates = response.body.data.filter((p: any) => p.commissionRate !== undefined);
      if (productsWithRates.length > 1) {
        expect(productsWithRates[0].commissionRate).toBeGreaterThanOrEqual(productsWithRates[1].commissionRate);
      }
    });

    it('should handle pagination correctly', async () => {
      const response = await request(app)
        .get('/api/v1/products/search?page=1&limit=2')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.total).toBe(3);
    });
  });

  describe('GET /api/v1/products/discover - Marketer Product Discovery', () => {
    beforeEach(async () => {
      await Product.create([
        {
          name: 'High Commission Fund',
          description: 'Investment fund with high commission rates',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.10,
          minInitialSpend: 5000,
          landingPageUrl: 'https://example.com/high-commission',
          tags: ['investment', 'high-commission'],
          status: 'active'
        },
        {
          name: 'Low Barrier Fund',
          description: 'Investment fund with low minimum spend',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.04,
          minInitialSpend: 100,
          landingPageUrl: 'https://example.com/low-barrier',
          tags: ['investment', 'low-barrier'],
          status: 'active'
        },
        {
          name: 'Inactive High Commission',
          description: 'High commission but inactive',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.15,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/inactive-high',
          tags: ['investment', 'high-commission'],
          status: 'inactive'
        }
      ]);
    });

    it('should return only active products for marketers', async () => {
      const response = await request(app)
        .get('/api/v1/products/discover')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      response.body.data.forEach((product: any) => {
        expect(product.status).toBe('active');
      });
    });

    it('should filter by high commission rates for marketers', async () => {
      const response = await request(app)
        .get('/api/v1/products/discover?minCommissionRate=0.08')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].commissionRate).toBe(0.10);
    });

    it('should filter by low minimum spend for marketers', async () => {
      const response = await request(app)
        .get('/api/v1/products/discover?maxInitialSpend=1000')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].minInitialSpend).toBe(100);
    });

    it('should search and filter for marketers', async () => {
      const response = await request(app)
        .get('/api/v1/products/discover?search=commission&tags=high-commission')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].tags).toContain('high-commission');
      expect(response.body.data[0].status).toBe('active');
    });
  });

  describe('GET /api/v1/products/recommendations - Product Recommendations', () => {
    beforeEach(async () => {
      await Product.create([
        {
          name: 'Investment Fund 1',
          description: 'First investment fund',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/fund1',
          tags: ['investment', 'growth'],
          status: 'active'
        },
        {
          name: 'Investment Fund 2',
          description: 'Second investment fund',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.06,
          minInitialSpend: 2000,
          landingPageUrl: 'https://example.com/fund2',
          tags: ['investment', 'value'],
          status: 'active'
        },
        {
          name: 'Real Estate Fund',
          description: 'Real estate investment',
          category: 'Real Estate',
          commissionType: 'flat',
          commissionFlatAmount: 500,
          minInitialSpend: 10000,
          landingPageUrl: 'https://example.com/re-fund',
          tags: ['real-estate', 'property'],
          status: 'active'
        }
      ]);
    });

    it('should return recommendations by category', async () => {
      const response = await request(app)
        .get('/api/v1/products/recommendations?category=Investment')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.products).toHaveLength(2);
      response.body.data.products.forEach((product: any) => {
        expect(product.category).toBe('Investment');
        expect(product.status).toBe('active');
      });
    });

    it('should return recommendations by tags', async () => {
      const response = await request(app)
        .get('/api/v1/products/recommendations?tags=growth,value')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.products.length).toBeGreaterThan(0);
      response.body.data.products.forEach((product: any) => {
        expect(product.status).toBe('active');
      });
    });

    it('should limit recommendations correctly', async () => {
      const response = await request(app)
        .get('/api/v1/products/recommendations?limit=2')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.products.length).toBeLessThanOrEqual(2);
    });

    it('should reject limit over 20', async () => {
      const response = await request(app)
        .get('/api/v1/products/recommendations?limit=25')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Limit cannot exceed 20');
    });
  });

  describe('GET /api/v1/products/stats - Product Statistics', () => {
    beforeEach(async () => {
      await Product.create([
        {
          name: 'Active Investment 1',
          description: 'Active investment product',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/active1',
          status: 'active'
        },
        {
          name: 'Active Investment 2',
          description: 'Another active investment',
          category: 'Investment',
          commissionType: 'flat',
          commissionFlatAmount: 300,
          minInitialSpend: 2000,
          landingPageUrl: 'https://example.com/active2',
          status: 'active'
        },
        {
          name: 'Inactive Investment',
          description: 'Inactive investment product',
          category: 'Investment',
          commissionType: 'percentage',
          commissionRate: 0.04,
          minInitialSpend: 1500,
          landingPageUrl: 'https://example.com/inactive',
          status: 'inactive'
        },
        {
          name: 'Real Estate Product',
          description: 'Real estate investment',
          category: 'Real Estate',
          commissionType: 'percentage',
          commissionRate: 0.06,
          minInitialSpend: 5000,
          landingPageUrl: 'https://example.com/re',
          status: 'active'
        }
      ]);
    });

    it('should return comprehensive product statistics', async () => {
      const response = await request(app)
        .get('/api/v1/products/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stats).toEqual({
        total: 4,
        active: 3,
        inactive: 1,
        byCategory: {
          'Investment': 3,
          'Real Estate': 1
        },
        byCommissionType: {
          percentage: 3,
          flat: 1
        }
      });
    });
  });

  describe('Status-based Visibility Controls', () => {
    beforeEach(async () => {
      await Product.create([
        {
          name: 'Active Product',
          description: 'This product is active',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/active',
          status: 'active'
        },
        {
          name: 'Inactive Product',
          description: 'This product is inactive',
          category: 'Test',
          commissionType: 'percentage',
          commissionRate: 0.05,
          minInitialSpend: 1000,
          landingPageUrl: 'https://example.com/inactive',
          status: 'inactive'
        }
      ]);
    });

    it('should show only active products in public search', async () => {
      const response = await request(app)
        .get('/api/v1/products/search')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('active');
    });

    it('should show only active products in marketer discovery', async () => {
      const response = await request(app)
        .get('/api/v1/products/discover')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('active');
    });

    it('should show only active products in recommendations', async () => {
      const response = await request(app)
        .get('/api/v1/products/recommendations')
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.products.forEach((product: any) => {
        expect(product.status).toBe('active');
      });
    });

    it('should allow admins to see all products with status filter', async () => {
      const response = await request(app)
        .get('/api/v1/products?status=inactive')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('inactive');
    });
  });
});