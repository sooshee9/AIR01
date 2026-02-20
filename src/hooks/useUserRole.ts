import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from '../utils/logger';
import type { User } from 'firebase/auth';

interface UserProfile {
  email: string;
  role: string;
  permissions: string[];
  displayName?: string;
  createdAt?: Date;
}

export const useUserRole = (user: User | null) => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchInProgressRef = useRef(false);

  useEffect(() => {
    const fetchUserRole = async () => {
      if (!user) {
        setUserProfile(null);
        setLoading(false);
        return;
      }

      // Prevent duplicate fetches
      if (fetchInProgressRef.current) return;
      fetchInProgressRef.current = true;

      try {
        setLoading(true);
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as UserProfile);
        } else {
          // If user doc doesn't exist, create a default profile
          const isSeededAdmin = user.uid === '4OzW9GTwokTOnza0A0e4DNclJ6H2';
          const defaultProfile: UserProfile = {
            email: user.email || '',
            role: isSeededAdmin ? 'admin' : 'viewer',
            permissions: isSeededAdmin ? [] : [],
            displayName: user.displayName || 'User',
            createdAt: new Date(),
          };
          
          try {
            await setDoc(userDocRef, defaultProfile);
            setUserProfile(defaultProfile);
          } catch (err) {
            // Profile creation failed, but continue with default profile
            logger.error('Failed to create user profile in Firestore:', err);
            setUserProfile(defaultProfile);
          }
        }
        setError(null);
      } catch (err) {
        logger.error('Error fetching user role:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to fetch user role'
        );
      } finally {
        setLoading(false);
        fetchInProgressRef.current = false;
      }
    };

    fetchUserRole();
  }, [user?.uid]);

  return { userProfile, loading, error };
};
