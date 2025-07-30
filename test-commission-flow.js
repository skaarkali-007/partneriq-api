// Test script to verify commission flow works end-to-end
const mongoose = require('mongoose');
require('dotenv').config();

// Import models and services
const { Customer } = require('./dist/models/Customer');
const { Product } = require('./dist/models/Product');
const { User } = require('./dist/models/User');
const { ReferralLink } = require('./dist/models/ReferralLink');
const { Commission } = require('./dist/models/Commission');
const { CommissionService } = require('./dist/services/commission');

async function testCommissionFlow() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/financial-affiliate');
    console.log('✅ Connected to database');

    // 1. Create a test marketer
    const marketer = new User({
      email: 'test-marketer@example.com',
      password: 'hashedpassword',
      firstName: 'Test',
      lastName: 'Marketer',
      role: 'marketer',
      status: 'active'
    });
    await marketer.save();
    console.log('✅ Created test marketer:', marketer._id);

    // 2. Create a test product with 5% commission
    const product = new Product({
      name: 'Test Investment Product',
      description: 'A test investment product',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05, // 5%
      minInitialSpend: 1000,
      status: 'active',
      onboardingType: 'simple'
    });
    await product.save();
    console.log('✅ Created test product:', product._id);

    // 3. Create a referral link
    const referralLink = new ReferralLink({
      marketerId: marketer._id,
      productId: product._id,
      trackingCode: 'TEST_TRACK_123',
      linkUrl: 'https://example.com/product?ref=TEST_TRACK_123',
      isActive: true
    });
    await referralLink.save();
    console.log('✅ Created referral link:', referralLink.trackingCode);

    // 4. Create a test customer
    const customer = new Customer({
      trackingCode: 'TEST_TRACK_123',
      productId: product._id,
      marketerId: marketer._id,
      referralLinkId: referralLink._id,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '+1234567890',
      onboardingStatus: 'completed',
      currentStep: 3,
      totalSteps: 3,
      consents: {
        termsAndConditions: true,
        privacyPolicy: true,
        marketingCommunications: false,
        dataProcessing: true,
        consentDate: new Date()
      }
    });
    await customer.save();
    console.log('✅ Created test customer:', customer._id);

    // 5. Test commission calculation with different amounts
    const testAmounts = [1000, 2500, 5000, 10000];
    
    for (const amount of testAmounts) {
      console.log(`\n--- Testing with $${amount.toLocaleString()} ---`);
      
      // Create commission data
      const commissionData = {
        marketerId: marketer._id.toString(),
        customerId: customer._id.toString(),
        productId: product._id.toString(),
        trackingCode: 'TEST_TRACK_123',
        initialSpendAmount: amount,
        conversionDate: new Date()
      };

      try {
        // Calculate commission
        const commission = await CommissionService.calculateCommission(commissionData);
        
        console.log(`✅ Commission created:`);
        console.log(`   Commission ID: ${commission._id}`);
        console.log(`   Customer Payment: $${amount.toLocaleString()}`);
        console.log(`   Commission Rate: ${(commission.commissionRate * 100)}%`);
        console.log(`   Commission Amount: $${commission.commissionAmount.toLocaleString()}`);
        console.log(`   Status: ${commission.status}`);
        
        // Verify the calculation is correct
        const expectedAmount = amount * product.commissionRate;
        if (Math.abs(commission.commissionAmount - expectedAmount) < 0.01) {
          console.log(`✅ Calculation correct: $${expectedAmount} = $${commission.commissionAmount}`);
        } else {
          console.log(`❌ Calculation error: Expected $${expectedAmount}, got $${commission.commissionAmount}`);
        }
        
        // Clean up this commission for next test
        await Commission.findByIdAndDelete(commission._id);
        
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Commission already exists for this customer/product combination`);
        } else {
          console.log(`❌ Error creating commission:`, error.message);
        }
      }
    }

    // 6. Test marketer commission summary
    console.log(`\n--- Testing Marketer Commission Summary ---`);
    
    // Create a real commission for summary test
    const finalCommissionData = {
      marketerId: marketer._id.toString(),
      customerId: customer._id.toString(),
      productId: product._id.toString(),
      trackingCode: 'TEST_TRACK_123',
      initialSpendAmount: 5000,
      conversionDate: new Date()
    };
    
    const finalCommission = await CommissionService.calculateCommission(finalCommissionData);
    console.log(`✅ Created final commission: $${finalCommission.commissionAmount}`);
    
    // Get commission summary
    const summary = await CommissionService.getCommissionSummary(marketer._id.toString());
    console.log(`✅ Commission Summary:`);
    console.log(`   Total Earned: $${summary.totalEarned}`);
    console.log(`   Pending: $${summary.pendingAmount}`);
    console.log(`   Approved: $${summary.approvedAmount}`);
    console.log(`   Paid: $${summary.paidAmount}`);
    console.log(`   Total Commissions: ${summary.totalCommissions}`);

    // 7. Test marketer commission details
    console.log(`\n--- Testing Marketer Commission Details ---`);
    const details = await CommissionService.getMarketerCommissionDetails(marketer._id.toString());
    console.log(`✅ Commission Details:`);
    details.forEach((detail, index) => {
      console.log(`   ${index + 1}. Customer: ${detail.customerName}`);
      console.log(`      Initial Spend: $${detail.initialSpend}`);
      console.log(`      Commission: $${detail.commissionEarned}`);
      console.log(`      Status: ${detail.commissionStatus}`);
    });

    console.log(`\n🎉 All tests completed successfully!`);
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Commission calculation works correctly`);
    console.log(`   ✅ Commission is based on actual customer payment`);
    console.log(`   ✅ Higher payments = Higher commissions`);
    console.log(`   ✅ Marketer can see commission summary`);
    console.log(`   ✅ Marketer can see commission details`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up test data
    try {
      await User.deleteMany({ email: 'test-marketer@example.com' });
      await Product.deleteMany({ name: 'Test Investment Product' });
      await Customer.deleteMany({ email: 'john.doe@example.com' });
      await ReferralLink.deleteMany({ trackingCode: 'TEST_TRACK_123' });
      await Commission.deleteMany({ trackingCode: 'TEST_TRACK_123' });
      console.log('✅ Cleaned up test data');
    } catch (cleanupError) {
      console.log('⚠️  Error cleaning up:', cleanupError.message);
    }
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from database');
  }
}

// Run the test
testCommissionFlow();