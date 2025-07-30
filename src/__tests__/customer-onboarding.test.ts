import request from 'supertest';
import { app } from '../index';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Customer } from '../models/Customer';
import { Product } from '../models/Product';
import mongoose from 'mongoose';

describe('Customer Onboarding Flow', () => {
  let productId: string;
  let customerId: string;

  beforeAll(async () => {
    await connectDatabase();
    
    // Create a test product
    const testProduct = new Product({
      name: 'Test Investment Product',
      description: 'A test financial product for onboarding',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05,
      minInitialSpend: 1000,
      status: 'active',
      landingPageUrl: 'https://example.com/product',
      tags: ['test', 'investment']
    });
    
    const savedProduct = await testProduct.save();
    productId = savedProduct._id.toString();
  });

  afterAll(async () => {
    // Clean up test data
    await Customer.deleteMany({});
    await Product.deleteMany({});
    await disconnectDatabase();
  });

  afterEach(async () => {
    // Clean up customers after each test
    await Customer.deleteMany({});
  });

  describe('POST /api/v1/customers/onboarding/start', () => {
    it('should start onboarding process with valid tracking code and product', async () => {
      const response = await request(app)
        .post('/api/v1/customers/onboarding/start')
        .send({
          trackingCode: 'test-tracking-123',
          productId: productId
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('customerId');
      expect(response.body.data.currentStep).toBe(1);
      expect(response.body.data.onboardingStatus).toBe('started');
      
      customerId = response.body.data.customerId;
    });

    it('should return existing customer if already exists', async () => {
      // Create a customer first
      const customer = new Customer({
        trackingCode: 'existing-tracking-123',
        productId: productId,
        onboardingStatus: 'personal_info',
        currentStep: 2,
        consents: {
          termsAndConditions: false,
          privacyPolicy: false,
          marketingCommunications: false,
          dataProcessing: false,
          consentDate: new Date()
        }
      });
      await customer.save();

      const response = await request(app)
        .post('/api/v1/customers/onboarding/start')
        .send({
          trackingCode: 'existing-tracking-123',
          productId: productId
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.currentStep).toBe(2);
      expect(response.body.data.onboardingStatus).toBe('personal_info');
    });

    it('should return error for invalid product ID', async () => {
      const response = await request(app)
        .post('/api/v1/customers/onboarding/start')
        .send({
          trackingCode: 'test-tracking-123',
          productId: new mongoose.Types.ObjectId().toString()
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Product not found');
    });
  });

  describe('PUT /api/v1/customers/onboarding/:customerId/personal-info', () => {
    beforeEach(async () => {
      // Create a customer for testing
      const customer = new Customer({
        trackingCode: 'test-tracking-123',
        productId: productId,
        onboardingStatus: 'started',
        currentStep: 1,
        consents: {
          termsAndConditions: false,
          privacyPolicy: false,
          marketingCommunications: false,
          dataProcessing: false,
          consentDate: new Date()
        }
      });
      const savedCustomer = await customer.save();
      customerId = savedCustomer._id.toString();
    });

    it('should update personal information successfully', async () => {
      const personalInfo = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US'
        },
        consents: {
          termsAndConditions: true,
          privacyPolicy: true,
          marketingCommunications: false,
          dataProcessing: true
        }
      };

      const response = await request(app)
        .put(`/api/v1/customers/onboarding/${customerId}/personal-info`)
        .send(personalInfo);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.currentStep).toBe(2);
      expect(response.body.data.onboardingStatus).toBe('personal_info');

      // Verify data was saved
      const updatedCustomer = await Customer.findById(customerId);
      expect(updatedCustomer?.firstName).toBe('John');
      expect(updatedCustomer?.lastName).toBe('Doe');
      expect(updatedCustomer?.email).toBe('john.doe@example.com');
    });

    it('should return error for missing required fields', async () => {
      const incompleteInfo = {
        firstName: 'John',
        // Missing other required fields
      };

      const response = await request(app)
        .put(`/api/v1/customers/onboarding/${customerId}/personal-info`)
        .send(incompleteInfo);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('All personal information fields are required');
    });

    it('should return error for missing required consents', async () => {
      const personalInfo = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US'
        },
        consents: {
          termsAndConditions: false, // Required consent not given
          privacyPolicy: true,
          marketingCommunications: false,
          dataProcessing: true
        }
      };

      const response = await request(app)
        .put(`/api/v1/customers/onboarding/${customerId}/personal-info`)
        .send(personalInfo);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Required consents must be accepted');
    });
  });

  describe('POST /api/v1/customers/onboarding/:customerId/signature', () => {
    beforeEach(async () => {
      // Create a customer ready for signature
      const customer = new Customer({
        trackingCode: 'test-tracking-123',
        productId: productId,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890',
        dateOfBirth: new Date('1990-01-01'),
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US'
        },
        onboardingStatus: 'kyc_documents',
        currentStep: 3,
        consents: {
          termsAndConditions: true,
          privacyPolicy: true,
          marketingCommunications: false,
          dataProcessing: true,
          consentDate: new Date()
        }
      });
      const savedCustomer = await customer.save();
      customerId = savedCustomer._id.toString();
    });

    it('should complete signature successfully', async () => {
      const signatureData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

      const response = await request(app)
        .post(`/api/v1/customers/onboarding/${customerId}/signature`)
        .send({ signatureData });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.onboardingStatus).toBe('completed');
      expect(response.body.data).toHaveProperty('completedAt');

      // Verify signature was saved
      const updatedCustomer = await Customer.findById(customerId);
      expect(updatedCustomer?.signature.signed).toBe(true);
      expect(updatedCustomer?.signature.signatureData).toBe(signatureData);
      expect(updatedCustomer?.onboardingStatus).toBe('completed');
    });

    it('should return error for missing signature data', async () => {
      const response = await request(app)
        .post(`/api/v1/customers/onboarding/${customerId}/signature`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Signature data is required');
    });
  });

  describe('GET /api/v1/customers/onboarding/:customerId/status', () => {
    beforeEach(async () => {
      // Create a customer with some data
      const customer = new Customer({
        trackingCode: 'test-tracking-123',
        productId: productId,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890',
        dateOfBirth: new Date('1990-01-01'),
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US'
        },
        onboardingStatus: 'personal_info',
        currentStep: 2,
        consents: {
          termsAndConditions: true,
          privacyPolicy: true,
          marketingCommunications: false,
          dataProcessing: true,
          consentDate: new Date()
        }
      });
      const savedCustomer = await customer.save();
      customerId = savedCustomer._id.toString();
    });

    it('should return customer onboarding status', async () => {
      const response = await request(app)
        .get(`/api/v1/customers/onboarding/${customerId}/status`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('customerId');
      expect(response.body.data).toHaveProperty('currentStep', 2);
      expect(response.body.data).toHaveProperty('onboardingStatus', 'personal_info');
      expect(response.body.data).toHaveProperty('personalInfo');
      expect(response.body.data.personalInfo.firstName).toBe('John');
      expect(response.body.data.personalInfo.lastName).toBe('Doe');
    });

    it('should return error for non-existent customer', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      
      const response = await request(app)
        .get(`/api/v1/customers/onboarding/${fakeId}/status`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Customer not found');
    });
  });

  describe('POST /api/v1/customers/onboarding/validate/:step', () => {
    it('should validate personal information step', async () => {
      const validPersonalInfo = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US'
        },
        consents: {
          termsAndConditions: true,
          privacyPolicy: true,
          marketingCommunications: false,
          dataProcessing: true
        }
      };

      const response = await request(app)
        .post('/api/v1/customers/onboarding/validate/1')
        .send(validPersonalInfo);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return validation errors for invalid data', async () => {
      const invalidPersonalInfo = {
        firstName: '',
        lastName: 'Doe',
        email: 'invalid-email',
        phone: '+1234567890',
        dateOfBirth: '2010-01-01', // Too young
        address: {
          street: '',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US'
        },
        consents: {
          termsAndConditions: false, // Required
          privacyPolicy: true,
          marketingCommunications: false,
          dataProcessing: false // Required
        }
      };

      const response = await request(app)
        .post('/api/v1/customers/onboarding/validate/1')
        .send(invalidPersonalInfo);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeInstanceOf(Array);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should validate signature step', async () => {
      const signatureData = {
        signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      };

      const response = await request(app)
        .post('/api/v1/customers/onboarding/validate/3')
        .send(signatureData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});