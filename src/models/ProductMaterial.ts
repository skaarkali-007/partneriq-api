import mongoose, { Document, Schema } from 'mongoose';

export interface IProductMaterial extends Document {
  _id: string;
  productId: string;
  materialType: 'banner' | 'email_template' | 'fact_sheet' | 'image' | 'document';
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  dimensions?: string; // e.g., "300x250" for banners
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productMaterialSchema = new Schema<IProductMaterial>({
  productId: {
    type: String,
    required: [true, 'Product ID is required'],
    ref: 'Product'
  },
  materialType: {
    type: String,
    enum: ['banner', 'email_template', 'fact_sheet', 'image', 'document'],
    required: [true, 'Material type is required']
  },
  title: {
    type: String,
    required: [true, 'Material title is required'],
    trim: true,
    maxlength: [255, 'Title cannot exceed 255 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  fileUrl: {
    type: String,
    required: [true, 'File URL is required'],
    trim: true
  },
  fileName: {
    type: String,
    required: [true, 'File name is required'],
    trim: true,
    maxlength: [255, 'File name cannot exceed 255 characters']
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required'],
    min: [0, 'File size cannot be negative']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required'],
    trim: true
  },
  dimensions: {
    type: String,
    trim: true,
    validate: {
      validator: function(value: string) {
        if (!value) return true; // Optional field
        // Validate format like "300x250" or "1920x1080"
        return /^\d+x\d+$/.test(value);
      },
      message: 'Dimensions must be in format "widthxheight" (e.g., "300x250")'
    }
  },
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: function(tags: string[]) {
        return tags.length <= 10; // Limit to 10 tags
      },
      message: 'Cannot have more than 10 tags'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      return ret;
    }
  }
});

// Indexes for performance
productMaterialSchema.index({ productId: 1 });
productMaterialSchema.index({ materialType: 1 });
productMaterialSchema.index({ isActive: 1 });
productMaterialSchema.index({ tags: 1 });
productMaterialSchema.index({ createdAt: -1 });

// Compound indexes for common queries
productMaterialSchema.index({ productId: 1, materialType: 1 });
productMaterialSchema.index({ productId: 1, isActive: 1 });
productMaterialSchema.index({ productId: 1, materialType: 1, isActive: 1 });

export const ProductMaterial = mongoose.model<IProductMaterial>('ProductMaterial', productMaterialSchema);