import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../index';
import { Product } from '../models/Product';
import { ProductMaterial } from '../models/ProductMaterial';
import { User } from '../models/User';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs/promises';

describe('Product Materials API Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testProductId: string;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create test user and auth token
    const testUser = new User({
      email: 'test@example.com',
      password: 'hashedpassword',
      role: 'admin',
      status: 'active'
    });
    const savedUser = await testUser.save();
    testUserId = savedUser._id.toString();

    authToken = jwt.sign(
      { userId: testUserId, email: 'test@example.com', role: 'admin' },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { 
        expiresIn: '1h',
        issuer: 'financial-affiliate-platform',
        audience: 'financial-affiliate-users'
      }
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await ProductMaterial.deleteMany({});
    await Product.deleteMany({});

    // Create a test product
    const product = new Product({
      name: 'Test Product',
      description: 'Test Description',
      category: 'Investment',
      commissionType: 'percentage',
      commissionRate: 0.05,
      minInitialSpend: 1000,
      landingPageUrl: 'https://example.com'
    });
    const savedProduct = await product.save();
    testProductId = savedProduct._id.toString();

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), 'uploads', 'materials');
    try {
      await fs.mkdir(uploadsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    // Clean up uploaded test files
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'materials');
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        if (file.startsWith('test-')) {
          await fs.unlink(path.join(uploadsDir, file));
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('POST /api/v1/products/materials/upload', () => {
    it('should upload a material successfully', async () => {
      // Create a test file
      const testFilePath = path.join(__dirname, 'test-banner.jpg');
      await fs.writeFile(testFilePath, 'fake image content');

      const response = await request(app)
        .post('/api/v1/products/materials/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('productId', testProductId)
        .field('materialType', 'banner')
        .field('title', 'Test Banner')
        .field('description', 'Test banner description')
        .field('dimensions', '300x250')
        .field('tags[0]', 'marketing')
        .field('tags[1]', 'banner')
        .attach('file', testFilePath);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Material uploaded successfully');
      expect(response.body.data.material).toBeDefined();
      expect(response.body.data.material.title).toBe('Test Banner');
      expect(response.body.data.material.materialType).toBe('banner');
      expect(response.body.data.material.productId).toBe(testProductId);

      // Clean up test file
      await fs.unlink(testFilePath);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/products/materials/upload')
        .field('productId', testProductId)
        .field('materialType', 'banner')
        .field('title', 'Test Banner');

      expect(response.status).toBe(401);
    });

    it('should require file upload', async () => {
      const response = await request(app)
        .post('/api/v1/products/materials/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('productId', testProductId)
        .field('materialType', 'banner')
        .field('title', 'Test Banner');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No file uploaded');
    });

    it('should validate required fields', async () => {
      const testFilePath = path.join(__dirname, 'test-banner.jpg');
      await fs.writeFile(testFilePath, 'fake image content');

      const response = await request(app)
        .post('/api/v1/products/materials/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('materialType', 'banner')
        .field('title', 'Test Banner')
        .attach('file', testFilePath);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'productId',
            message: 'Product ID is required'
          })
        ])
      );

      // Clean up test file
      await fs.unlink(testFilePath);
    });

    it('should validate product exists', async () => {
      const testFilePath = path.join(__dirname, 'test-banner.jpg');
      await fs.writeFile(testFilePath, 'fake image content');

      const nonExistentProductId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .post('/api/v1/products/materials/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('productId', nonExistentProductId)
        .field('materialType', 'banner')
        .field('title', 'Test Banner')
        .attach('file', testFilePath);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Product not found');

      // Clean up test file
      await fs.unlink(testFilePath);
    });
  });

  describe('GET /api/v1/products/materials', () => {
    beforeEach(async () => {
      // Create test materials
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Banner 1',
          fileUrl: '/uploads/materials/banner1.jpg',
          fileName: 'banner1.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          tags: ['marketing'],
          isActive: true
        },
        {
          productId: testProductId,
          materialType: 'email_template',
          title: 'Email Template 1',
          fileUrl: '/uploads/materials/email1.html',
          fileName: 'email1.html',
          fileSize: 2048,
          mimeType: 'text/html',
          tags: ['email'],
          isActive: true
        }
      ]);
    });

    it('should get materials with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/products/materials')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter by materialType', async () => {
      const response = await request(app)
        .get('/api/v1/products/materials')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ materialType: 'banner' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].materialType).toBe('banner');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/products/materials');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/products/:productId/materials', () => {
    beforeEach(async () => {
      // Create materials for the test product
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Product Banner',
          fileUrl: '/uploads/materials/banner.jpg',
          fileName: 'banner.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: true
        },
        {
          productId: testProductId,
          materialType: 'email_template',
          title: 'Product Email',
          fileUrl: '/uploads/materials/email.html',
          fileName: 'email.html',
          fileSize: 2048,
          mimeType: 'text/html',
          isActive: false
        }
      ]);

      // Create material for different product
      const otherProduct = new Product({
        name: 'Other Product',
        description: 'Other Description',
        category: 'Investment',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 500,
        landingPageUrl: 'https://other.com'
      });
      const savedOtherProduct = await otherProduct.save();

      await ProductMaterial.create({
        productId: savedOtherProduct._id.toString(),
        materialType: 'banner',
        title: 'Other Product Banner',
        fileUrl: '/uploads/materials/other-banner.jpg',
        fileName: 'other-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        isActive: true
      });
    });

    it('should get materials for specific product', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${testProductId}/materials`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      response.body.data.forEach((material: any) => {
        expect(material.productId).toBe(testProductId);
      });
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${testProductId}/materials`);

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/products/:productId/materials/active', () => {
    beforeEach(async () => {
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Active Banner',
          fileUrl: '/uploads/materials/active-banner.jpg',
          fileName: 'active-banner.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: true
        },
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Inactive Banner',
          fileUrl: '/uploads/materials/inactive-banner.jpg',
          fileName: 'inactive-banner.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: false
        }
      ]);
    });

    it('should get only active materials for specific product', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${testProductId}/materials/active`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Active Banner');
      expect(response.body.data[0].isActive).toBe(true);
    });

    it('should not require authentication for public route', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${testProductId}/materials/active`);

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/v1/products/materials/:id', () => {
    let testMaterialId: string;

    beforeEach(async () => {
      const material = new ProductMaterial({
        productId: testProductId,
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      });
      const savedMaterial = await material.save();
      testMaterialId = savedMaterial._id.toString();
    });

    it('should get material by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/products/materials/${testMaterialId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.material.id).toBe(testMaterialId);
      expect(response.body.data.material.title).toBe('Test Banner');
    });

    it('should return 404 for non-existent material', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const response = await request(app)
        .get(`/api/v1/products/materials/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Material not found');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/v1/products/materials/${testMaterialId}`);

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/v1/products/materials/:id', () => {
    let testMaterialId: string;

    beforeEach(async () => {
      const material = new ProductMaterial({
        productId: testProductId,
        materialType: 'banner',
        title: 'Original Title',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      });
      const savedMaterial = await material.save();
      testMaterialId = savedMaterial._id.toString();
    });

    it('should update material successfully', async () => {
      const updateData = {
        title: 'Updated Title',
        description: 'Updated description',
        tags: ['updated', 'tags']
      };

      const response = await request(app)
        .put(`/api/v1/products/materials/${testMaterialId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Material updated successfully');
      expect(response.body.data.material.title).toBe('Updated Title');
      expect(response.body.data.material.description).toBe('Updated description');
      expect(response.body.data.material.tags).toEqual(['updated', 'tags']);
    });

    it('should return 404 for non-existent material', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const response = await request(app)
        .put(`/api/v1/products/materials/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Updated Title' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Material not found');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put(`/api/v1/products/materials/${testMaterialId}`)
        .send({ title: 'Updated Title' });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/products/materials/:id', () => {
    let testMaterialId: string;

    beforeEach(async () => {
      const material = new ProductMaterial({
        productId: testProductId,
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      });
      const savedMaterial = await material.save();
      testMaterialId = savedMaterial._id.toString();
    });

    it('should delete material successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/materials/${testMaterialId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Material deleted successfully');

      // Verify material is deleted
      const deletedMaterial = await ProductMaterial.findById(testMaterialId);
      expect(deletedMaterial).toBeNull();
    });

    it('should return 404 for non-existent material', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const response = await request(app)
        .delete(`/api/v1/products/materials/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Material not found');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/materials/${testMaterialId}`);

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/products/materials/types', () => {
    beforeEach(async () => {
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Banner',
          fileUrl: '/uploads/materials/banner.jpg',
          fileName: 'banner.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg'
        },
        {
          productId: testProductId,
          materialType: 'email_template',
          title: 'Email',
          fileUrl: '/uploads/materials/email.html',
          fileName: 'email.html',
          fileSize: 2048,
          mimeType: 'text/html'
        }
      ]);
    });

    it('should get material types', async () => {
      const response = await request(app)
        .get('/api/v1/products/materials/types')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.types).toContain('banner');
      expect(response.body.data.types).toContain('email_template');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/products/materials/types');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/products/:productId/materials/stats', () => {
    beforeEach(async () => {
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Active Banner',
          fileUrl: '/uploads/materials/banner1.jpg',
          fileName: 'banner1.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: true
        },
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Inactive Banner',
          fileUrl: '/uploads/materials/banner2.jpg',
          fileName: 'banner2.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: false
        },
        {
          productId: testProductId,
          materialType: 'email_template',
          title: 'Email Template',
          fileUrl: '/uploads/materials/email.html',
          fileName: 'email.html',
          fileSize: 2048,
          mimeType: 'text/html',
          isActive: true
        }
      ]);
    });

    it('should get material statistics', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${testProductId}/materials/stats`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.stats.total).toBe(3);
      expect(response.body.data.stats.active).toBe(2);
      expect(response.body.data.stats.inactive).toBe(1);
      expect(response.body.data.stats.byType.banner).toBe(2);
      expect(response.body.data.stats.byType.email_template).toBe(1);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${testProductId}/materials/stats`);

      expect(response.status).toBe(401);
    });
  });
});