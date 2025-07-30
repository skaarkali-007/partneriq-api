import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProductMaterial, IProductMaterial } from '../ProductMaterial';
import { Product } from '../Product';

describe('ProductMaterial Model', () => {
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
    await ProductMaterial.deleteMany({});
    await Product.deleteMany({});
  });

  describe('Schema Validation', () => {
    it('should create a valid product material', async () => {
      // First create a product
      const product = new Product({
        name: 'Test Product',
        description: 'Test Description',
        category: 'Investment',
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000,
        landingPageUrl: 'https://example.com'
      });
      await product.save();

      const materialData = {
        productId: product._id.toString(),
        materialType: 'banner',
        title: 'Test Banner',
        description: 'Test banner description',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        dimensions: '300x250',
        tags: ['marketing', 'banner'],
        isActive: true
      };

      const material = new ProductMaterial(materialData);
      const savedMaterial = await material.save();

      expect(savedMaterial._id).toBeDefined();
      expect(savedMaterial.productId).toBe(product._id.toString());
      expect(savedMaterial.materialType).toBe('banner');
      expect(savedMaterial.title).toBe('Test Banner');
      expect(savedMaterial.fileUrl).toBe('/uploads/materials/test-banner.jpg');
      expect(savedMaterial.dimensions).toBe('300x250');
      expect(savedMaterial.tags).toEqual(['marketing', 'banner']);
      expect(savedMaterial.isActive).toBe(true);
      expect(savedMaterial.createdAt).toBeDefined();
      expect(savedMaterial.updatedAt).toBeDefined();
    });

    it('should require productId', async () => {
      const materialData = {
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Product ID is required');
    });

    it('should require materialType', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Material type is required');
    });

    it('should require title', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Material title is required');
    });

    it('should validate materialType enum', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'invalid_type',
        title: 'Test Material',
        fileUrl: '/uploads/materials/test.jpg',
        fileName: 'test.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow();
    });

    it('should validate dimensions format', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        dimensions: 'invalid-format'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Dimensions must be in format "widthxheight"');
    });

    it('should limit tags to 10', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`)
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Cannot have more than 10 tags');
    });

    it('should validate title length', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'a'.repeat(256), // Exceeds 255 character limit
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Title cannot exceed 255 characters');
    });

    it('should validate description length', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'Test Banner',
        description: 'a'.repeat(1001), // Exceeds 1000 character limit
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      
      await expect(material.save()).rejects.toThrow('Description cannot exceed 1000 characters');
    });

    it('should set default values correctly', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      const savedMaterial = await material.save();

      expect(savedMaterial.tags).toEqual([]);
      expect(savedMaterial.isActive).toBe(true);
    });
  });

  describe('JSON Transformation', () => {
    it('should transform _id to id in JSON output', async () => {
      const materialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      const material = new ProductMaterial(materialData);
      const savedMaterial = await material.save();
      const json = savedMaterial.toJSON();

      expect(json.id).toBeDefined();
      expect(json._id).toBeUndefined();
      expect(json.__v).toBeUndefined();
    });
  });

  describe('Indexes', () => {
    it('should have proper indexes', async () => {
      const indexes = await ProductMaterial.collection.getIndexes();
      
      // Check that required indexes exist
      const indexNames = Object.keys(indexes);
      expect(indexNames).toContain('productId_1');
      expect(indexNames).toContain('materialType_1');
      expect(indexNames).toContain('isActive_1');
      expect(indexNames).toContain('tags_1');
      expect(indexNames).toContain('createdAt_-1');
    });
  });
});