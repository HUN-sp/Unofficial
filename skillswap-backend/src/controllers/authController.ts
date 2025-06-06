import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken, firestore } from '../config/firebase';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';
import { CreateUserRequest } from '../types';
import { FieldValue } from 'firebase-admin/firestore';

export class AuthController {
  // Register new user with Firebase
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { 
        idToken, 
        name, 
        role = 'student', 
        avatar_url, 
        skills_offered = [], 
        skills_wanted = [], 
        availability = { days: [], times: [] } 
      } = req.body;

      if (!idToken) {
        throw new AppError('Firebase ID token is required', 400);
      }

      if (!name) {
        throw new AppError('Name is required', 400);
      }

      // Verify Firebase ID token
      const decodedToken = await verifyFirebaseToken(idToken);
      const { uid, email } = decodedToken;

      // Check if user already exists in Firestore
      const userDoc = await firestore.collection('users').doc(uid).get();
      if (userDoc.exists) {
        throw new AppError('User already exists', 409);
      }

      // Create user data
      const userData = {
        uid,
        name: name.trim(),
        email: email!,
        avatar_url: avatar_url || null,
        role,
        skills_offered,
        skills_wanted,
        availability,
        badge_count: 0,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp()
      };

      // Create user document in Firestore
      await firestore.collection('users').doc(uid).set(userData);

      // Update skill popularity counters
      if (skills_offered.length > 0) {
        const batch = firestore.batch();
        
        for (const skill of skills_offered) {
          const skillRef = firestore.collection('skill_popularity').doc(skill.toLowerCase());
          batch.set(skillRef, {
            name: skill,
            count: FieldValue.increment(1),
            updated_at: FieldValue.serverTimestamp()
          }, { merge: true });
        }
        
        await batch.commit();
      }

      logger.info(`✅ User registered successfully: ${uid}`);

      // Return user data (excluding sensitive info)
      const responseData = {
        uid: userData.uid,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        avatar_url: userData.avatar_url,
        skills_offered: userData.skills_offered,
        skills_wanted: userData.skills_wanted,
        availability: userData.availability,
        badge_count: userData.badge_count
      };

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: responseData
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Login user (verify token and return user info)
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        throw new AppError('Firebase ID token is required', 400);
      }

      // Verify Firebase ID token
      const decodedToken = await verifyFirebaseToken(idToken);
      const { uid, email } = decodedToken;

      // Get user from Firestore
      const userDoc = await firestore.collection('users').doc(uid).get();
      
      if (!userDoc.exists) {
        // For Google OAuth users who haven't completed registration
        if (decodedToken.firebase.sign_in_provider === 'google.com') {
          return res.status(200).json({
            success: true,
            message: 'Google user needs to complete registration',
            data: {
              needsRegistration: true,
              email,
              uid
            }
          });
        }
        
        throw new AppError('User not found. Please register first.', 404);
      }

      const userData = userDoc.data()!;

      logger.info(`✅ User logged in successfully: ${uid}`);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            uid: userData.uid,
            name: userData.name,
            email: userData.email,
            role: userData.role,
            avatar_url: userData.avatar_url,
            badge_count: userData.badge_count
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Verify token endpoint (for frontend auth checks)
  static async verifyToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        throw new AppError('Firebase ID token is required', 400);
      }

      // Verify Firebase ID token
      const decodedToken = await verifyFirebaseToken(idToken);
      const userDoc = await firestore.collection('users').doc(decodedToken.uid).get();

      if (!userDoc.exists) {
        throw new AppError('User not found', 404);
      }

      const userData = userDoc.data()!;

      res.status(200).json({
        success: true,
        message: 'Token is valid',
        data: {
          user: {
            uid: userData.uid,
            name: userData.name,
            email: userData.email,
            role: userData.role,
            badge_count: userData.badge_count
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Logout (mainly for logging purposes)
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.user?.uid;

      if (uid) {
        logger.info(`✅ User logged out: ${uid}`);
      }

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      next(error);
    }
  }
}