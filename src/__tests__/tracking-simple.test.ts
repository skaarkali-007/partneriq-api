import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { ReferralLink } from '../models/ReferralLink';
import { ClickEvent } from '../models/ClickEvent';
import { TrackingService } from '../services/tracking';

describe('Simple Tracking Tests', () => {
  let mongoServer: MongoMemoryServer;
  let marketerId: string;
  let productId: string;
  let trackingCode: string;

  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear all collections
    await User.deleteMany({});
    await Product.deleteMany({});
    await ReferralLink.deleteMany({});
    await ClickEvent.deleteMany({});

    // Create test marketer
    const marketer = new User({
      email: 'marketer@test.com',
      password: 'testpassword123',
      role: 'marketer',
      status: 'active'
    });
    await marketer.save();
    marketerId = marketer._id.toString();

    // Create test product
    const product = new Product({
      name: 'Test Investment Product',
      description: 'A test investment product',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05,
      minInitialSpend: 100,
      status: 'active',
      landingPageUrl: 'https://example.com/invest'
    });
    await product.save();
    productId = product._id.toString();

    // Create test referral link
    const referralLink = await TrackingService.createReferralLink({
      marketerId,
      productId
    });
    trackingCode = referralLink.trackingCode;
  });

  it('should create a click event successfully', async () => {
    const clickData = {
      trackingCode,
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      referrer: 'https://google.com',
      sessionId: 'test-session-123',
      customerId: 'customer123'
    };

    const clickEvent = await TrackingService.trackClick(clickData);

    expect(clickEvent).toBeTruthy();
    expect(clickEvent.trackingCode).toBe(trackingCode);
    expect(clickEvent.ipAddress).toBe('192.168.1.100');
    expect(clickEvent.sessionId).toBe('test-session-123');
    expect(clickEvent.customerId).toBe('customer123');
    expect(clickEvent.fingerprint).toBeTruthy();
    expect(clickEvent.device).toBe('desktop');
    expect(clickEvent.browser).toBe('chrome');
    expect(clickEvent.os).toBe('windows');

    // Verify referral link click count was incremented
    const updatedLink = await ReferralLink.findOne({ trackingCode });
    expect(updatedLink?.clickCount).toBe(1);
  });

  it('should validate tracking code format', async () => {
    const isValid = TrackingService.validateTrackingCode(trackingCode);
    expect(isValid).toBe(true);

    const isInvalid = TrackingService.validateTrackingCode('INVALID_FORMAT');
    expect(isInvalid).toBe(false);
  });

  it('should create click event with fingerprint', async () => {
    const clickEvent = new ClickEvent({
      trackingCode,
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0',
      sessionId: 'session123'
    });

    await clickEvent.save();

    expect(clickEvent.fingerprint).toBeTruthy();
    expect(clickEvent.fingerprint).toHaveLength(16);
  });
});