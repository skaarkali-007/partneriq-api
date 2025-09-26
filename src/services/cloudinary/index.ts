import { v2 as cloudinary } from 'cloudinary';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import {config} from "dotenv"
config()

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  url: string;
  format: string;
  resource_type: string;
  bytes: number;
  created_at: string;
}

export interface CloudinaryUploadOptions {
  folder?: string;
  resource_type?: 'image' | 'video' | 'raw' | 'auto';
  public_id?: string;
  transformation?: any[];
  tags?: string[];
}

export class CloudinaryService {
  private static instance: CloudinaryService;
  private isConfigured = false;

  private constructor() {
    this.configure();
  }

  public static getInstance(): CloudinaryService {
    if (!CloudinaryService.instance) {
      CloudinaryService.instance = new CloudinaryService();
    }
    return CloudinaryService.instance;
  }

  private configure(): void {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.warn('Cloudinary configuration missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true
    });

    this.isConfigured = true;
    console.log('Cloudinary configured successfully');
  }

  /**
   * Upload a file buffer to Cloudinary
   */
  public async uploadBuffer(
    buffer: Buffer,
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured. Please check your environment variables.');
    }

    return new Promise((resolve, reject) => {
      const uploadOptions = {
        resource_type: options.resource_type || 'auto',
        folder: options.folder || 'uploads',
        public_id: options.public_id,
        transformation: options.transformation,
        tags: options.tags,
        ...options
      };

      cloudinary.uploader.upload_stream(
        uploadOptions,
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error) {
            reject(new Error(`Cloudinary upload failed: ${error.message}`));
          } else if (result) {
            resolve({
              public_id: result.public_id,
              secure_url: result.secure_url,
              url: result.url,
              format: result.format,
              resource_type: result.resource_type,
              bytes: result.bytes,
              created_at: result.created_at
            });
          } else {
            reject(new Error('Cloudinary upload failed: No result returned'));
          }
        }
      ).end(buffer);
    });
  }

  /**
   * Upload a file from file path to Cloudinary
   */
  public async uploadFile(
    filePath: string,
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured. Please check your environment variables.');
    }

    try {
      const uploadOptions = {
        resource_type: options.resource_type || 'auto',
        folder: options.folder || 'uploads',
        public_id: options.public_id,
        transformation: options.transformation,
        tags: options.tags,
        ...options
      };

      const result = await cloudinary.uploader.upload(filePath, uploadOptions);
      
      return {
        public_id: result.public_id,
        secure_url: result.secure_url,
        url: result.url,
        format: result.format,
        resource_type: result.resource_type,
        bytes: result.bytes,
        created_at: result.created_at
      };
    } catch (error) {
      throw new Error(`Cloudinary upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload multiple files to Cloudinary
   */
  public async uploadMultipleFiles(
    files: { buffer: Buffer; originalName: string }[],
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult[]> {
    const uploadPromises = files.map((file, index) => {
      const fileOptions = {
        ...options,
        public_id: options.public_id ? `${options.public_id}_${index}` : undefined,
        tags: [...(options.tags || []), file.originalName]
      };
      
      return this.uploadBuffer(file.buffer, fileOptions);
    });

    return Promise.all(uploadPromises);
  }

  /**
   * Delete a file from Cloudinary
   */
  public async deleteFile(publicId: string): Promise<{ result: string }> {
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured. Please check your environment variables.');
    }

    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result;
    } catch (error) {
      throw new Error(`Cloudinary delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get file details from Cloudinary
   */
  public async getFileDetails(publicId: string): Promise<any> {
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured. Please check your environment variables.');
    }

    try {
      const result = await cloudinary.api.resource(publicId);
      return result;
    } catch (error) {
      throw new Error(`Cloudinary get file details failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a secure URL for a file with transformations
   */
  public generateSecureUrl(
    publicId: string,
    transformations?: any[]
  ): string {
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured. Please check your environment variables.');
    }

    return cloudinary.url(publicId, {
      secure: true,
      transformation: transformations
    });
  }

  /**
   * Upload KYC document with specific settings
   */
  public async uploadKYCDocument(
    buffer: Buffer,
    documentType: string,
    customerId: string,
    originalName: string
  ): Promise<CloudinaryUploadResult> {
    const options: CloudinaryUploadOptions = {
      folder: `kyc/${customerId}`,
      resource_type: 'auto',
      public_id: `${documentType}_${Date.now()}`,
      tags: ['kyc', documentType, customerId, originalName],
      transformation: [
        { quality: 'auto:good' },
        { fetch_format: 'auto' }
      ]
    };

    return this.uploadBuffer(buffer, options);
  }

  /**
   * Check if Cloudinary is properly configured
   */
  public isReady(): boolean {
    return this.isConfigured;
  }
}

// Export singleton instance
export const cloudinaryService = CloudinaryService.getInstance();