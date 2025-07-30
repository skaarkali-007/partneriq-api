import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger';

// Create transporter - always use Gmail for actual email sending
const createTransporter = () => {
  // Check if email credentials are available
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    logger.warn('Email credentials not found. Emails will only be logged to console.');
    return nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true
    });
  }

  // Use Gmail for actual email sending
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
};

const transporter = createTransporter();

export const sendVerificationEmail = async (email: string, token: string) => {
  try {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@financialaffiliate.com',
      to: email,
      subject: 'Verify Your Email Address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Email Verification</h2>
          <p>Thank you for registering! Please click the link below to verify your email address:</p>
          <a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a>
          <p>Or copy and paste this link into your browser:</p>
          <p>${verificationUrl}</p>
          <p>This link will expire in 24 hours.</p>
        </div>
      `
    };
    
    // Always try to send email if credentials are available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      // Log to console if no email credentials
      logger.info(`Email would be sent to ${email}:`);
      logger.info(`Subject: ${mailOptions.subject}`);
      logger.info(`Verification URL: ${verificationUrl}`);
    } else {
      // Send actual email
      await transporter.sendMail(mailOptions);
      logger.info(`Verification email sent to ${email}`);
    }
  } catch (error) {
    logger.error('Failed to send verification email:', error);
    throw error;
  }
};

export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@financialaffiliate.com',
      to: email,
      subject: 'Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; text-align: center;">
          <h2>Email Verification</h2>
          <p>Thank you for registering! Please use the verification code below to verify your email address:</p>
          <div style="background-color: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 8px;">
            <h1 style="font-size: 32px; font-weight: bold; color: #007bff; margin: 0; letter-spacing: 4px;">${otp}</h1>
          </div>
          <p>Enter this code in the verification form to complete your registration.</p>
          <p style="color: #dc3545; font-weight: bold;">This code will expire in 10 minutes.</p>
          <p style="color: #6c757d; font-size: 14px;">If you didn't request this verification, please ignore this email.</p>
        </div>
      `
    };
    
    // Always try to send email if credentials are available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      // Log to console if no email credentials
      logger.info(`OTP Email would be sent to ${email}:`);
      logger.info(`Subject: ${mailOptions.subject}`);
      logger.info(`OTP Code: ${otp}`);
    } else {
      // Send actual email
      await transporter.sendMail(mailOptions);
      logger.info(`OTP email sent to ${email}`);
    }
  } catch (error) {
    logger.error('Failed to send OTP email:', error);
    throw error;
  }
};