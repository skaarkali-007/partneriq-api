import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface IPaymentMethod extends Document {
  _id: string;
  userId: string;
  methodType: 'bank_transfer' | 'paypal' | 'stripe' | 'bitcoin' | 'ethereum' | 'usdc' | 'usdt';
  accountDetails: {
    // For bank transfer
    accountNumber?: string;
    routingNumber?: string;
    bankName?: string;
    accountHolderName?: string;
    // For PayPal
    paypalEmail?: string;
    // For Stripe
    stripeAccountId?: string;
    // For cryptocurrencies
    walletAddress?: string;
    walletLabel?: string; // Optional label for the wallet
    network?: string; // e.g., 'mainnet', 'polygon', 'bsc' for different networks
    // Common fields
    currency?: string;
    country?: string;
  };
  encryptedAccountDetails: string;
  isDefault: boolean;
  isVerified: boolean;
  verificationStatus: 'pending' | 'verified' | 'failed';
  verificationDate?: Date;
  lastUsed?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Methods
  encryptAccountDetails(): void;
  decryptAccountDetails(): any;
}

const paymentMethodSchema = new Schema<IPaymentMethod>({
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    ref: 'User',
    index: true
  },
  methodType: {
    type: String,
    enum: ['bank_transfer', 'paypal', 'stripe', 'bitcoin', 'ethereum', 'usdc', 'usdt'],
    required: [true, 'Payment method type is required']
  },
  accountDetails: {
    type: Schema.Types.Mixed,
    required: false,
    select: false // Never include raw account details in queries
  },
  encryptedAccountDetails: {
    type: String,
    required: false, // We'll handle this in pre-save middleware
    select: false // Don't include in regular queries
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'failed'],
    default: 'pending'
  },
  verificationDate: {
    type: Date
  },
  lastUsed: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      delete (ret as any).accountDetails;
      delete (ret as any).encryptedAccountDetails;
      return ret;
    }
  }
});

// Indexes for performance
paymentMethodSchema.index({ userId: 1 });
paymentMethodSchema.index({ userId: 1, isDefault: 1 });
paymentMethodSchema.index({ userId: 1, methodType: 1 });
paymentMethodSchema.index({ verificationStatus: 1 });

// Encryption key from environment variable
const ENCRYPTION_KEY = process.env.PAYMENT_ENCRYPTION_KEY || 'default-key-change-in-production-32-chars';

// Method to encrypt account details
paymentMethodSchema.methods.encryptAccountDetails = function(): void {
  if (!this.accountDetails) {
    return;
  }
  
  try {
    const iv = crypto.randomBytes(16);
    // Ensure key is exactly 32 bytes for AES-256
    const keyBuffer = Buffer.alloc(32);
    const sourceKey = Buffer.from(ENCRYPTION_KEY, 'utf8');
    sourceKey.copy(keyBuffer, 0, 0, Math.min(sourceKey.length, 32));
    
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    
    let encrypted = cipher.update(JSON.stringify(this.accountDetails), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Store IV + encrypted data
    this.encryptedAccountDetails = iv.toString('hex') + ':' + encrypted;
    
    // Clear the plain text details
    this.accountDetails = undefined;
  } catch (error) {
    throw new Error(`Failed to encrypt account details: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Method to decrypt account details
paymentMethodSchema.methods.decryptAccountDetails = function(): any {
  if (!this.encryptedAccountDetails) return null;
  
  try {
    const parts = this.encryptedAccountDetails.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted data format');
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    // Ensure key is exactly 32 bytes for AES-256 (same as encryption)
    const keyBuffer = Buffer.alloc(32);
    const sourceKey = Buffer.from(ENCRYPTION_KEY, 'utf8');
    sourceKey.copy(keyBuffer, 0, 0, Math.min(sourceKey.length, 32));
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Error decrypting account details:', error);
    return null;
  }
};

// Pre-save middleware to encrypt account details
paymentMethodSchema.pre('save', function(next) {
  if (this.accountDetails && (!this.encryptedAccountDetails || this.isModified('accountDetails'))) {
    try {
      this.encryptAccountDetails();
      
      // Validate that encryption was successful
      if (!this.encryptedAccountDetails) {
        return next(new Error('Failed to encrypt account details'));
      }
    } catch (error) {
      return next(error as Error);
    }
  }
  
  // Ensure we have encrypted data if this is a new document with account details
  if (this.isNew && !this.encryptedAccountDetails) {
    return next(new Error('Payment method must have encrypted account details'));
  }
  
  next();
});

// Ensure only one default payment method per user
paymentMethodSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Remove default flag from other payment methods for this user
    await mongoose.model('PaymentMethod').updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  next();
});

export const PaymentMethod = mongoose.model<IPaymentMethod>('PaymentMethod', paymentMethodSchema);