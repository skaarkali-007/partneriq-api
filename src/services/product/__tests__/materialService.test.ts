import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProductMaterialService, CreateMaterialData } from '../materialService';
import { ProductMaterial } from '../../../models/ProductMaterial';
import { Product } from '../../../models/Product';

describe('ProductMaterialService', () => {
  let mongoServer: MongoMemoryServer;
  let testProductId: string;

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
  });

  describe('createMaterial', () => {
    it('should create a new material successfully', async () => {
      const materialData: CreateMaterialData = {
        productId: testProductId,
        materialType: 'banner',
        title: 'Test Banner',
        description: 'Test banner description',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        dimensions: '300x250',
        tags: ['marketing', 'banner']
      };

      const material = await ProductMaterialService.createMaterial(materialData);

      expect(material._id).toBeDefined();
      expect(material.productId).toBe(testProductId);
      expect(material.materialType).toBe('banner');
      expect(material.title).toBe('Test Banner');
      expect(material.fileUrl).toBe('/uploads/materials/test-banner.jpg');
      expect(material.tags).toEqual(['marketing', 'banner']);
    });

    it('should throw error if product does not exist', async () => {
      const materialData: CreateMaterialData = {
        productId: new mongoose.Types.ObjectId().toString(),
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/test-banner.jpg',
        fileName: 'test-banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      };

      await expect(ProductMaterialService.createMaterial(materialData))
        .rejects.toThrow('Product not found');
    });
  });

  describe('getMaterialById', () => {
    it('should return material by ID', async () => {
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

      const foundMaterial = await ProductMaterialService.getMaterialById(savedMaterial._id.toString());

      expect(foundMaterial).toBeTruthy();
      expect(foundMaterial!._id.toString()).toBe(savedMaterial._id.toString());
      expect(foundMaterial!.title).toBe('Test Banner');
    });

    it('should return null if material not found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const material = await ProductMaterialService.getMaterialById(nonExistentId);

      expect(material).toBeNull();
    });
  });

  describe('updateMaterial', () => {
    it('should update material successfully', async () => {
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

      const updateData = {
        title: 'Updated Title',
        description: 'Updated description',
        tags: ['updated', 'tags']
      };

      const updatedMaterial = await ProductMaterialService.updateMaterial(
        savedMaterial._id.toString(),
        updateData
      );

      expect(updatedMaterial).toBeTruthy();
      expect(updatedMaterial!.title).toBe('Updated Title');
      expect(updatedMaterial!.description).toBe('Updated description');
      expect(updatedMaterial!.tags).toEqual(['updated', 'tags']);
    });

    it('should return null if material not found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const updateData = { title: 'Updated Title' };

      const result = await ProductMaterialService.updateMaterial(nonExistentId, updateData);

      expect(result).toBeNull();
    });
  });

  describe('deleteMaterial', () => {
    it('should delete material successfully', async () => {
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

      const deleted = await ProductMaterialService.deleteMaterial(savedMaterial._id.toString());

      expect(deleted).toBe(true);

      // Verify material is deleted
      const foundMaterial = await ProductMaterial.findById(savedMaterial._id);
      expect(foundMaterial).toBeNull();
    });

    it('should return false if material not found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const deleted = await ProductMaterialService.deleteMaterial(nonExistentId);

      expect(deleted).toBe(false);
    });
  });

  describe('getMaterials', () => {
    beforeEach(async () => {
      // Create test materials
      const materials = [
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
        },
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Banner 2',
          fileUrl: '/uploads/materials/banner2.jpg',
          fileName: 'banner2.jpg',
          fileSize: 1536,
          mimeType: 'image/jpeg',
          tags: ['marketing'],
          isActive: false
        }
      ];

      await ProductMaterial.insertMany(materials);
    });

    it('should return paginated materials', async () => {
      const result = await ProductMaterialService.getMaterials({
        page: 1,
        limit: 2
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.pages).toBe(2);
    });

    it('should filter by productId', async () => {
      const result = await ProductMaterialService.getMaterials({
        productId: testProductId
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      result.data!.forEach(material => {
        expect(material.productId).toBe(testProductId);
      });
    });

    it('should filter by materialType', async () => {
      const result = await ProductMaterialService.getMaterials({
        materialType: 'banner'
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      result.data!.forEach(material => {
        expect(material.materialType).toBe('banner');
      });
    });

    it('should filter by isActive', async () => {
      const result = await ProductMaterialService.getMaterials({
        isActive: true
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      result.data!.forEach(material => {
        expect(material.isActive).toBe(true);
      });
    });

    it('should filter by tags', async () => {
      const result = await ProductMaterialService.getMaterials({
        tags: ['marketing']
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      result.data!.forEach(material => {
        expect(material.tags).toContain('marketing');
      });
    });

    it('should sort materials', async () => {
      const result = await ProductMaterialService.getMaterials({
        sortBy: 'title',
        sortOrder: 'asc'
      });

      expect(result.success).toBe(true);
      expect(result.data![0].title).toBe('Banner 1');
      expect(result.data![1].title).toBe('Banner 2');
      expect(result.data![2].title).toBe('Email Template 1');
    });
  });

  describe('getMaterialsByProduct', () => {
    it('should return materials for specific product', async () => {
      // Create materials for the test product
      await ProductMaterial.create({
        productId: testProductId,
        materialType: 'banner',
        title: 'Test Banner',
        fileUrl: '/uploads/materials/banner.jpg',
        fileName: 'banner.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg'
      });

      const result = await ProductMaterialService.getMaterialsByProduct(testProductId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].productId).toBe(testProductId);
    });
  });

  describe('getActiveMaterialsByProduct', () => {
    it('should return only active materials for specific product', async () => {
      // Create active and inactive materials
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Active Banner',
          fileUrl: '/uploads/materials/active.jpg',
          fileName: 'active.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: true
        },
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Inactive Banner',
          fileUrl: '/uploads/materials/inactive.jpg',
          fileName: 'inactive.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          isActive: false
        }
      ]);

      const result = await ProductMaterialService.getActiveMaterialsByProduct(testProductId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].title).toBe('Active Banner');
      expect(result.data![0].isActive).toBe(true);
    });
  });

  describe('getMaterialTypes', () => {
    it('should return unique material types', async () => {
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
        },
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Another Banner',
          fileUrl: '/uploads/materials/banner2.jpg',
          fileName: 'banner2.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg'
        }
      ]);

      const types = await ProductMaterialService.getMaterialTypes();

      expect(types).toHaveLength(2);
      expect(types).toContain('banner');
      expect(types).toContain('email_template');
    });
  });

  describe('getMaterialTags', () => {
    it('should return unique material tags', async () => {
      await ProductMaterial.insertMany([
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Banner 1',
          fileUrl: '/uploads/materials/banner1.jpg',
          fileName: 'banner1.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          tags: ['marketing', 'banner']
        },
        {
          productId: testProductId,
          materialType: 'email_template',
          title: 'Email 1',
          fileUrl: '/uploads/materials/email1.html',
          fileName: 'email1.html',
          fileSize: 2048,
          mimeType: 'text/html',
          tags: ['email', 'template']
        },
        {
          productId: testProductId,
          materialType: 'banner',
          title: 'Banner 2',
          fileUrl: '/uploads/materials/banner2.jpg',
          fileName: 'banner2.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          tags: ['marketing', 'promotion']
        }
      ]);

      const tags = await ProductMaterialService.getMaterialTags();

      expect(tags).toHaveLength(5);
      expect(tags).toContain('marketing');
      expect(tags).toContain('banner');
      expect(tags).toContain('email');
      expect(tags).toContain('template');
      expect(tags).toContain('promotion');
    });
  });

  describe('getMaterialStats', () => {
    it('should return material statistics for a product', async () => {
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

      const stats = await ProductMaterialService.getMaterialStats(testProductId);

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.inactive).toBe(1);
      expect(stats.byType.banner).toBe(2);
      expect(stats.byType.email_template).toBe(1);
    });
  });
});