# Firestore Security Rules Setup

## Problem
The delete button in PSIRModule (and other modules) may not work due to missing or incorrect Firestore security rules.

## Solution
Follow these steps to deploy the correct Firestore security rules:

### Step 1: Install Firebase CLI (if not already installed)
```bash
npm install -g firebase-tools
```

### Step 2: Authenticate with Firebase
```bash
firebase login
```

### Step 3: Initialize Firebase Project (if not already done)
```bash
firebase init
```

### Step 4: Deploy Security Rules
Copy the content from `firestore.rules` file and either:

**Option A: Using Firebase Console (Easier)**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `track-94ac0`
3. Navigate to **Firestore Database** → **Rules**
4. Replace the current rules with the content from `firestore.rules`
5. Click **Publish**

**Option B: Using Firebase CLI (Recommended)**
```bash
firebase deploy --only firestore:rules
```

### Step 5: Verify Rules are Working
1. Try deleting a PSIR item in the application
2. Open Firebase Console → Firestore → Rules tab
3. Check if any permission errors appear in the logs

## What the Rules Allow

The security rules configured in `firestore.rules` allow:

1. **User Documents** (`/users/{userId}`)
   - Each user can read/write their own user document
   - Each user can read/write to all subcollections under their user document

2. **PSIR Collection** (`/psirs/{psirId}`)
   - Users can create new PSIRs (sets `userId` to their UID)
   - Users can read PSIRs they created (`userId == request.auth.uid`)
   - Users can update/delete only their own PSIRs

3. **All Other Access**
   - Blocked by default (deny all)

## Troubleshooting

If the delete button still doesn't work after deploying rules:

1. **Check browser console** for network errors
2. **Verify user is logged in** - open browser DevTools → Console and check:
   ```javascript
   firebase.auth().currentUser
   ```
3. **Check Firestore logs** - Firebase Console → Firestore → Logs
4. **Test rules directly** - Firebase Console → Firestore → Rules → Test Rules button

## Related Files
- `firestore.rules` - Firestore security rules configuration
- `src/utils/psirService.ts` - PSIR Firestore operations
- `src/modules/PSIRModule.tsx` - PSIR UI module
